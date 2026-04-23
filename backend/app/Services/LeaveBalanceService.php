<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use CodeIgniter\Database\BaseConnection;
use DateTimeImmutable;

class LeaveBalanceService
{
    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * Calcula y persiste el saldo para el año aniversario vigente del empleado.
     * Idempotente: si ya existe, lo actualiza; si no, lo crea.
     *
     * @return array<string,mixed>|null
     */
    public function recalculateForEmployee(int $employeeId, ?string $asOf = null): ?array
    {
        $asOf ??= (new DateTimeImmutable())->format('Y-m-d');
        $emp = model(EmployeeModel::class)->find($employeeId);
        if (!$emp || empty($emp['hire_date'])) {
            return null;
        }

        $hire = (string) $emp['hire_date'];
        $years = MexicanLaborLawService::yearsOfServiceAt($hire, $asOf);
        $ent = MexicanLaborLawService::entitlementFor($years);
        $range = MexicanLaborLawService::anniversaryYearRange($hire, $asOf);

        $used = $this->sumUsedVacationDays($employeeId, $range['start'], $range['end']);
        $anniversaryYear = (int) (new DateTimeImmutable($range['start']))->format('Y');

        $row = [
            'employee_id' => $employeeId,
            'anniversary_year' => $anniversaryYear,
            'years_of_service' => $years,
            'entitled_days' => $ent['vacationDays'],
            'used_days' => $used,
            'prima_vacacional_days' => $ent['primaVacationalDays'],
            'period_start' => $range['start'],
            'period_end' => $range['end'],
            'expiration_date' => (new DateTimeImmutable($range['end']))->modify('+18 months')->format('Y-m-d'),
        ];

        $existing = $this->db->table('employee_leave_balances')
            ->where('employee_id', $employeeId)
            ->where('anniversary_year', $anniversaryYear)
            ->get()->getFirstRow('array');

        if ($existing) {
            $this->db->table('employee_leave_balances')
                ->where('id', (int) $existing['id'])
                ->update($row + ['updated_at' => date('Y-m-d H:i:s')]);
            $row['id'] = (int) $existing['id'];
        } else {
            $this->db->table('employee_leave_balances')->insert($row + [
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $row['id'] = (int) $this->db->insertID();
        }

        $row['available_days'] = max(0.0, (float) $row['entitled_days'] + (float) ($row['carried_over_days'] ?? 0) - (float) $row['used_days']);
        return $row;
    }

    public function recalculateAll(?string $asOf = null): int
    {
        $rows = $this->db->table('employees')
            ->select('id')
            ->where('is_active', 1)
            ->where('hire_date IS NOT NULL')
            ->get()->getResultArray();

        $n = 0;
        foreach ($rows as $r) {
            if ($this->recalculateForEmployee((int) $r['id'], $asOf) !== null) {
                $n++;
            }
        }
        return $n;
    }

    /**
     * Obtiene el saldo vigente (rango que contiene $asOf) para un empleado,
     * recalculándolo primero para garantizar idempotencia.
     *
     * @return array<string,mixed>|null
     */
    public function getCurrentForEmployee(int $employeeId, ?string $asOf = null): ?array
    {
        return $this->recalculateForEmployee($employeeId, $asOf);
    }

    private function sumUsedVacationDays(int $employeeId, string $from, string $to): float
    {
        $rows = $this->db->table('employee_absences ea')
            ->select('ea.business_days')
            ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
            ->where('ea.employee_id', $employeeId)
            ->where('ea.status', EmployeeAbsenceModel::STATUS_APPROVED)
            ->where('at.affects_leave_balance', 1)
            ->where('ea.start_date >=', $from)
            ->where('ea.end_date <=', $to)
            ->get()->getResultArray();

        $total = 0.0;
        foreach ($rows as $r) {
            $total += (float) $r['business_days'];
        }
        return $total;
    }
}
