<?php

namespace App\Controllers\Api;

use App\Models\AppConfigModel;
use App\Models\LaborRulesConfigModel;
use Throwable;

class SettingsController extends BaseApiController
{
    public function show()
    {
        try {
            $schedule = $this->activeSchedule();
            $rules = $this->activeLaborRules();

            return $this->respond([
                'schedule' => $this->mapScheduleForApi($schedule),
                'laborRules' => $this->mapRulesForApi($rules),
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo cargar configuración: ' . $e->getMessage());
        }
    }

    public function update()
    {
        $body = $this->jsonBody();
        $schedulePayload = is_array($body['schedule'] ?? null) ? $body['schedule'] : null;
        $rulesPayload = is_array($body['laborRules'] ?? null) ? $body['laborRules'] : null;

        if ($schedulePayload === null && $rulesPayload === null) {
            return $this->failValidationErrors('Debe enviar schedule y/o laborRules.');
        }

        $db = db_connect();
        $db->transBegin();

        try {
            $response = [];

            if ($schedulePayload !== null) {
                $validatedSchedule = $this->validateSchedule($schedulePayload);
                $scheduleModel = model(AppConfigModel::class);
                $scheduleModel->where('is_active', 1)->set(['is_active' => 0])->update();
                $newId = $scheduleModel->insert([
                    'entry_time' => $this->normalizeTime((string) $validatedSchedule['entryTime']),
                    'exit_time' => $this->normalizeTime((string) $validatedSchedule['exitTime']),
                    'tolerance_minutes' => $validatedSchedule['toleranceMinutes'],
                    'late_threshold_minutes' => $validatedSchedule['lateThresholdMinutes'],
                    'working_hours_per_day' => round((float) $validatedSchedule['workingHoursPerDay'], 2),
                    'is_active' => 1,
                ], true);
                $response['schedule'] = $this->mapScheduleForApi($scheduleModel->find($newId) ?? []);
            } else {
                $response['schedule'] = $this->mapScheduleForApi($this->activeSchedule());
            }

            if ($rulesPayload !== null) {
                $validatedRules = $this->validateRules($rulesPayload);
                $rulesModel = model(LaborRulesConfigModel::class);
                $rulesModel->where('is_active', 1)->set(['is_active' => 0])->update();
                $newRulesId = $rulesModel->insert($validatedRules + ['is_active' => 1], true);
                $response['laborRules'] = $this->mapRulesForApi($rulesModel->find($newRulesId) ?? []);
            } else {
                $response['laborRules'] = $this->mapRulesForApi($this->activeLaborRules());
            }

            if ($db->transStatus() === false) {
                throw new \RuntimeException('La transacción de settings fue revertida.');
            }

            $db->transCommit();
            return $this->respond([
                'ok' => true,
                'settings' => $response,
            ]);
        } catch (Throwable $e) {
            $db->transRollback();
            return $this->failValidationErrors('No se pudo guardar configuración: ' . $e->getMessage());
        }
    }

    private function activeSchedule(): array
    {
        $model = model(AppConfigModel::class);
        $active = $model->where('is_active', 1)->orderBy('id', 'DESC')->first();
        if (is_array($active)) {
            return $active;
        }

        $id = $model->insert([
            'entry_time' => '08:30:00',
            'exit_time' => '17:30:00',
            'tolerance_minutes' => 10,
            'late_threshold_minutes' => 30,
            'working_hours_per_day' => 8.50,
            'is_active' => 1,
        ], true);
        return $model->find($id) ?? [];
    }

    private function activeLaborRules(): array
    {
        $model = model(LaborRulesConfigModel::class);
        $active = $model->where('is_active', 1)->orderBy('id', 'DESC')->first();
        if (is_array($active)) {
            return $active;
        }

        $id = $model->insert([
            'late_tolerance_minutes' => 15,
            'late_formal_from_nth_in_month' => 4,
            'direct_late_after_tolerance' => 1,
            'formal_late_acta_at_nth' => 5,
            'actas_for_termination_in_year' => 3,
            'absence_justification_deadline_hours' => 48,
            'absence_suspension_days_1' => 1,
            'absence_suspension_days_2' => 2,
            'absence_suspension_days_3' => 3,
            'absence_termination_from_count' => 4,
            'repeat_offense_extra_suspension_days' => 1,
            'is_active' => 1,
        ], true);
        return $model->find($id) ?? [];
    }

    private function validateSchedule(array $payload): array
    {
        $entry = trim((string) ($payload['entryTime'] ?? ''));
        $exit = trim((string) ($payload['exitTime'] ?? ''));
        $tol = (int) ($payload['toleranceMinutes'] ?? -1);
        $late = (int) ($payload['lateThresholdMinutes'] ?? -1);
        $hours = (float) ($payload['workingHoursPerDay'] ?? -1);

        if (!$this->isTime($entry) || !$this->isTime($exit)) {
            throw new \RuntimeException('entryTime y exitTime deben tener formato HH:mm o HH:mm:ss.');
        }
        if ($tol < 0 || $tol > 180) {
            throw new \RuntimeException('toleranceMinutes debe estar entre 0 y 180.');
        }
        if ($late < $tol || $late > 360) {
            throw new \RuntimeException('lateThresholdMinutes debe ser >= toleranceMinutes y <= 360.');
        }
        if ($hours <= 0 || $hours > 24) {
            throw new \RuntimeException('workingHoursPerDay debe estar entre 0 y 24.');
        }

        return [
            'entryTime' => $entry,
            'exitTime' => $exit,
            'toleranceMinutes' => $tol,
            'lateThresholdMinutes' => $late,
            'workingHoursPerDay' => $hours,
        ];
    }

    private function validateRules(array $payload): array
    {
        $rules = [
            'late_tolerance_minutes' => (int) ($payload['lateToleranceMinutes'] ?? -1),
            'late_formal_from_nth_in_month' => (int) ($payload['lateFormalFromNthInMonth'] ?? -1),
            'direct_late_after_tolerance' => !empty($payload['directLateAfterTolerance']) ? 1 : 0,
            'formal_late_acta_at_nth' => (int) ($payload['formalLateActaAtNth'] ?? -1),
            'actas_for_termination_in_year' => (int) ($payload['actasForTerminationInYear'] ?? -1),
            'absence_justification_deadline_hours' => (int) ($payload['absenceJustificationDeadlineHours'] ?? -1),
            'absence_suspension_days_1' => (int) ($payload['absenceSuspensionDays1'] ?? -1),
            'absence_suspension_days_2' => (int) ($payload['absenceSuspensionDays2'] ?? -1),
            'absence_suspension_days_3' => (int) ($payload['absenceSuspensionDays3'] ?? -1),
            'absence_termination_from_count' => (int) ($payload['absenceTerminationFromCount'] ?? -1),
            'repeat_offense_extra_suspension_days' => (int) ($payload['repeatOffenseExtraSuspensionDays'] ?? -1),
        ];

        foreach ($rules as $key => $value) {
            if ($key === 'direct_late_after_tolerance') {
                continue;
            }
            if ($value < 0 || $value > 999) {
                throw new \RuntimeException("El campo {$key} tiene un valor inválido.");
            }
        }

        if ($rules['formal_late_acta_at_nth'] < $rules['late_formal_from_nth_in_month']) {
            throw new \RuntimeException('formalLateActaAtNth debe ser mayor o igual a lateFormalFromNthInMonth.');
        }
        if ($rules['absence_termination_from_count'] < 4) {
            throw new \RuntimeException('absenceTerminationFromCount debe ser >= 4 según reglamento.');
        }

        return $rules;
    }

    private function mapScheduleForApi(array $row): array
    {
        return [
            'entryTime' => substr((string) ($row['entry_time'] ?? '08:30:00'), 0, 5),
            'exitTime' => substr((string) ($row['exit_time'] ?? '17:30:00'), 0, 5),
            'toleranceMinutes' => (int) ($row['tolerance_minutes'] ?? 10),
            'lateThresholdMinutes' => (int) ($row['late_threshold_minutes'] ?? 30),
            'workingHoursPerDay' => (float) ($row['working_hours_per_day'] ?? 8.5),
        ];
    }

    private function mapRulesForApi(array $row): array
    {
        return [
            'lateToleranceMinutes' => (int) ($row['late_tolerance_minutes'] ?? 15),
            'lateFormalFromNthInMonth' => (int) ($row['late_formal_from_nth_in_month'] ?? 4),
            'directLateAfterTolerance' => (int) ($row['direct_late_after_tolerance'] ?? 1) === 1,
            'formalLateActaAtNth' => (int) ($row['formal_late_acta_at_nth'] ?? 5),
            'actasForTerminationInYear' => (int) ($row['actas_for_termination_in_year'] ?? 3),
            'absenceJustificationDeadlineHours' => (int) ($row['absence_justification_deadline_hours'] ?? 48),
            'absenceSuspensionDays1' => (int) ($row['absence_suspension_days_1'] ?? 1),
            'absenceSuspensionDays2' => (int) ($row['absence_suspension_days_2'] ?? 2),
            'absenceSuspensionDays3' => (int) ($row['absence_suspension_days_3'] ?? 3),
            'absenceTerminationFromCount' => (int) ($row['absence_termination_from_count'] ?? 4),
            'repeatOffenseExtraSuspensionDays' => (int) ($row['repeat_offense_extra_suspension_days'] ?? 1),
        ];
    }

    private function isTime(string $value): bool
    {
        return (bool) preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $value);
    }

    private function normalizeTime(string $value): string
    {
        $value = trim($value);
        if ((bool) preg_match('/^\d{2}:\d{2}$/', $value)) {
            return $value . ':00';
        }
        if ((bool) preg_match('/^\d{2}:\d{2}:\d{2}$/', $value)) {
            return $value;
        }
        return '00:00:00';
    }
}
