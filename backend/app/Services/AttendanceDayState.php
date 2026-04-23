<?php

declare(strict_types=1);

namespace App\Services;

enum AttendanceDayState: string
{
    case NotExpected = 'NOT_EXPECTED';
    case Present = 'PRESENT';
    case JustifiedWorked = 'JUSTIFIED_WORKED';
    case JustifiedUnpaid = 'JUSTIFIED_UNPAID';
    case UnjustifiedAbsence = 'UNJUSTIFIED_ABSENCE';

    public function countsAsAbsence(): bool
    {
        return $this === self::UnjustifiedAbsence;
    }

    public function countsAsWorkedDay(): bool
    {
        return $this === self::Present || $this === self::JustifiedWorked;
    }
}
