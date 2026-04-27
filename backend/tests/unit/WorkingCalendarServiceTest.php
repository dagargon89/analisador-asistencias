<?php

declare(strict_types=1);

use App\Services\WorkingCalendarService;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * @internal
 */
final class WorkingCalendarServiceTest extends CIUnitTestCase
{
    public function testListWeekdaysSkipsWeekend(): void
    {
        $days = WorkingCalendarService::listWeekdays('2026-04-01', '2026-04-10');
        $this->assertSame(
            ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'],
            $days,
        );
    }

    public function testListWeekdaysSingleFridayInclusive(): void
    {
        $this->assertSame(['2026-04-03'], WorkingCalendarService::listWeekdays('2026-04-03', '2026-04-03'));
    }

    public function testListWeekdaysSingleSaturdayIsEmpty(): void
    {
        $this->assertSame([], WorkingCalendarService::listWeekdays('2026-04-04', '2026-04-04'));
    }
}
