<?php

namespace App\Controllers\Api;

use Throwable;

class EmployeesController extends BaseApiController
{
    public function index()
    {
        $rows = model(\App\Models\EmployeeModel::class)
            ->select('id, name, employee_code, is_active, position, organization_id, email, hire_date, termination_date')
            ->orderBy('is_active', 'DESC')
            ->orderBy('name', 'ASC')
            ->findAll();

        return $this->respond([
            'employees' => array_map(static fn($r) => [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'employeeCode' => $r['employee_code'] ?: null,
                'isActive' => (int) ($r['is_active'] ?? 1) === 1,
                'position' => $r['position'] ?? null,
                'organizationId' => isset($r['organization_id']) && $r['organization_id'] !== null
                    ? (int) $r['organization_id']
                    : null,
                'email' => $r['email'] ?? null,
                'hireDate' => $r['hire_date'] ?? null,
                'terminationDate' => $r['termination_date'] ?? null,
            ], $rows),
        ]);
    }

    public function show($id = null)
    {
        $employeeId = (int) $id;
        if ($employeeId <= 0) {
            return $this->failValidationErrors('employee id inválido.');
        }

        try {
            $db = db_connect();
            $row = $db->table('employees e')
                ->select('e.*, o.name AS organization_name')
                ->join('organizations o', 'o.id = e.organization_id', 'left')
                ->where('e.id', $employeeId)
                ->get()->getFirstRow('array');

            if (!is_array($row)) {
                return $this->failNotFound('Empleado no encontrado.');
            }

            $hasCredential = (bool) model(\App\Models\EmployeeCredentialModel::class)
                ->where('employee_id', $employeeId)
                ->where('is_active', 1)
                ->countAllResults();

            return $this->respond([
                'employee' => $this->mapForApi($row, $hasCredential),
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo cargar el empleado: ' . $e->getMessage());
        }
    }

    public function update($id = null)
    {
        $employeeId = (int) $id;
        if ($employeeId <= 0) {
            return $this->failValidationErrors('employee id inválido.');
        }

        $body = $this->jsonBody();
        if (!is_array($body) || empty($body)) {
            return $this->failValidationErrors('Cuerpo vacío.');
        }

        $validation = service('validation');
        $validation->setRules([
            'name' => 'permit_empty|string|min_length[2]|max_length[180]',
            'employeeCode' => 'permit_empty|string|max_length[64]',
            'email' => 'permit_empty|valid_email|max_length[255]',
            'phone' => 'permit_empty|string|max_length[32]',
            'position' => 'permit_empty|string|max_length[120]',
            'hireDate' => 'permit_empty|valid_date[Y-m-d]',
            'terminationDate' => 'permit_empty|valid_date[Y-m-d]',
            'birthdate' => 'permit_empty|valid_date[Y-m-d]',
            'organizationId' => 'permit_empty|is_natural_no_zero',
            'isActive' => 'permit_empty|in_list[0,1,true,false]',
            'notes' => 'permit_empty|string|max_length[2000]',
        ]);
        if (!$validation->run($body)) {
            return $this->failValidationErrors($validation->getErrors());
        }

        $model = model(\App\Models\EmployeeModel::class);
        $current = $model->find($employeeId);
        if (!is_array($current)) {
            return $this->failNotFound('Empleado no encontrado.');
        }

        $update = [];
        $map = [
            'name' => 'name',
            'employeeCode' => 'employee_code',
            'email' => 'email',
            'phone' => 'phone',
            'position' => 'position',
            'hireDate' => 'hire_date',
            'terminationDate' => 'termination_date',
            'birthdate' => 'birthdate',
            'organizationId' => 'organization_id',
            'notes' => 'notes',
        ];
        foreach ($map as $apiKey => $col) {
            if (!array_key_exists($apiKey, $body)) {
                continue;
            }
            $value = $body[$apiKey];
            if ($value === '' ) {
                $update[$col] = null;
            } elseif ($apiKey === 'employeeCode' && is_string($value)) {
                $update[$col] = strtoupper(trim($value));
            } elseif ($apiKey === 'organizationId' && $value !== null) {
                $update[$col] = (int) $value;
            } else {
                $update[$col] = $value;
            }
        }
        if (array_key_exists('isActive', $body)) {
            $val = $body['isActive'];
            $update['is_active'] = (in_array($val, [1, '1', true, 'true'], true)) ? 1 : 0;
        }

        if (!empty($update['hire_date']) && !empty($update['termination_date'])
            && (string) $update['termination_date'] < (string) $update['hire_date']) {
            return $this->failValidationErrors([
                'terminationDate' => 'La fecha de término no puede ser anterior a la fecha de contratación.',
            ]);
        }

        if (isset($update['employee_code']) && $update['employee_code'] !== null) {
            $exists = $model->where('employee_code', $update['employee_code'])
                ->where('id !=', $employeeId)
                ->countAllResults();
            if ($exists > 0) {
                return $this->failValidationErrors([
                    'employeeCode' => 'Ya existe otro empleado con ese código.',
                ]);
            }
        }

        if (empty($update)) {
            return $this->respond([
                'ok' => true,
                'employee' => $this->mapForApi($current, false),
                'message' => 'Sin cambios.',
            ]);
        }

        try {
            $model->update($employeeId, $update);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo guardar el perfil: ' . $e->getMessage());
        }

        return $this->show($employeeId);
    }

    public function setCredential($id)
    {
        $employeeId = (int) $id;
        if ($employeeId <= 0) {
            return $this->failValidationErrors('employee id inválido.');
        }

        $body = $this->jsonBody();
        $employeeCode = strtoupper(trim((string) ($body['employeeCode'] ?? '')));
        $pin = trim((string) ($body['pin'] ?? ''));
        if ($employeeCode === '' || $pin === '' || strlen($pin) < 4) {
            return $this->failValidationErrors('employeeCode y PIN (mínimo 4 dígitos) son obligatorios.');
        }

        $emp = model(\App\Models\EmployeeModel::class)->find($employeeId);
        if (!is_array($emp)) {
            return $this->failNotFound('Empleado no encontrado.');
        }

        $empModel = model(\App\Models\EmployeeModel::class);
        $empModel->update($employeeId, ['employee_code' => $employeeCode]);

        $credModel = model(\App\Models\EmployeeCredentialModel::class);
        $existing = $credModel->where('employee_id', $employeeId)->first();
        $data = [
            'employee_id' => $employeeId,
            'employee_code' => $employeeCode,
            'pin_hash' => password_hash($pin, PASSWORD_DEFAULT),
            'is_active' => 1,
            'failed_attempts' => 0,
            'locked_until' => null,
        ];

        if (is_array($existing)) {
            $credModel->update((int) $existing['id'], $data);
        } else {
            $credModel->insert($data);
        }

        return $this->respond([
            'ok' => true,
            'employeeId' => $employeeId,
            'employeeCode' => $employeeCode,
        ]);
    }

    private function mapForApi(array $row, bool $hasCredential): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'employeeCode' => $row['employee_code'] ?? null,
            'isActive' => (int) ($row['is_active'] ?? 1) === 1,
            'email' => $row['email'] ?? null,
            'phone' => $row['phone'] ?? null,
            'position' => $row['position'] ?? null,
            'birthdate' => $row['birthdate'] ?? null,
            'hireDate' => $row['hire_date'] ?? null,
            'terminationDate' => $row['termination_date'] ?? null,
            'organizationId' => isset($row['organization_id']) && $row['organization_id'] !== null
                ? (int) $row['organization_id']
                : null,
            'organizationName' => $row['organization_name'] ?? null,
            'notes' => $row['notes'] ?? null,
            'hasCredential' => $hasCredential,
            'createdAt' => $row['created_at'] ?? null,
            'updatedAt' => $row['updated_at'] ?? null,
        ];
    }
}
