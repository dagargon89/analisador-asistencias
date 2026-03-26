<?php

namespace App\Services;

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

