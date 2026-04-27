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

            $balanceErr = $this->assertLeaveBalanceAllows(
                (int) $body['employee_id'],
                (int) $body['absence_type_id'],
                $businessDaysCount,
                null,
                (string) $body['start_date'],
            );
            if ($balanceErr !== null) {
                return $this->failValidationErrors(['balance' => $balanceErr]);
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
        $aid = (int) $id;
        if ($aid <= 0) {
            return $this->failValidationErrors('id inválido');
        }
        try {
            $model = model(EmployeeAbsenceModel::class);
            $row = $model->find($aid);
            if (!$row) {
                return $this->failNotFound('Ausencia no encontrada');
            }
            $st = (string) $row['status'];
            if ($st === EmployeeAbsenceModel::STATUS_CANCELLED) {
                return $this->failValidationErrors(['status' => 'La solicitud ya está cancelada.']);
            }
            if ($st === EmployeeAbsenceModel::STATUS_SUPERSEDED) {
                return $this->failValidationErrors(['status' => 'No se puede anular un registro marcado como reemplazado (superseded).']);
            }
            if ($st === EmployeeAbsenceModel::STATUS_REJECTED) {
                return $this->failValidationErrors(['status' => 'Las solicitudes rechazadas pueden eliminarse con «Eliminar registro».']);
            }
            if ($st === EmployeeAbsenceModel::STATUS_PENDING) {
                return $this->changeStatus($aid, EmployeeAbsenceModel::STATUS_CANCELLED);
            }
            if ($st === EmployeeAbsenceModel::STATUS_APPROVED) {
                $body = $this->jsonBody();
                $force = !empty($body['forceClosedPeriod']) && $this->jwtRole() === 'admin';
                if ($this->isInClosedPeriod((string) $row['start_date'], (string) $row['end_date']) && !$force) {
                    return $this->failValidationErrors([
                        'period' => 'El permiso intersecta una quincena cerrada. Un administrador puede anularlo enviando forceClosedPeriod: true en el cuerpo de la petición.',
                    ]);
                }
                $model->update($aid, ['status' => EmployeeAbsenceModel::STATUS_CANCELLED]);
                log_message('info', "Absence #{$aid} cancelled from approved by user " . (string) ($this->jwtPayload()['sub'] ?? 'null'));
                $this->recalcLeaveForEmployee((int) $row['employee_id']);

                return $this->respondUpdated(['id' => $aid, 'status' => EmployeeAbsenceModel::STATUS_CANCELLED]);
            }

            return $this->failValidationErrors(['status' => 'Estado no admitido para anular.']);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo anular: ' . $e->getMessage());
        }
    }

    public function update($id = null)
    {
        $aid = (int) $id;
        if ($aid <= 0) {
            return $this->failValidationErrors('id inválido');
        }
        try {
            $model = model(EmployeeAbsenceModel::class);
            $row = $model->find($aid);
            if (!$row) {
                return $this->failNotFound('Ausencia no encontrada');
            }
            $st = (string) $row['status'];
            if (!in_array($st, [EmployeeAbsenceModel::STATUS_PENDING, EmployeeAbsenceModel::STATUS_APPROVED], true)) {
                return $this->failValidationErrors([
                    'status' => 'Solo se pueden corregir solicitudes pendientes o aprobadas. Para otras, use eliminar.',
                ]);
            }

            $body = $this->jsonBody();
            $validation = service('validation');
            $validation->setRules([
                'employee_id' => 'permit_empty|is_natural_no_zero',
                'absence_type_id' => 'permit_empty|is_natural_no_zero',
                'start_date' => 'permit_empty|valid_date[Y-m-d]',
                'end_date' => 'permit_empty|valid_date[Y-m-d]',
                'reason' => 'permit_empty|max_length[500]',
                'document_url' => 'permit_empty|max_length[500]',
                'notes' => 'permit_empty',
                'forceClosedPeriod' => 'permit_empty|in_list[0,1,true,false]',
            ]);
            if (!$validation->run($body)) {
                return $this->failValidationErrors($validation->getErrors());
            }

            $employeeId = isset($body['employee_id']) ? (int) $body['employee_id'] : (int) $row['employee_id'];
            $typeId = isset($body['absence_type_id']) ? (int) $body['absence_type_id'] : (int) $row['absence_type_id'];
            $start = isset($body['start_date']) ? (string) $body['start_date'] : (string) $row['start_date'];
            $end = isset($body['end_date']) ? (string) $body['end_date'] : (string) $row['end_date'];
            if ($start > $end) {
                return $this->failValidationErrors(['range' => 'start_date no puede ser mayor que end_date']);
            }

            $force = !empty($body['forceClosedPeriod']) && $this->jwtRole() === 'admin';
            if ($this->isInClosedPeriod($start, $end) && !$force) {
                return $this->failValidationErrors([
                    'period' => 'El rango intersecta una quincena cerrada. Un administrador puede forzar la corrección con forceClosedPeriod: true.',
                ]);
            }

            $employee = model(EmployeeModel::class)->find($employeeId);
            if (!$employee) {
                return $this->failNotFound('Empleado no encontrado');
            }
            $type = model(AbsenceTypeModel::class)->find($typeId);
            if (!$type || (int) $type['is_active'] !== 1) {
                return $this->failNotFound('Tipo de ausencia inválido');
            }

            $businessDays = (new AbsenceResolver())->listWeekdays($start, $end);
            $businessDaysCount = count($businessDays);

            $balanceErr = $this->assertLeaveBalanceAllows($employeeId, $typeId, $businessDaysCount, $aid, $start);
            if ($balanceErr !== null) {
                return $this->failValidationErrors(['balance' => $balanceErr]);
            }

            $update = [
                'employee_id' => $employeeId,
                'absence_type_id' => $typeId,
                'start_date' => $start,
                'end_date' => $end,
                'business_days' => $businessDaysCount,
            ];
            if (array_key_exists('reason', $body)) {
                $update['reason'] = $body['reason'] !== '' && $body['reason'] !== null ? (string) $body['reason'] : null;
            }
            if (array_key_exists('document_url', $body)) {
                $update['document_url'] = $body['document_url'] !== '' && $body['document_url'] !== null ? (string) $body['document_url'] : null;
            }
            if (array_key_exists('notes', $body)) {
                $update['notes'] = $body['notes'] !== '' && $body['notes'] !== null ? (string) $body['notes'] : null;
            }

            $oldEmployeeId = (int) $row['employee_id'];
            $model->update($aid, $update);
            log_message('info', "Absence #{$aid} updated by user " . (string) ($this->jwtPayload()['sub'] ?? 'null'));

            $this->recalcLeaveForEmployee($oldEmployeeId);
            if ($oldEmployeeId !== $employeeId) {
                $this->recalcLeaveForEmployee($employeeId);
            }

            return $this->respondUpdated(['id' => $aid]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo actualizar la ausencia: ' . $e->getMessage());
        }
    }

    public function delete($id = null)
    {
        $aid = (int) $id;
        if ($aid <= 0) {
            return $this->failValidationErrors('id inválido');
        }
        try {
            $model = model(EmployeeAbsenceModel::class);
            $row = $model->find($aid);
            if (!$row) {
                return $this->failNotFound('Ausencia no encontrada');
            }
            $st = (string) $row['status'];
            if ($st === EmployeeAbsenceModel::STATUS_SUPERSEDED) {
                return $this->failValidationErrors(['status' => 'No se puede eliminar un registro reemplazado (superseded).']);
            }

            $body = $this->jsonBody();
            $force = !empty($body['forceClosedPeriod']) && $this->jwtRole() === 'admin';
            if ($st === EmployeeAbsenceModel::STATUS_APPROVED
                && $this->isInClosedPeriod((string) $row['start_date'], (string) $row['end_date'])
                && !$force) {
                return $this->failValidationErrors([
                    'period' => 'El permiso aprobado intersecta una quincena cerrada. Un administrador puede borrarlo enviando forceClosedPeriod: true.',
                ]);
            }

            $employeeId = (int) $row['employee_id'];
            $model->delete($aid);
            log_message('info', "Absence #{$aid} deleted by user " . (string) ($this->jwtPayload()['sub'] ?? 'null'));
            $this->recalcLeaveForEmployee($employeeId);

            return $this->respondDeleted(['id' => $aid]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo eliminar la ausencia: ' . $e->getMessage());
        }
    }

    private function jwtRole(): string
    {
        $p = $this->jwtPayload();

        return (string) ($p['role'] ?? '');
    }

    /**
     * Comprueba saldo LFT si el tipo descuenta vacaciones. Si $excludeAbsenceId corresponde a una fila aprobada
     * que ya contaba en el saldo, se suma de vuelta su duración para permitir correcciones.
     */
    private function assertLeaveBalanceAllows(
        int $employeeId,
        int $typeId,
        int $businessDaysCount,
        ?int $excludeAbsenceId = null,
        ?string $asOf = null,
    ): ?string {
        $type = model(AbsenceTypeModel::class)->find($typeId);
        if (!$type || (int) $type['affects_leave_balance'] !== 1) {
            return null;
        }

        $asOf = $asOf !== null && $asOf !== '' ? $asOf : date('Y-m-d');
        $balance = (new LeaveBalanceService())->getCurrentForEmployee($employeeId, $asOf);
        if ($balance === null) {
            return null;
        }

        $available = max(
            0.0,
            (float) $balance['entitled_days'] + (float) ($balance['carried_over_days'] ?? 0) - (float) $balance['used_days'],
        );

        if ($excludeAbsenceId !== null) {
            $old = model(EmployeeAbsenceModel::class)->find($excludeAbsenceId);
            if (is_array($old) && (string) $old['status'] === EmployeeAbsenceModel::STATUS_APPROVED
                && (int) $old['employee_id'] === $employeeId) {
                $oldType = model(AbsenceTypeModel::class)->find((int) $old['absence_type_id']);
                if ($oldType && (int) $oldType['affects_leave_balance'] === 1) {
                    $available += (float) $old['business_days'];
                }
            }
        }

        if ($businessDaysCount > $available + 0.0001) {
            return sprintf('El rango (%d días hábiles) excede el saldo disponible (%.2f).', $businessDaysCount, $available);
        }

        return null;
    }

    private function recalcLeaveForEmployee(int $employeeId): void
    {
        try {
            (new LeaveBalanceService())->recalculateForEmployee($employeeId);
        } catch (Throwable $e) {
            log_message('warning', 'recalcLeaveForEmployee: ' . $e->getMessage());
        }
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
