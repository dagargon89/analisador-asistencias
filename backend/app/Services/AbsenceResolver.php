<?php

declare(strict_types=1);

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use DateInterval;
use DatePeriod;
use DateTimeImmutable;

/**
 * Resolvedor de estado diario por empleado, con cinco estados tipificados.
 * Versión tipificada de AbsenceExpectationService.
 */
class AbsenceResolver
{
    public const DEFINITION_ID = 'weekdays_typed_absences_v1';

    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * @param list<array{id:int,name:string,hire_date:?string,termination_date:?string}>|null $employees
     *
     * @return array{
     *   days: list<array{employee_id:int,employee:string,date:string,state:string,absence_type?:string,absence_id?:int}>,
     *   summary: array{
     *     expected:int, present:int, justifiedWorked:int, justifiedUnpaid:int, unjustified:int
     *   },
     *   meta: array{definition:string, from:string, to:string}
     * }
     */
    public function resolveRange(string $from, string $to, ?array $employees = null): array
    {
        $weekdays = $this->listWeekdays($from, $to);
        $blocked = $this->loadBlockedDates($from, $to);
        $workdays = array_values(array_filter($weekdays, static fn(string $d): bool => !isset($blocked[$d])));

        $employees ??= $this->loadActiveEmployees();
        $present = $this->loadPresentSet($from, $to);
        $approvedAbsences = $this->loadApprovedAbsencesByEmployee($from, $to);

        $days = [];
        $counters = ['expected' => 0, 'present' => 0, 'justifiedWorked' => 0, 'justifiedUnpaid' => 0, 'unjustified' => 0];

        foreach ($employees as $emp) {
            $id = (int) $emp['id'];
            $hire = $emp['hire_date'] ?? null;
            $term = $emp['termination_date'] ?? null;

            foreach ($workdays as $day) {
                if ($hire !== null && $day < $hire) {
                    continue;
                }
                if ($term !== null && $day > $term) {
                    continue;
                }

                $counters['expected']++;
                $key = $id . '|' . $day;

                if (isset($present[$key])) {
                    $counters['present']++;
                    $days[] = [
                        'employee_id' => $id,
                        'employee' => (string) $emp['name'],
                        'date' => $day,
                        'state' => AttendanceDayState::Present->value,
                    ];
                    continue;
                }

                $match = $this->matchAbsence($approvedAbsences[$id] ?? [], $day);
                if ($match !== null) {
                    $state = ((int) $match['counts_as_worked_day']) === 1
                        ? AttendanceDayState::JustifiedWorked
                        : AttendanceDayState::JustifiedUnpaid;
                    $counterKey = $state === AttendanceDayState::JustifiedWorked ? 'justifiedWorked' : 'justifiedUnpaid';
                    $counters[$counterKey]++;
                    $days[] = [
                        'employee_id' => $id,
                        'employee' => (string) $emp['name'],
                        'date' => $day,
                        'state' => $state->value,
                        'absence_type' => (string) $match['type_code'],
                        'absence_id' => (int) $match['id'],
                    ];
                    continue;
                }

                $counters['unjustified']++;
                $days[] = [
                    'employee_id' => $id,
                    'employee' => (string) $emp['name'],
                    'date' => $day,
                    'state' => AttendanceDayState::UnjustifiedAbsence->value,
                ];
            }
        }

        usort($days, static function (array $a, array $b): int {
            $c = strcmp($a['date'], $b['date']);
            return $c !== 0 ? $c : strcmp($a['employee'], $b['employee']);
        });

        return [
            'days' => $days,
            'summary' => $counters,
            'meta' => ['definition' => self::DEFINITION_ID, 'from' => $from, 'to' => $to],
        ];
    }

    /**
     * Índice de ausencias aprobadas por empleado (expuesto para reuso desde
     * AbsenceExpectationService sin duplicar lógica).
     *
     * @return array<int, list<array<string,mixed>>>
     */
    public function loadApprovedAbsencesIndexedByEmployee(string $from, string $to): array
    {
        return $this->loadApprovedAbsencesByEmployee($from, $to);
    }

    /**
     * Determina si una fecha cae dentro de alguna ausencia del set.
     *
     * @param list<array<string,mixed>> $absences
     */
    public function dayInAnyAbsence(array $absences, string $day): bool
    {
        return $this->matchAbsence($absences, $day) !== null;
    }

    /** @return list<string> */
    public function listWeekdays(string $from, string $to): array
    {
        $start = new DateTimeImmutable($from);
        $end = (new DateTimeImmutable($to))->add(new DateInterval('P1D'));
        $out = [];
        foreach (new DatePeriod($start, new DateInterval('P1D'), $end) as $d) {
            $n = (int) $d->format('N');
            if ($n >= 1 && $n <= 5) {
                $out[] = $d->format('Y-m-d');
            }
        }
        return $out;
    }

    /** @return list<array{id:int,name:string,hire_date:?string,termination_date:?string}> */
    private function loadActiveEmployees(): array
    {
        $rows = $this->db->table('employees')
            ->select('id, name, hire_date, termination_date')
            ->where('is_active', 1)
            ->orderBy('name', 'ASC')
            ->get()->getResultArray();

        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'name' => (string) $r['name'],
            'hire_date' => $r['hire_date'] ?: null,
            'termination_date' => $r['termination_date'] ?: null,
        ], $rows);
    }

    /** @return array<string, true> */
    private function loadBlockedDates(string $from, string $to): array
    {
        if (!$this->db->tableExists('calendar_non_working_days')) {
            return [];
        }
        $rows = $this->db->table('calendar_non_working_days')
            ->select('calendar_date')
            ->where('calendar_date >=', $from)
            ->where('calendar_date <=', $to)
            ->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['calendar_date']] = true;
        }
        return $out;
    }

    /** @return array<string, true> */
    private function loadPresentSet(string $from, string $to): array
    {
        $rows = $this->db->table('attendance_records')
            ->select('employee_id, work_date')
            ->distinct()
            ->where('work_date >=', $from)
            ->where('work_date <=', $to)
            ->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[((int) $r['employee_id']) . '|' . ((string) $r['work_date'])] = true;
        }
        return $out;
    }

    /** @return array<int, list<array<string,mixed>>> */
    private function loadApprovedAbsencesByEmployee(string $from, string $to): array
    {
        if (!$this->db->tableExists('employee_absences') || !$this->db->tableExists('absence_types')) {
            return [];
        }

        $rows = $this->db->table('employee_absences ea')
            ->select('ea.id, ea.employee_id, ea.start_date, ea.end_date, at.code AS type_code, at.counts_as_worked_day')
            ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
            ->where('ea.status', 'approved')
            ->where('ea.start_date <=', $to)
            ->where('ea.end_date >=', $from)
            ->get()->getResultArray();

        $byEmp = [];
        foreach ($rows as $r) {
            $eid = (int) $r['employee_id'];
            $byEmp[$eid] ??= [];
            $byEmp[$eid][] = $r;
        }
        return $byEmp;
    }

    /**
     * @param list<array<string,mixed>> $absences
     *
     * @return array<string,mixed>|null
     */
    private function matchAbsence(array $absences, string $day): ?array
    {
        foreach ($absences as $a) {
            if ($day >= (string) $a['start_date'] && $day <= (string) $a['end_date']) {
                return $a;
            }
        }
        return null;
    }
}
