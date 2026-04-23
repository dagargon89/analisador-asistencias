<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\PayrollPeriodModel;
use CodeIgniter\Database\BaseConnection;
use RuntimeException;

class PayrollReportService
{
    public function __construct(
        private ?BaseConnection $db = null,
        private ?AbsenceResolver $resolver = null,
    ) {
        $this->db = $db ?? db_connect();
        $this->resolver = $resolver ?? new AbsenceResolver($this->db);
    }

    /**
     * Construye el reporte quincenal para un periodo.
     *
     * @return array{
     *   period: array<string,mixed>,
     *   rows: list<array<string,mixed>>,
     *   totals: array<string,int|float>
     * }
     */
    public function buildForPeriod(int $periodId): array
    {
        $period = model(PayrollPeriodModel::class)->find($periodId);
        if (!$period) {
            throw new RuntimeException("Periodo #{$periodId} no encontrado");
        }
        $start = (string) $period['start_date'];
        $end = (string) $period['end_date'];

        $employees = $this->loadEligibleEmployees($start, $end);
        $expectedDays = count($this->resolver->listWeekdays($start, $end));

        $resolved = $this->resolver->resolveRange($start, $end, array_map(
            static fn(array $e): array => [
                'id' => $e['id'],
                'name' => $e['name'],
                'hire_date' => $e['hire_date'],
                'termination_date' => $e['termination_date'],
            ],
            $employees,
        ));

        $byEmployee = [];
        foreach ($resolved['days'] as $d) {
            $eid = (int) $d['employee_id'];
            $byEmployee[$eid] ??= [];
            $byEmployee[$eid][] = $d;
        }

        $rows = [];
        $totals = [
            'employees' => 0,
            'days_worked' => 0,
            'vacation_days' => 0,
            'leave_days' => 0,
            'unjustified_absences' => 0,
        ];

        foreach ($employees as $emp) {
            $vacationDays = 0;
            $leaveDays = 0;
            $unjustified = 0;
            $justifiedUnpaid = 0;
            $present = 0;

            $daysForEmp = $byEmployee[$emp['id']] ?? [];
            foreach ($daysForEmp as $d) {
                $state = (string) $d['state'];
                $type = isset($d['absence_type']) ? (string) $d['absence_type'] : '';
                if ($state === 'PRESENT') {
                    $present++;
                } elseif ($state === 'JUSTIFIED_WORKED') {
                    if ($type === 'VAC') {
                        $vacationDays++;
                    } else {
                        $leaveDays++;
                    }
                } elseif ($state === 'JUSTIFIED_UNPAID') {
                    $justifiedUnpaid++;
                } elseif ($state === 'UNJUSTIFIED_ABSENCE') {
                    $unjustified++;
                }
            }

            $daysWorked = max(0, $expectedDays - $unjustified - $justifiedUnpaid);

            $obs = [];
            if ($vacationDays > 0) {
                $obs[] = "{$vacationDays} día(s) de vacaciones";
            }
            if ($leaveDays > 0) {
                $obs[] = "{$leaveDays} día(s) justificado(s)";
            }
            if ($unjustified > 0) {
                $obs[] = "{$unjustified} inasistencia(s)";
            }
            if ($justifiedUnpaid > 0) {
                $obs[] = "{$justifiedUnpaid} día(s) sin goce";
            }

            $rows[] = [
                'employee_id' => (int) $emp['id'],
                'employee_name' => (string) $emp['name'],
                'employee_code' => (string) ($emp['employee_code'] ?? ''),
                'hire_date' => $emp['hire_date'],
                'department' => '',
                'days_worked' => $daysWorked,
                'vacation_days' => $vacationDays,
                'leave_days' => $leaveDays,
                'unjustified_absences' => $unjustified,
                'justified_unpaid_days' => $justifiedUnpaid,
                'present_days' => $present,
                'observations' => implode(', ', $obs),
            ];

            $totals['employees']++;
            $totals['days_worked'] += $daysWorked;
            $totals['vacation_days'] += $vacationDays;
            $totals['leave_days'] += $leaveDays;
            $totals['unjustified_absences'] += $unjustified;
        }

        usort($rows, static fn(array $a, array $b): int => strcmp((string) $a['employee_name'], (string) $b['employee_name']));

        return [
            'period' => $period,
            'rows' => $rows,
            'totals' => $totals,
        ];
    }

    /** @return list<array{id:int,name:string,hire_date:?string,termination_date:?string,employee_code:?string}> */
    private function loadEligibleEmployees(string $start, string $end): array
    {
        $rows = $this->db->table('employees')
            ->select('id, name, hire_date, termination_date, employee_code')
            ->where('is_active', 1)
            ->orderBy('name', 'ASC')
            ->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $hire = $r['hire_date'] ?: null;
            $term = $r['termination_date'] ?: null;
            if ($hire !== null && (string) $hire > $end) {
                continue;
            }
            if ($term !== null && (string) $term < $start) {
                continue;
            }
            $out[] = [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'hire_date' => $hire,
                'termination_date' => $term,
                'employee_code' => $r['employee_code'] ?: null,
            ];
        }
        return $out;
    }
}
