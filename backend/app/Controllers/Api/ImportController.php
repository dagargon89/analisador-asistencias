<?php

namespace App\Controllers\Api;

use App\Services\AttendanceClassifier;
use Throwable;

class ImportController extends BaseApiController
{
    public function store()
    {
        $payload = $this->jsonBody();
        $records = $payload['records'] ?? null;
        $fileName = trim((string) ($payload['fileName'] ?? 'sin_nombre.xlsx'));
        $config = is_array($payload['config'] ?? null) ? $payload['config'] : [];
        $sourceType = strtolower((string) ($payload['sourceType'] ?? 'xlsx'));
        $summary = is_array($payload['summary'] ?? null) ? $payload['summary'] : [];

        if (!is_array($records) || $records === []) {
            return $this->failValidationErrors('El campo records es obligatorio y debe tener elementos.');
        }

        $entryTime = (string) ($config['entryTime'] ?? '08:30');
        $exitTime = (string) ($config['exitTime'] ?? '17:30');
        $toleranceMinutes = (int) ($config['toleranceMinutes'] ?? 10);
        $lateThresholdMinutes = (int) ($config['lateThresholdMinutes'] ?? 30);
        $workingHoursPerDay = (float) ($config['workingHoursPerDay'] ?? 8.5);

        $db = db_connect();
        $employeeModel = model(\App\Models\EmployeeModel::class);
        $importModel = model(\App\Models\ImportModel::class);
        $configModel = model(\App\Models\AppConfigModel::class);
        $transactionStarted = false;

        try {
            $db->transBegin();
            $transactionStarted = true;

            $configModel->where('is_active', 1)->set(['is_active' => 0])->update();
            $configModel->insert([
                'entry_time' => $this->normalizeTime($entryTime),
                'exit_time' => $this->normalizeTime($exitTime),
                'tolerance_minutes' => $toleranceMinutes,
                'late_threshold_minutes' => $lateThresholdMinutes,
                'working_hours_per_day' => round($workingHoursPerDay, 2),
                'is_active' => 1,
            ]);

            $importId = $importModel->insert([
                'file_name' => $fileName,
                'source_type' => $sourceType === 'csv' ? 'csv' : 'xlsx',
                'records_received' => count($records),
                'records_inserted' => 0,
                'records_updated' => 0,
                'duplicates_detected' => 0,
                'invalid_rows' => (int) ($summary['invalidRows'] ?? 0),
                'uploaded_at' => date('Y-m-d H:i:s'),
            ], true);

            $uniqueRows = [];
            $duplicatesInFile = 0;
            foreach ($records as $row) {
                $employee = trim((string) ($row['employee'] ?? ''));
                $date = (string) ($row['date'] ?? '');
                $entry = (string) ($row['entry'] ?? '');
                if ($employee === '' || !$this->isDate($date) || !$this->isTime($entry)) {
                    continue;
                }
                $key = $employee . '|' . $date . '|' . $entry;
                if (isset($uniqueRows[$key])) {
                    $duplicatesInFile++;
                    continue;
                }
                $uniqueRows[$key] = [
                    'employee' => $employee,
                    'date' => $date,
                    'entry' => $this->normalizeTime($entry),
                    'exit' => $this->normalizeTime((string) ($row['exit'] ?? ''), true),
                    'hours' => round((float) ($row['hoursWorked'] ?? 0), 2),
                ];
            }

            $names = array_values(array_unique(array_map(
                static fn($r) => $r['employee'],
                array_values($uniqueRows)
            )));

            if ($names !== []) {
                $existing = $employeeModel->whereIn('name', $names)->findAll();
                $existingNames = array_map(static fn($r) => $r['name'], $existing);
                $missing = array_values(array_diff($names, $existingNames));
                if ($missing !== []) {
                    $employeeModel->insertBatch(array_map(static fn($name) => ['name' => $name], $missing));
                }
            }

            if ($names === []) {
                throw new \RuntimeException('No se encontraron registros válidos para importar.');
            }

            $employeeRows = $employeeModel->whereIn('name', $names)->findAll();
            $employeeByName = [];
            foreach ($employeeRows as $emp) {
                $employeeByName[$emp['name']] = (int) $emp['id'];
            }

            $inserted = 0;
            $updated = 0;
            $skippedExisting = 0;

            foreach ($uniqueRows as $row) {
                $employeeId = $employeeByName[$row['employee']] ?? null;
                if (!$employeeId) {
                    continue;
                }
                $status = AttendanceClassifier::classify(
                    $row['entry'],
                    $entryTime,
                    $toleranceMinutes,
                    $lateThresholdMinutes
                );
                $sql = "INSERT IGNORE INTO attendance_records
                    (employee_id, work_date, check_in_time, check_out_time, hours_worked, status, source_import_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())";
                $result = $db->query($sql, [
                    $employeeId,
                    $row['date'],
                    $row['entry'],
                    $row['exit'],
                    $row['hours'],
                    $status,
                    $importId,
                ]);
                if ($result === false) {
                    throw new \RuntimeException('Error al persistir un registro de asistencia.');
                }
                $affected = $db->affectedRows();
                if ($affected === 1) {
                    $inserted++;
                } else {
                    $skippedExisting++;
                }
            }

            $duplicates = $duplicatesInFile + $skippedExisting;

            $importModel->update($importId, [
                'records_inserted' => $inserted,
                'records_updated' => $updated,
                'duplicates_detected' => $duplicates,
            ]);

            if ($db->transStatus() === false) {
                throw new \RuntimeException('La transacción de importación fue revertida.');
            }
            $db->transCommit();

            return $this->respondCreated([
                'ok' => true,
                'importId' => (int) $importId,
                'stats' => [
                    'received' => count($records),
                    'inserted' => $inserted,
                    'updated' => $updated,
                    'skippedExisting' => $skippedExisting,
                    'duplicates' => $duplicates,
                ],
            ]);
        } catch (Throwable $e) {
            if ($transactionStarted) {
                try {
                    $db->transRollback();
                } catch (Throwable) {
                    // Ignore rollback failures when the connection is unavailable.
                }
            }
            log_message('error', 'Import failed: {message}', ['message' => $e->getMessage()]);
            return $this->failServerError('No se pudo guardar la importación: ' . $e->getMessage());
        }
    }

    private function isDate(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value);
    }

    private function isTime(string $value): bool
    {
        return (bool) preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $value);
    }

    private function normalizeTime(string $value, bool $nullable = false): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return $nullable ? null : '00:00:00';
        }
        if ((bool) preg_match('/^\d{2}:\d{2}$/', $value)) {
            return $value . ':00';
        }
        if ((bool) preg_match('/^\d{2}:\d{2}:\d{2}$/', $value)) {
            return $value;
        }

        return $nullable ? null : '00:00:00';
    }
}

