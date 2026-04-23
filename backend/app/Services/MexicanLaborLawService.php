<?php

declare(strict_types=1);

namespace App\Services;

use DateTimeImmutable;

/**
 * Cálculo LFT reforma 2023 (vigente desde ene-2023).
 * Tabla oficial: art. 76 LFT.
 */
class MexicanLaborLawService
{
    /**
     * Devuelve días de vacaciones y prima vacacional (días) para una antigüedad dada.
     * Prima vacacional = 25% del salario correspondiente a los días de vacaciones.
     * Aquí se devuelve el equivalente en días (para usar en cálculos internos); el monto
     * monetario se calcula en el motor de nómina externo.
     *
     * @return array{vacationDays:int, primaVacationalDays:float}
     */
    public static function entitlementFor(int $yearsOfService): array
    {
        $years = max(0, $yearsOfService);

        $table = [
            1 => 12, 2 => 14, 3 => 16, 4 => 18, 5 => 20,
        ];

        if ($years === 0) {
            $vac = 0;
        } elseif ($years <= 5) {
            $vac = $table[$years];
        } elseif ($years <= 10) {
            $vac = 22;
        } elseif ($years <= 15) {
            $vac = 24;
        } elseif ($years <= 20) {
            $vac = 26;
        } elseif ($years <= 25) {
            $vac = 28;
        } elseif ($years <= 30) {
            $vac = 30;
        } else {
            $vac = 32;
        }

        $prima = round($vac * 0.25, 2);
        return ['vacationDays' => $vac, 'primaVacationalDays' => $prima];
    }

    public static function yearsOfServiceAt(string $hireDate, string $referenceDate): int
    {
        $h = new DateTimeImmutable($hireDate);
        $r = new DateTimeImmutable($referenceDate);
        return (int) $h->diff($r)->y;
    }

    /**
     * Rango del año aniversario vigente en una fecha de referencia.
     *
     * @return array{start:string, end:string}
     */
    public static function anniversaryYearRange(string $hireDate, string $referenceDate): array
    {
        $h = new DateTimeImmutable($hireDate);
        $r = new DateTimeImmutable($referenceDate);
        $years = (int) $h->diff($r)->y;
        $start = $h->modify("+{$years} years");
        $next = $h->modify('+' . ($years + 1) . ' years');
        return ['start' => $start->format('Y-m-d'), 'end' => $next->modify('-1 day')->format('Y-m-d')];
    }
}
