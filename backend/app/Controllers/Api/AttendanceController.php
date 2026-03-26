<?php

namespace App\Controllers\Api;

use DateInterval;
use DatePeriod;
use DateTimeImmutable;
use Throwable;

class AttendanceController extends BaseApiController
{
    public function records()
    {
        try {
            [$from, $to] = $this->resolveRange();
            $employee = trim((string) $this->request->getGet('employee'));

            $builder = db_connect()->table('attendance_records ar')
                ->select('ar.id, e.name AS employee, ar.work_date AS date, ar.check_in_time, ar.check_out_time, ar.hours_worked')
                ->join('employees e', 'e.id = ar.employee_id', 'inner')
                ->where('ar.work_date >=', $from)
                ->where('ar.work_date <=', $to)
                ->orderBy('ar.work_date', 'ASC')
                ->orderBy('e.name', 'ASC');

            if ($employee !== '' && $employee !== 'all') {
                $builder->where('e.name', $employee);
            }

            $rows = $builder->get()->getResultArray();
            $records = array_map(static fn($r) => [
                'id' => (int) $r['id'],
                'employee' => (string) $r['employee'],
                'date' => (string) $r['date'],
                'entry' => substr((string) $r['check_in_time'], 0, 5),
                'exit' => $r['check_out_time'] ? substr((string) $r['check_out_time'], 0, 5) : '',
                'hoursWorked' => (float) $r['hours_worked'],
            ], $rows);

            return $this->respond([
                'records' => $records,
                'period' => ['from' => $from, 'to' => $to],
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron cargar registros: ' . $e->getMessage());
        }
    }

    public function summary()
    {
        try {
            [$from, $to] = $this->resolveRange();
            $employee = trim((string) $this->request->getGet('employee'));

            $rows = $this->queryAttendanceRows($from, $to, $employee);
            $total = count($rows);
            $onTime = 0;
            $late = 0;
            $veryLate = 0;
            $totalHours = 0.0;

            foreach ($rows as $row) {
                $status = (string) $row['status'];
                if ($status === 'ontime') {
                    $onTime++;
                } elseif ($status === 'late') {
                    $late++;
                } else {
                    $veryLate++;
                }
                $totalHours += (float) $row['hours_worked'];
            }

            return $this->respond([
                'summary' => [
                    'total' => $total,
                    'onTime' => $onTime,
                    'late' => $late,
                    'veryLate' => $veryLate,
                    'totalHours' => round($totalHours, 2),
                    'avgHours' => $total > 0 ? round($totalHours / $total, 2) : 0,
                ],
                'period' => ['from' => $from, 'to' => $to],
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo calcular el resumen: ' . $e->getMessage());
        }
    }

    public function incidents()
    {
        try {
            [$from, $to] = $this->resolveRange();
            $employee = trim((string) $this->request->getGet('employee'));

            $builder = db_connect()->table('attendance_records ar')
                ->select('e.name AS employee, ar.work_date AS date, ar.check_in_time, ar.status')
                ->join('employees e', 'e.id = ar.employee_id', 'inner')
                ->whereIn('ar.status', ['late', 'verylate'])
                ->where('ar.work_date >=', $from)
                ->where('ar.work_date <=', $to)
                ->orderBy('ar.work_date', 'ASC')
                ->orderBy('e.name', 'ASC');

            if ($employee !== '' && $employee !== 'all') {
                $builder->where('e.name', $employee);
            }

            $rows = $builder->get()->getResultArray();
            return $this->respond([
                'incidents' => array_map(static fn($r) => [
                    'employee' => (string) $r['employee'],
                    'date' => (string) $r['date'],
                    'entry' => substr((string) $r['check_in_time'], 0, 5),
                    'type' => $r['status'] === 'late' ? 'Retardo' : 'Retardo Mayor',
                ], $rows),
                'period' => ['from' => $from, 'to' => $to],
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron cargar incidencias: ' . $e->getMessage());
        }
    }

    public function absences()
    {
        try {
            [$from, $to] = $this->resolveRange();
            $employee = trim((string) $this->request->getGet('employee'));
            $db = db_connect();

            $employeesBuilder = $db->table('employees')->select('id, name')->orderBy('name', 'ASC');
            if ($employee !== '' && $employee !== 'all') {
                $employeesBuilder->where('name', $employee);
            }
            $employees = $employeesBuilder->get()->getResultArray();

            $attendanceRows = $this->queryAttendanceRows($from, $to, $employee);
            $presentMap = [];
            foreach ($attendanceRows as $row) {
                $presentMap[$row['employee_id'] . '|' . $row['work_date']] = true;
            }

            $workdays = $this->workingDays($from, $to);
            $absences = [];
            foreach ($employees as $emp) {
                foreach ($workdays as $day) {
                    if (!isset($presentMap[$emp['id'] . '|' . $day])) {
                        $absences[] = [
                            'employee' => (string) $emp['name'],
                            'date' => $day,
                        ];
                    }
                }
            }

            return $this->respond([
                'absences' => $absences,
                'period' => ['from' => $from, 'to' => $to],
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron calcular inasistencias: ' . $e->getMessage());
        }
    }

    private function resolveRange(): array
    {
        $db = db_connect();
        $from = (string) $this->request->getGet('from');
        $to = (string) $this->request->getGet('to');

        if ($this->isDate($from) && $this->isDate($to)) {
            return [$from, $to];
        }

        $row = $db->table('attendance_records')
            ->select('MIN(work_date) AS min_date, MAX(work_date) AS max_date')
            ->get()
            ->getRowArray();

        if (!is_array($row) || !$row['min_date'] || !$row['max_date']) {
            $today = date('Y-m-d');
            return [$today, $today];
        }

        return [(string) $row['min_date'], (string) $row['max_date']];
    }

    private function isDate(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value);
    }

    private function queryAttendanceRows(string $from, string $to, string $employee): array
    {
        $builder = db_connect()->table('attendance_records')
            ->select('attendance_records.*, employees.name AS employee_name')
            ->join('employees', 'employees.id = attendance_records.employee_id', 'inner')
            ->where('attendance_records.work_date >=', $from)
            ->where('attendance_records.work_date <=', $to);

        if ($employee !== '' && $employee !== 'all') {
            $builder->where('employees.name', $employee);
        }

        return $builder->get()->getResultArray();
    }

    private function workingDays(string $from, string $to): array
    {
        $start = new DateTimeImmutable($from);
        $end = (new DateTimeImmutable($to))->add(new DateInterval('P1D'));
        $period = new DatePeriod($start, new DateInterval('P1D'), $end);
        $days = [];
        foreach ($period as $date) {
            $dow = (int) $date->format('N');
            if ($dow >= 1 && $dow <= 5) {
                $days[] = $date->format('Y-m-d');
            }
        }
        return $days;
    }
}

