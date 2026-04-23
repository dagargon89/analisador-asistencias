<?php

declare(strict_types=1);

use App\Services\AbsenceResolver;
use App\Services\AttendanceDayState;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * @internal
 */
final class AbsenceResolverTest extends CIUnitTestCase
{
    public function testListWeekdaysSkipsWeekend(): void
    {
        $resolver = new AbsenceResolver();
        $days = $resolver->listWeekdays('2026-04-01', '2026-04-10');
        $this->assertSame(
            ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'],
            $days,
        );
    }

    public function testListWeekdaysSingleFriday(): void
    {
        $resolver = new AbsenceResolver();
        $this->assertSame(['2026-04-03'], $resolver->listWeekdays('2026-04-03', '2026-04-03'));
    }

    public function testListWeekdaysSingleSaturdayIsEmpty(): void
    {
        $resolver = new AbsenceResolver();
        $this->assertSame([], $resolver->listWeekdays('2026-04-04', '2026-04-04'));
    }

    public function testDayInAnyAbsenceMatchesInclusiveRange(): void
    {
        $resolver = new AbsenceResolver();
        $absences = [[
            'id' => 1,
            'employee_id' => 10,
            'start_date' => '2026-04-06',
            'end_date' => '2026-04-10',
            'type_code' => 'VAC',
            'counts_as_worked_day' => 1,
        ]];

        $this->assertTrue($resolver->dayInAnyAbsence($absences, '2026-04-06'));
        $this->assertTrue($resolver->dayInAnyAbsence($absences, '2026-04-08'));
        $this->assertTrue($resolver->dayInAnyAbsence($absences, '2026-04-10'));
        $this->assertFalse($resolver->dayInAnyAbsence($absences, '2026-04-05'));
        $this->assertFalse($resolver->dayInAnyAbsence($absences, '2026-04-11'));
    }

    public function testEnumCountsAsAbsenceOnlyForUnjustified(): void
    {
        $this->assertTrue(AttendanceDayState::UnjustifiedAbsence->countsAsAbsence());
        $this->assertFalse(AttendanceDayState::JustifiedWorked->countsAsAbsence());
        $this->assertFalse(AttendanceDayState::JustifiedUnpaid->countsAsAbsence());
        $this->assertFalse(AttendanceDayState::Present->countsAsAbsence());
        $this->assertFalse(AttendanceDayState::NotExpected->countsAsAbsence());
    }

    public function testEnumCountsAsWorkedDayForPresentAndJustifiedWorked(): void
    {
        $this->assertTrue(AttendanceDayState::Present->countsAsWorkedDay());
        $this->assertTrue(AttendanceDayState::JustifiedWorked->countsAsWorkedDay());
        $this->assertFalse(AttendanceDayState::JustifiedUnpaid->countsAsWorkedDay());
        $this->assertFalse(AttendanceDayState::UnjustifiedAbsence->countsAsWorkedDay());
    }
}
