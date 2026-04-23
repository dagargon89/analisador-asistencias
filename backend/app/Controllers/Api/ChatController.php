<?php

namespace App\Controllers\Api;

use App\Services\AbsenceExpectationService;
use App\Services\GeminiChatService;
use Throwable;

class ChatController extends BaseApiController
{
    public function ask()
    {
        $payload = $this->jsonBody();
        $message = trim((string) ($payload['message'] ?? ''));
        $history = is_array($payload['history'] ?? null) ? $payload['history'] : [];
        $filters = is_array($payload['filters'] ?? null) ? $payload['filters'] : [];

        if ($message === '') {
            return $this->failValidationErrors('message es obligatorio.');
        }

        $from = (string) ($filters['from'] ?? '');
        $to = (string) ($filters['to'] ?? '');
        $employee = trim((string) ($filters['employee'] ?? ''));
        if (!$this->isDate($from) || !$this->isDate($to)) {
            [$from, $to] = $this->resolveRange();
        }

        try {
            $context = $this->buildContext($from, $to, $employee);
            $chatService = new GeminiChatService();

            if ($chatService->isEnabled()) {
                $reply = $chatService->ask($message, $context, $history);
            } else {
                $reply = "No hay clave de Gemini configurada en el backend. "
                    . "Resumen disponible de la base de datos:\n\n" . $context;
            }

            return $this->respond([
                'reply' => $reply,
                'period' => ['from' => $from, 'to' => $to],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'Chat error: {message}', ['message' => $e->getMessage()]);
            return $this->failServerError('No se pudo responder el chat: ' . $e->getMessage());
        }
    }

    private function buildContext(string $from, string $to, string $employee): string
    {
        $db = db_connect();
        $nameFilter = ($employee !== '' && strtolower($employee) !== 'all') ? $employee : null;
        $service = new AbsenceExpectationService($db);
        $absenceResult = $service->computeAbsences($from, $to, $nameFilter);

        $builder = $db->table('attendance_records ar')
            ->select('ar.work_date, ar.hours_worked, ar.status, e.name')
            ->join('employees e', 'e.id = ar.employee_id', 'inner')
            ->where('ar.work_date >=', $from)
            ->where('ar.work_date <=', $to);

        if ($nameFilter !== null) {
            $builder->where('e.name', $nameFilter);
        }

        $rows = $builder->get()->getResultArray();

        $lines = [];
        $lines[] = "Periodo: {$from} a {$to}";
        $lines[] = 'Motor inasistencias: ' . AbsenceExpectationService::DEFINITION_ID;
        $meta = $absenceResult['meta'];
        $lines[] = 'Días hábiles (lun–vie) en rango: ' . $meta['weekdayDaysInRange'];
        $lines[] = 'Días inhábiles de calendario excluidos: ' . $meta['calendarDaysExcluded'];
        $lines[] = 'Días laborales tras calendario: ' . $meta['workingDaysAfterCalendar'];
        $lines[] = 'Espacios esperados (empleado-día con contrato vigente): ' . $meta['expectedAttendanceSlots'];
        $lines[] = 'Inasistencias (sin registro ese día): ' . $meta['absenceSlots'];

        if ($rows === []) {
            $lines[] = '';
            $lines[] = 'No hay registros de asistencia en el periodo filtrado.';
            $lines[] = 'Inasistencias por empleado (activos, motor unificado):';
            $this->appendAbsenceLines($lines, $absenceResult['byEmployee'], 40);

            return implode("\n", $lines);
        }

        $onTime = 0;
        $late = 0;
        $veryLate = 0;
        $hours = 0.0;
        $employeeStats = [];

        foreach ($rows as $r) {
            $status = (string) $r['status'];
            if ($status === 'ontime') {
                $onTime++;
            } elseif ($status === 'late') {
                $late++;
            } else {
                $veryLate++;
            }
            $hours += (float) $r['hours_worked'];
            $name = (string) $r['name'];
            $employeeStats[$name] = $employeeStats[$name] ?? ['days' => 0, 'late' => 0, 'veryLate' => 0, 'hours' => 0.0];
            $employeeStats[$name]['days']++;
            if ($status === 'late') {
                $employeeStats[$name]['late']++;
            } elseif ($status === 'verylate') {
                $employeeStats[$name]['veryLate']++;
            }
            $employeeStats[$name]['hours'] += (float) $r['hours_worked'];
        }

        uasort($employeeStats, static function (array $a, array $b): int {
            $scoreA = ($a['late'] + ($a['veryLate'] * 2));
            $scoreB = ($b['late'] + ($b['veryLate'] * 2));
            if ($scoreA === $scoreB) {
                return $b['days'] <=> $a['days'];
            }

            return $scoreA <=> $scoreB;
        });

        $lines[] = '';
        $lines[] = 'Registros totales: ' . count($rows);
        $lines[] = 'A tiempo: ' . $onTime . ', retardos: ' . $late . ', retardos mayores: ' . $veryLate;
        $lines[] = 'Horas totales: ' . round($hours, 2);
        $lines[] = 'Promedio horas por registro: ' . round($hours / max(1, count($rows)), 2);

        $lines[] = '';
        $lines[] = 'Top empleados (puntualidad y horas); inasistencias = motor unificado:';
        $byEmp = $absenceResult['byEmployee'];
        foreach (array_slice($employeeStats, 0, 8, true) as $name => $st) {
            $punctuality = (int) round((($st['days'] - $st['late'] - $st['veryLate']) / max(1, $st['days'])) * 100);
            $absCnt = (int) ($byEmp[$name] ?? 0);
            $lines[] = "- {$name}: días con registro={$st['days']}, puntualidad={$punctuality}%, "
                . "retardos={$st['late']}, tardanzas mayores={$st['veryLate']}, "
                . 'horas=' . round($st['hours'], 2) . ', inasistencias=' . $absCnt;
        }

        $lines[] = '';
        $lines[] = 'Empleados con más inasistencias en el periodo (hasta 15):';
        $this->appendAbsenceLines($lines, $byEmp, 15);

        return implode("\n", $lines);
    }

    /**
     * @param array<string, int> $byEmployee
     */
    private function appendAbsenceLines(array &$lines, array $byEmployee, int $max): void
    {
        if ($byEmployee === []) {
            $lines[] = '(ninguna)';

            return;
        }
        arsort($byEmployee, SORT_NUMERIC);
        $i = 0;
        foreach ($byEmployee as $name => $cnt) {
            if ($i++ >= $max) {
                break;
            }
            $lines[] = '- ' . $name . ': ' . $cnt;
        }
    }

    private function resolveRange(): array
    {
        $row = db_connect()->table('attendance_records')
            ->select('MIN(work_date) AS min_date, MAX(work_date) AS max_date')
            ->get()
            ->getRowArray();

        if (!is_array($row) || !$row['min_date'] || !$row['max_date']) {
            $today = date('Y-m-d');
            return [$today, $today];
        }

        return [(string) $row['min_date'], (string) $row['max_date']];
    }

    private function isDate(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value);
    }
}
