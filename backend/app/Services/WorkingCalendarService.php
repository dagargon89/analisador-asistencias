<?php

declare(strict_types=1);

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use DateInterval;
use DatePeriod;
use DateTimeImmutable;

/**
 * Fuente única de verdad para el calendario laboral del sistema.
 *
 * Centraliza:
 *  - Cálculo de días hábiles (lunes a viernes) en un rango ISO inclusivo.
 *  - Carga de días inhábiles (tabla calendar_non_working_days).
 *  - Conjunto efectivo de días laborables (hábiles menos inhábiles).
 *
 * Los servicios de dominio deben delegar aquí en lugar de duplicar la lógica.
 */
class WorkingCalendarService
{
    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * Días yyyy-mm-dd de lunes a viernes en [from, to] inclusive.
     *
     * @return list<string>
     */
    public static function listWeekdays(string $from, string $to): array
    {
        $start = new DateTimeImmutable($from);
        $end = (new DateTimeImmutable($to))->add(new DateInterval('P1D'));
        $out = [];
        foreach (new DatePeriod($start, new DateInterval('P1D'), $end) as $date) {
            $dow = (int) $date->format('N');
            if ($dow >= 1 && $dow <= 5) {
                $out[] = $date->format('Y-m-d');
            }
        }

        return $out;
    }

    /**
     * Mapa de días inhábiles registrados (calendar_non_working_days) en el rango.
     *
     * @return array<string, true>
     */
    public function loadBlockedDates(string $from, string $to): array
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
            $out[(string) $row['calendar_date']] = true;
        }

        return $out;
    }

    /**
     * Días laborables efectivos: hábiles del rango menos inhábiles configurados.
     *
     * @return list<string>
     */
    public function workingDays(string $from, string $to): array
    {
        $weekdays = self::listWeekdays($from, $to);
        $blocked = $this->loadBlockedDates($from, $to);

        return array_values(array_filter($weekdays, static fn(string $d): bool => !isset($blocked[$d])));
    }
}
