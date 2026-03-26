<?php

namespace App\Services;

use App\Models\AttendancePunchModel;
use App\Models\AttendanceRecordModel;
use RuntimeException;

class ClockService
{
    public function clockIn(int $employeeId, string $source, ?int $actorUserId = null, ?string $deviceId = null): array
    {
        $now = new \DateTimeImmutable('now');
        $date = $now->format('Y-m-d');
        $time = $now->format('H:i:s');

        $recordModel = model(AttendanceRecordModel::class);
        $punchModel = model(AttendancePunchModel::class);
        $cfg = model(\App\Models\AppConfigModel::class)->where('is_active', 1)->orderBy('id', 'DESC')->first();
        $entry = (string) ($cfg['entry_time'] ?? '08:30:00');
        $tol = (int) ($cfg['tolerance_minutes'] ?? 10);
        $late = (int) ($cfg['late_threshold_minutes'] ?? 30);
        $status = AttendanceClassifier::classify($time, $entry, $tol, $late);

        $open = $recordModel->where('employee_id', $employeeId)
            ->where('work_date', $date)
            ->groupStart()
            ->where('check_out_time', null)
            ->orWhere('check_out_time', '00:00:00')
            ->groupEnd()
            ->orderBy('id', 'DESC')
            ->first();
        if (is_array($open)) {
            throw new RuntimeException('Ya existe una entrada abierta para este empleado.');
        }

        $recordId = $recordModel->insert([
            'employee_id' => $employeeId,
            'work_date' => $date,
            'check_in_time' => $time,
            'check_out_time' => null,
            'hours_worked' => 0,
            'status' => $status,
            'data_source' => $source,
        ], true);

        $punchId = $punchModel->insert([
            'employee_id' => $employeeId,
            'attendance_record_id' => $recordId,
            'punch_type' => 'IN',
            'punched_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'device_id' => $deviceId,
            'created_by_user_id' => $actorUserId,
        ], true);

        $recordModel->update($recordId, ['first_punch_id' => $punchId, 'last_punch_id' => $punchId]);

        return [
            'attendanceRecordId' => (int) $recordId,
            'punchId' => (int) $punchId,
            'date' => $date,
            'entry' => substr($time, 0, 5),
            'status' => $status,
        ];
    }

    public function clockOut(int $employeeId, string $source, ?int $actorUserId = null, ?string $deviceId = null): array
    {
        $now = new \DateTimeImmutable('now');
        $recordModel = model(AttendanceRecordModel::class);
        $punchModel = model(AttendancePunchModel::class);

        $open = $recordModel->where('employee_id', $employeeId)
            ->groupStart()
            ->where('check_out_time', null)
            ->orWhere('check_out_time', '00:00:00')
            ->groupEnd()
            ->orderBy('id', 'DESC')
            ->first();
        if (!is_array($open)) {
            throw new RuntimeException('No existe una entrada abierta para cerrar.');
        }

        $inDateTime = new \DateTimeImmutable((string) $open['work_date'] . ' ' . (string) $open['check_in_time']);
        $hours = max(0, round(($now->getTimestamp() - $inDateTime->getTimestamp()) / 3600, 2));
        $outTime = $now->format('H:i:s');

        $punchId = $punchModel->insert([
            'employee_id' => $employeeId,
            'attendance_record_id' => (int) $open['id'],
            'punch_type' => 'OUT',
            'punched_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'device_id' => $deviceId,
            'created_by_user_id' => $actorUserId,
        ], true);

        $recordModel->update((int) $open['id'], [
            'check_out_time' => $outTime,
            'hours_worked' => $hours,
            'last_punch_id' => $punchId,
            'closed_at' => $now->format('Y-m-d H:i:s'),
        ]);

        return [
            'attendanceRecordId' => (int) $open['id'],
            'punchId' => (int) $punchId,
            'date' => (string) $open['work_date'],
            'entry' => substr((string) $open['check_in_time'], 0, 5),
            'exit' => substr($outTime, 0, 5),
            'hoursWorked' => $hours,
            'status' => (string) $open['status'],
        ];
    }
}

