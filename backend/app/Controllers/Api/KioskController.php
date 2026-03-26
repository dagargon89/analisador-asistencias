<?php

namespace App\Controllers\Api;

use App\Services\AuditService;
use App\Services\JwtService;

class KioskController extends BaseApiController
{
    public function auth()
    {
        $body = $this->jsonBody();
        $employeeCode = strtoupper(trim((string) ($body['employeeCode'] ?? '')));
        $pin = trim((string) ($body['pin'] ?? ''));

        if ($employeeCode === '' || $pin === '') {
            return $this->failValidationErrors('employeeCode y pin son obligatorios.');
        }

        $credModel = model(\App\Models\EmployeeCredentialModel::class);
        $empModel = model(\App\Models\EmployeeModel::class);
        $cred = $credModel->where('employee_code', $employeeCode)->first();
        if (!is_array($cred) || !(bool) $cred['is_active']) {
            return $this->failUnauthorized('Credenciales de kiosko inválidas.');
        }
        if ($this->isLocked($cred['locked_until'] ?? null)) {
            return $this->respond(['error' => 'Credencial bloqueada temporalmente.'], 423);
        }

        if (!password_verify($pin, (string) $cred['pin_hash'])) {
            $failed = ((int) $cred['failed_attempts']) + 1;
            $updates = ['failed_attempts' => $failed];
            if ($failed >= (int) env('kiosk.maxFailedAttempts', 5)) {
                $minutes = (int) env('kiosk.lockoutMinutes', 5);
                $updates['locked_until'] = date('Y-m-d H:i:s', time() + ($minutes * 60));
                $updates['failed_attempts'] = 0;
            }
            $credModel->update((int) $cred['id'], $updates);
            return $this->failUnauthorized('PIN inválido.');
        }

        $credModel->update((int) $cred['id'], ['failed_attempts' => 0, 'locked_until' => null]);
        $emp = $empModel->find((int) $cred['employee_id']);
        if (!is_array($emp) || !(bool) ($emp['is_active'] ?? 1)) {
            return $this->failForbidden('Empleado inactivo.');
        }

        $jwt = new JwtService();
        $accessToken = $jwt->issueKioskToken([
            'sub' => 0,
            'role' => 'employee',
            'employee_id' => (int) $cred['employee_id'],
            'kiosk' => true,
            'typ' => 'kiosk',
        ]);

        (new AuditService())->log(
            null,
            'KIOSK_AUTH',
            'employee_credential',
            (string) $cred['id'],
            $this->request->getIPAddress(),
            null,
            ['employeeCode' => $employeeCode]
        );

        return $this->respond([
            'accessToken' => $accessToken,
            'employee' => [
                'id' => (int) $emp['id'],
                'name' => (string) $emp['name'],
                'employeeCode' => (string) $cred['employee_code'],
            ],
        ]);
    }

    private function isLocked($lockedUntil): bool
    {
        if (!$lockedUntil) {
            return false;
        }
        return strtotime((string) $lockedUntil) > time();
    }
}

