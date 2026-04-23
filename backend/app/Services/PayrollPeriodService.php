<?php

declare(strict_types=1);

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use DateTimeImmutable;

class PayrollPeriodService
{
    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * Genera 24 periodos quincenales para un año (del 1 al 15 y del 16 al último día).
     * Idempotente: inserta solo los que faltan (unique key start/end/type).
     *
     * @return int Número de periodos insertados en esta ejecución.
     */
    public function generateBiweeklyForYear(int $year): int
    {
        $now = date('Y-m-d H:i:s');
        $inserted = 0;

        for ($month = 1; $month <= 12; $month++) {
            $firstStart = sprintf('%04d-%02d-01', $year, $month);
            $firstEnd = sprintf('%04d-%02d-15', $year, $month);
            $secondStart = sprintf('%04d-%02d-16', $year, $month);
            $lastDay = (int) (new DateTimeImmutable($firstStart))->format('t');
            $secondEnd = sprintf('%04d-%02d-%02d', $year, $month, $lastDay);

            $monthLabel = $this->spanishMonth($month);

            foreach ([
                [$firstStart, $firstEnd, "1ra {$monthLabel} {$year}", 15],
                [$secondStart, $secondEnd, "2da {$monthLabel} {$year}", $lastDay - 15],
            ] as [$start, $end, $label, $days]) {
                if ($this->exists($start, $end)) {
                    continue;
                }
                $this->db->table('payroll_periods')->insert([
                    'period_type' => 'biweekly',
                    'label' => $label,
                    'start_date' => $start,
                    'end_date' => $end,
                    'expected_calendar_days' => $days,
                    'status' => 'open',
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $inserted++;
            }
        }

        return $inserted;
    }

    private function exists(string $start, string $end): bool
    {
        $row = $this->db->table('payroll_periods')
            ->where('period_type', 'biweekly')
            ->where('start_date', $start)
            ->where('end_date', $end)
            ->get()->getFirstRow('array');
        return $row !== null;
    }

    private function spanishMonth(int $month): string
    {
        $map = [
            1 => 'Ene', 2 => 'Feb', 3 => 'Mar', 4 => 'Abr', 5 => 'May', 6 => 'Jun',
            7 => 'Jul', 8 => 'Ago', 9 => 'Sep', 10 => 'Oct', 11 => 'Nov', 12 => 'Dic',
        ];
        return $map[$month] ?? '';
    }
}
