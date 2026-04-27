<?php

namespace App\Services;

/**
 * Fuente de verdad para la clasificación de entrada (ontime/late/verylate).
 *
 * Convive una versión espejo de previsualización en el frontend
 * (`src/App.tsx::classifyEntry`). Si esta regla cambia, debe actualizarse
 * primero aquí y replicarse en el frontend para mantener consistencia
 * entre lo que ve el usuario y lo que persiste el API.
 */
class AttendanceClassifier
{
    public static function classify(string $entryTime, string $scheduledEntry, int $toleranceMinutes, int $lateThresholdMinutes): string
    {
        $entry = self::toMinutes($entryTime);
        $scheduled = self::toMinutes($scheduledEntry);
        $diff = $entry - $scheduled;

        if ($diff <= $toleranceMinutes) {
            return 'ontime';
        }
        if ($diff <= $lateThresholdMinutes) {
            return 'late';
        }

        return 'verylate';
    }

    private static function toMinutes(string $time): int
    {
        $parts = explode(':', $time);
        $h = (int) ($parts[0] ?? 0);
        $m = (int) ($parts[1] ?? 0);
        return ($h * 60) + $m;
    }
}

