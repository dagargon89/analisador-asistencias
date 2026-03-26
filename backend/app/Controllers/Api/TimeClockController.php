<?php

namespace App\Controllers\Api;

use App\Services\AuditService;
use App\Services\ClockService;
use Throwable;

class TimeClockController extends BaseApiController
{
    public function clockIn()
    {
        return $this->clockAction('in');
    }

    public function clockOut()
    {
        return $this->clockAction('out');
    }

    public function meToday()
    {
        $payload = $this->jwtPayload();
        $employeeId = (int) ($payload['employee_id'] ?? 0);
        if ($employeeId <= 0) {
            return $this->failForbidden('El token no tiene employee_id.');
        }

        $today = date('Y-m-d');
        $record = model(\App\Models\AttendanceRecordModel::class)
            ->where('employee_id', $employeeId)
            ->where('work_date', $today)
            ->orderBy('id', 'DESC')
            ->first();

        return $this->respond([
            'today' => $record ? [
                'date' => (string) $record['work_date'],
                'entry' => $record['check_in_time'] ? substr((string) $record['check_in_time'], 0, 5) : '',
                'exit' => $record['check_out_time'] ? substr((string) $record['check_out_time'], 0, 5) : '',
                'hoursWorked' => (float) ($record['hours_worked'] ?? 0),
                'status' => (string) ($record['status'] ?? ''),
                'isOpen' => !$record['check_out_time'] || $record['check_out_time'] === '00:00:00',
            ] : null,
        ]);
    }

    private function clockAction(string $kind)
    {
        $payload = $this->jwtPayload();
        $body = $this->jsonBody();

        $role = (string) ($payload['role'] ?? '');
        $tokenEmployee = (int) ($payload['employee_id'] ?? 0);
        $employeeId = $tokenEmployee;

        // admins can clock for another employee
        if (in_array($role, ['admin', 'supervisor'], true) && isset($body['employeeId'])) {
            $employeeId = (int) $body['employeeId'];
        }

        if ($employeeId <= 0) {
            return $this->failValidationErrors('employeeId inválido.');
        }

        $source = ((bool) ($payload['kiosk'] ?? false)) ? 'kiosk' : 'web';
        $uid = isset($payload['sub']) ? (int) $payload['sub'] : null;
        $deviceId = isset($body['deviceId']) ? (string) $body['deviceId'] : null;

        try {
            $clock = new ClockService();
            $result = $kind === 'in'
                ? $clock->clockIn($employeeId, $source, $uid, $deviceId)
                : $clock->clockOut($employeeId, $source, $uid, $deviceId);

            (new AuditService())->log(
                $uid,
                $kind === 'in' ? 'CLOCK_IN' : 'CLOCK_OUT',
                'attendance_record',
                (string) $result['attendanceRecordId'],
                $this->request->getIPAddress(),
                null,
                ['employeeId' => $employeeId, 'source' => $source]
            );

            return $this->respond(['ok' => true, 'result' => $result]);
        } catch (Throwable $e) {
            return $this->fail('No se pudo registrar marcación: ' . $e->getMessage(), 400);
        }
    }
}

