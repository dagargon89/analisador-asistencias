<?php

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use DateInterval;
use DatePeriod;
use DateTimeImmutable;

/**
 * Motor único: días hábiles (lun–vie) sin inhábil de calendario, dentro del contrato
 * (hire_date / termination_date opcionales), sin ningún registro de asistencia ese día.
 *
 * Nota (Sprint 1 - Módulo Vacaciones/Ausencias): este servicio ahora también descuenta
 * días justificados por ausencias aprobadas (tabla employee_absences) antes de contarlos
 * como inasistencia. La firma pública de computeAbsences() se preserva intacta.
 */
class AbsenceExpectationService
{
    public const DEFINITION_ID = 'weekdays_active_calendar_contract_v1';

    public function __construct(
        private ?BaseConnection $db = null,
        private ?AbsenceResolver $resolver = null,
    ) {
        $this->db = $db ?? db_connect();
        $this->resolver = $resolver ?? new AbsenceResolver($this->db);
    }

    /**
     * Días yyyy-mm-dd de lunes a viernes en [from, to] inclusive.
     *
     * @return list<string>
     */
    public static function listWeekdaysBetween(string $from, string $to): array
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

    /**
     * @param string|null $employeeName null o '' o 'all' = todos los activos
     *
     * @return array{
     *   absences: list<array{employee: string, date: string}>,
     *   byEmployee: array<string, int>,
     *   meta: array{
     *     definition: string,
     *     weekdayDaysInRange: int,
     *     calendarDaysExcluded: int,
     *     workingDaysAfterCalendar: int,
     *     expectedAttendanceSlots: int,
     *     absenceSlots: int,
     *     justifiedSlots: int
     *   }
     * }
     */
    public function computeAbsences(string $from, string $to, ?string $employeeName = null): array
    {
        $weekdays = self::listWeekdaysBetween($from, $to);
        $blocked = $this->loadBlockedDates($from, $to);
        $workdays = array_values(array_filter($weekdays, static fn(string $d): bool => !isset($blocked[$d])));

        $empBuilder = $this->db->table('employees')
            ->select('id, name, hire_date, termination_date')
            ->where('is_active', 1)
            ->orderBy('name', 'ASC');

        $nameFilter = $this->normalizeEmployeeFilter($employeeName);
        if ($nameFilter !== null) {
            $empBuilder->where('name', $nameFilter);
        }

        $employees = $empBuilder->get()->getResultArray();
        $present = $this->loadPresentSet($from, $to, $nameFilter);
        $approvedByEmployee = $this->resolver->loadApprovedAbsencesIndexedByEmployee($from, $to);

        $absences = [];
        $byEmployee = [];
        $expectedSlots = 0;
        $justifiedSlots = 0;

        foreach ($employees as $emp) {
            $id = (int) $emp['id'];
            $name = (string) $emp['name'];
            $hire = isset($emp['hire_date']) && $emp['hire_date'] !== '' && $emp['hire_date'] !== null
                ? (string) $emp['hire_date'] : null;
            $term = isset($emp['termination_date']) && $emp['termination_date'] !== '' && $emp['termination_date'] !== null
                ? (string) $emp['termination_date'] : null;

            $empAbsences = $approvedByEmployee[$id] ?? [];

            foreach ($workdays as $day) {
                if ($hire !== null && $day < $hire) {
                    continue;
                }
                if ($term !== null && $day > $term) {
                    continue;
                }
                $expectedSlots++;
                $key = $id . '|' . $day;
                if (isset($present[$key])) {
                    continue;
                }
                if ($empAbsences !== [] && $this->resolver->dayInAnyAbsence($empAbsences, $day)) {
                    $justifiedSlots++;
                    continue;
                }
                $absences[] = ['employee' => $name, 'date' => $day];
                $byEmployee[$name] = ($byEmployee[$name] ?? 0) + 1;
            }
        }

        usort(
            $absences,
            static function (array $a, array $b): int {
                $c = strcmp($a['date'], $b['date']);
                if ($c !== 0) {
                    return $c;
                }

                return strcmp($a['employee'], $b['employee']);
            }
        );

        return [
            'absences' => $absences,
            'byEmployee' => $byEmployee,
            'meta' => [
                'definition' => self::DEFINITION_ID,
                'weekdayDaysInRange' => count($weekdays),
                'calendarDaysExcluded' => count($blocked),
                'workingDaysAfterCalendar' => count($workdays),
                'expectedAttendanceSlots' => $expectedSlots,
                'absenceSlots' => count($absences),
                'justifiedSlots' => $justifiedSlots,
            ],
        ];
    }

    /**
     * Versión tipificada (delegación al nuevo resolvedor).
     * No modifica el contrato de computeAbsences().
     *
     * @return array<string,mixed>
     */
    public function computeTypedAbsences(string $from, string $to, ?string $employeeName = null, ?int $organizationId = null): array
    {
        $filter = $this->normalizeEmployeeFilter($employeeName);

        $employees = null;
        if ($filter !== null) {
            $builder = $this->db->table('employees')
                ->select('id, name, hire_date, termination_date')
                ->where('is_active', 1)
                ->where('name', $filter);
            if ($organizationId !== null && $this->db->fieldExists('organization_id', 'employees')) {
                $builder->where('organization_id', $organizationId);
            }
            $row = $builder->get()->getFirstRow('array');
            $employees = $row ? [[
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
                'hire_date' => $row['hire_date'] ?: null,
                'termination_date' => $row['termination_date'] ?: null,
            ]] : [];
        }

        return $this->resolver->resolveRange($from, $to, $employees, $organizationId);
    }

    /**
     * @return array<string, true>
     */
    private function loadBlockedDates(string $from, string $to): array
    {
        if (!$this->db->tableExists('calendar_non_working_days')) {
            return [];
        }
        $rows = $this->db->table('calendar_non_working_days')
            ->select('calendar_date')
            ->where('calendar_date >=', $from)
            ->where('calendar_date <=', $to)
            ->get()
            ->getResultArray();

        $out = [];
        foreach ($rows as $row) {
            $d = (string) $row['calendar_date'];
            $out[$d] = true;
        }

        return $out;
    }

    /**
     * @return array<string, true> keys employee_id|work_date
     */
    private function loadPresentSet(string $from, string $to, ?string $employeeName): array
    {
        $builder = $this->db->table('attendance_records ar')
            ->select('ar.employee_id, ar.work_date')
            ->distinct()
            ->join('employees e', 'e.id = ar.employee_id', 'inner')
            ->where('ar.work_date >=', $from)
            ->where('ar.work_date <=', $to);

        if ($employeeName !== null) {
            $builder->where('e.name', $employeeName);
        }

        $rows = $builder->get()->getResultArray();
        $set = [];
        foreach ($rows as $row) {
            $set[(string) (int) $row['employee_id'] . '|' . (string) $row['work_date']] = true;
        }

        return $set;
    }

    private function normalizeEmployeeFilter(?string $employeeName): ?string
    {
        if ($employeeName === null) {
            return null;
        }
        $t = trim($employeeName);
        if ($t === '' || strtolower($t) === 'all') {
            return null;
        }

        return $t;
    }
}
