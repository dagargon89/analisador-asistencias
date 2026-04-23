<?php

use App\Services\AbsenceExpectationService;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * @internal
 */
final class AbsenceExpectationServiceTest extends CIUnitTestCase
{
    public function testListWeekdaysBetweenSkipsWeekend(): void
    {
        $days = AbsenceExpectationService::listWeekdaysBetween('2026-04-20', '2026-04-26');
        $this->assertSame(['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24'], $days);
    }

    public function testListWeekdaysSingleMonday(): void
    {
        $days = AbsenceExpectationService::listWeekdaysBetween('2026-04-20', '2026-04-20');
        $this->assertSame(['2026-04-20'], $days);
    }
}
