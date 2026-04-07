<?php

namespace App\Controllers\Api;

class EmployeesController extends BaseApiController
{
    public function index()
    {
        $rows = model(\App\Models\EmployeeModel::class)
            ->select('id, name, employee_code, is_active')
            ->where('is_active', 1)
            ->orderBy('name', 'ASC')
            ->findAll();

        return $this->respond([
            'employees' => array_map(static fn($r) => [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'employeeCode' => $r['employee_code'] ?: null,
                'isActive' => (int) ($r['is_active'] ?? 1) === 1,
            ], $rows),
        ]);
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
}

