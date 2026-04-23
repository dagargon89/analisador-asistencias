<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\AbsenceTypeModel;
use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use App\Services\AbsenceResolver;
use App\Services\LeaveBalanceService;
use App\Services\NotificationService;
use DateTimeImmutable;
use Throwable;

class AbsencesController extends BaseApiController
{
    public function list()
    {
        try {
            $from = (string) ($this->request->getGet('from') ?? '');
            $to = (string) ($this->request->getGet('to') ?? '');
            $status = (string) ($this->request->getGet('status') ?? '');
            $employee = trim((string) ($this->request->getGet('employee') ?? ''));

            $builder = db_connect()->table('employee_absences ea')
                ->select('ea.*, e.name AS employee_name, at.code AS type_code, at.label AS type_label, at.color_hex')
                ->join('employees e', 'e.id = ea.employee_id', 'inner')
                ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
                ->orderBy('ea.start_date', 'DESC');

            if ($from !== '' && $to !== '') {
                $builder->where('ea.end_date >=', $from)->where('ea.start_date <=', $to);
            }
            if ($status !== '' && in_array($status, EmployeeAbsenceModel::STATUSES, true)) {
                $builder->where('ea.status', $status);
            }
            if ($employee !== '' && strtolower($employee) !== 'all') {
                $builder->where('e.name', $employee);
            }

            return $this->respond(['absences' => $builder->get()->getResultArray()]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron listar ausencias: ' . $e->getMessage());
        }
    }

    public function create()
    {
        try {
            $body = $this->jsonBody();
            $validation = service('validation');
            $validation->setRules([
                'employee_id' => 'required|is_natural_no_zero',
                'absence_type_id' => 'required|is_natural_no_zero',
                'start_date' => 'required|valid_date[Y-m-d]',
                'end_date' => 'required|valid_date[Y-m-d]',
                'reason' => 'permit_empty|max_length[500]',
                'document_url' => 'permit_empty|max_length[500]',
                'notes' => 'permit_empty',
            ]);
            if (!$validation->run($body)) {
                return $this->failValidationErrors($validation->getErrors());
            }
            if ((string) $body['start_date'] > (string) $body['end_date']) {
                return $this->failValidationErrors(['range' => 'start_date no puede ser mayor que end_date']);
            }

            $employee = model(EmployeeModel::class)->find((int) $body['employee_id']);
            if (!$employee) {
                return $this->failNotFound('Empleado no encontrado');
            }
            $type = model(AbsenceTypeModel::class)->find((int) $body['absence_type_id']);
            if (!$type || (int) $type['is_active'] !== 1) {
                return $this->failNotFound('Tipo de ausencia inválido');
            }

            $businessDays = (new AbsenceResolver())->listWeekdays((string) $body['start_date'], (string) $body['end_date']);
            $businessDaysCount = count($businessDays);

            if ((int) $type['affects_leave_balance'] === 1) {
                $balance = (new LeaveBalanceService())->getCurrentForEmployee((int) $body['employee_id'], (string) $body['start_date']);
                if ($balance !== null) {
                    $available = max(0.0, (float) $balance['entitled_days'] + (float) ($balance['carried_over_days'] ?? 0) - (float) $balance['used_days']);
                    if ($businessDaysCount > $available) {
                        return $this->failValidationErrors([
                            'balance' => sprintf('El rango (%d días) excede el saldo disponible (%.2f).', $businessDaysCount, $available),
                        ]);
                    }
                }
            }

            if ($this->isInClosedPeriod((string) $body['start_date'], (string) $body['end_date'])) {
                return $this->failValidationErrors([
                    'period' => 'el rango cae dentro de una quincena cerrada; crear con supersedes_id si corresponde corrección.',
                ]);
            }

            $payload = $this->jwtPayload();
            $userId = isset($payload['sub']) ? (int) $payload['sub'] : null;

            $row = [
                'employee_id' => (int) $body['employee_id'],
                'absence_type_id' => (int) $body['absence_type_id'],
                'start_date' => (string) $body['start_date'],
                'end_date' => (string) $body['end_date'],
                'business_days' => $businessDaysCount,
                'status' => EmployeeAbsenceModel::STATUS_PENDING,
                'reason' => isset($body['reason']) && $body['reason'] !== '' ? (string) $body['reason'] : null,
                'document_url' => isset($body['document_url']) && $body['document_url'] !== '' ? (string) $body['document_url'] : null,
                'requested_by' => $userId,
                'requested_at' => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
                'notes' => isset($body['notes']) && $body['notes'] !== '' ? (string) $body['notes'] : null,
            ];

            $id = model(EmployeeAbsenceModel::class)->insert($row, true);
            log_message('info', 'Absence created #' . (string) $id . ' for employee ' . (string) $row['employee_id']);

            $this->notifyApprovalRequest((int) $id, $employee, $type, (string) $body['start_date'], (string) $body['end_date']);

            return $this->respondCreated(['id' => $id]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo crear la ausencia: ' . $e->getMessage());
        }
    }

    public function approve($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_APPROVED);
    }

    public function reject($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_REJECTED);
    }

    public function cancel($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_CANCELLED);
    }

    private function notifyApprovalRequest(int $absenceId, array $employee, array $type, string $start, string $end): void
    {
        try {
            $to = (string) (getenv('HR_APPROVERS_EMAIL') ?: '');
            if ($to === '') {
                return;
            }
            (new NotificationService())->sendAbsenceApprovalRequest($absenceId, $to, [
                'employee' => (string) ($employee['name'] ?? ''),
                'type' => (string) ($type['label'] ?? ''),
                'start' => $start,
                'end' => $end,
            ]);
        } catch (Throwable $e) {
            log_message('warning', 'notifyApprovalRequest failed: ' . $e->getMessage());
        }
    }

    private function notifyDecision(int $absenceId, string $decision, ?string $reason): void
    {
        try {
            $db = db_connect();
            $row = $db->table('employee_absences ea')
                ->select('ea.*, e.email AS employee_email, at.label AS type_label')
                ->join('employees e', 'e.id = ea.employee_id', 'left')
                ->join('absence_types at', 'at.id = ea.absence_type_id', 'left')
                ->where('ea.id', $absenceId)
                ->get()->getFirstRow('array');
            if (!$row) {
                return;
            }
            $to = (string) ($row['employee_email'] ?? '');
            if ($to === '') {
                return;
            }
            (new NotificationService())->sendAbsenceDecision($absenceId, $to, $decision, [
                'type' => (string) ($row['type_label'] ?? ''),
                'start' => (string) $row['start_date'],
                'end' => (string) $row['end_date'],
                'reason' => (string) ($reason ?? ''),
            ]);
        } catch (Throwable $e) {
            log_message('warning', 'notifyDecision failed: ' . $e->getMessage());
        }
    }

    private function isInClosedPeriod(string $from, string $to): bool
    {
        $db = db_connect();
        if (!$db->tableExists('payroll_periods')) {
            return false;
        }
        $row = $db->table('payroll_periods')
            ->where('status', 'closed')
            ->where('start_date <=', $to)
            ->where('end_date >=', $from)
            ->get()->getFirstRow('array');
        return $row !== null;
    }

    private function changeStatus(int $id, string $newStatus)
    {
        try {
            $model = model(EmployeeAbsenceModel::class);
            $row = $model->find($id);
            if (!$row) {
                return $this->failNotFound('Ausencia no encontrada');
            }
            if ((string) $row['status'] !== EmployeeAbsenceModel::STATUS_PENDING) {
                return $this->failValidationErrors([
                    'status' => 'solo ausencias pending pueden cambiar de estado; usar supersedes para corregir una aprobada',
                ]);
            }

            $payload = $this->jwtPayload();
            $userId = isset($payload['sub']) ? (int) $payload['sub'] : null;
            $body = $this->jsonBody();

            $update = ['status' => $newStatus];
            if ($newStatus === EmployeeAbsenceModel::STATUS_APPROVED) {
                $update['approved_by'] = $userId;
                $update['approved_at'] = (new DateTimeImmutable())->format('Y-m-d H:i:s');
            } elseif ($newStatus === EmployeeAbsenceModel::STATUS_REJECTED) {
                $update['rejected_reason'] = isset($body['reason']) ? (string) $body['reason'] : null;
            }

            $model->update($id, $update);
            log_message('info', "Absence #{$id} -> {$newStatus} by user " . (string) ($userId ?? 'null'));

            if (in_array($newStatus, [EmployeeAbsenceModel::STATUS_APPROVED, EmployeeAbsenceModel::STATUS_REJECTED], true)) {
                $this->notifyDecision($id, $newStatus, $update['rejected_reason'] ?? null);
            }

            return $this->respondUpdated(['id' => $id, 'status' => $newStatus]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo actualizar: ' . $e->getMessage());
        }
    }
}
