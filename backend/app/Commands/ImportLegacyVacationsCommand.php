<?php

declare(strict_types=1);

namespace App\Commands;

use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use App\Services\AbsenceResolver;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use DateTimeInterface;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as SpreadsheetDate;
use Throwable;

/**
 * Importa el histórico desde 'Control de vacaciones GPJ' (xlsx).
 *   php spark hr:import-legacy-vacations /ruta/archivo.xlsx FCFN [--dry-run]
 */
class ImportLegacyVacationsCommand extends BaseCommand
{
    protected $group = 'HR';
    protected $name = 'hr:import-legacy-vacations';
    protected $description = 'Importa vacaciones históricas desde xlsx.';
    protected $usage = 'hr:import-legacy-vacations <path.xlsx> [sheet=FCFN] [--dry-run]';
    protected $arguments = [
        'path' => 'Ruta al archivo .xlsx',
        'sheet' => 'Nombre de la hoja (FCFN por defecto)',
    ];
    protected $options = [
        '--dry-run' => 'No persiste cambios; solo reporta warnings y conteo.',
    ];

    public function run(array $params): void
    {
        $path = $params[0] ?? null;
        $sheet = $params[1] ?? 'FCFN';
        $dryRun = CLI::getOption('dry-run') !== null;

        if (!$path || !is_file($path)) {
            CLI::error('Uso: spark hr:import-legacy-vacations <path.xlsx> [hoja=FCFN]');
            return;
        }

        if (!class_exists(IOFactory::class)) {
            CLI::error('Falta phpoffice/phpspreadsheet. Ejecuta: composer require phpoffice/phpspreadsheet');
            return;
        }

        try {
            $reader = IOFactory::createReaderForFile($path);
            $reader->setReadDataOnly(true);
            $reader->setLoadSheetsOnly([$sheet]);
            $spreadsheet = $reader->load($path);
        } catch (Throwable $e) {
            CLI::error('No se pudo abrir el archivo: ' . $e->getMessage());
            return;
        }

        $ws = $spreadsheet->getActiveSheet();

        $vacType = db_connect()->table('absence_types')->where('code', 'VAC')->get()->getFirstRow('array');
        if (!$vacType) {
            CLI::error('No existe el tipo VAC en absence_types. Ejecuta el seeder AbsenceTypesSeeder.');
            return;
        }
        $vacTypeId = (int) $vacType['id'];

        $currentEmployee = null;
        $currentEmployeeId = null;
        $inserted = 0;
        $skipped = 0;
        $warnings = [];

        foreach ($ws->getRowIterator(7) as $row) {
            $cells = [];
            foreach ($row->getCellIterator('B', 'H') as $c) {
                $cells[] = $c->getValue();
            }
            [$name, $hire, , $fechas, $numDias, , $solicitud] = array_pad($cells, 7, null);

            if ($name !== null && trim((string) $name) !== '') {
                $currentEmployee = trim((string) $name);
                $emp = model(EmployeeModel::class)->where('name', $currentEmployee)->first();
                if (!$emp) {
                    $warnings[] = "Empleado no encontrado: {$currentEmployee}";
                    $currentEmployeeId = null;
                } else {
                    $currentEmployeeId = (int) $emp['id'];
                    if ($hire && empty($emp['hire_date'])) {
                        $hireDate = $this->toDateString($hire);
                        if ($hireDate && !$dryRun) {
                            model(EmployeeModel::class)->update($currentEmployeeId, ['hire_date' => $hireDate]);
                        }
                    }
                }
                continue;
            }

            if ($currentEmployeeId === null || $fechas === null || $numDias === null) {
                continue;
            }

            $ranges = $this->parseFechas($fechas);
            if ($ranges === []) {
                $warnings[] = "Fechas no parseables para {$currentEmployee}: '" . (string) $fechas . "'";
                $skipped++;
                continue;
            }

            foreach ($ranges as [$start, $end]) {
                $businessDays = (new AbsenceResolver())->listWeekdays($start, $end);
                if ($dryRun) {
                    $inserted++;
                    continue;
                }
                model(EmployeeAbsenceModel::class)->insert([
                    'employee_id' => $currentEmployeeId,
                    'absence_type_id' => $vacTypeId,
                    'start_date' => $start,
                    'end_date' => $end,
                    'business_days' => count($businessDays),
                    'status' => EmployeeAbsenceModel::STATUS_APPROVED,
                    'approved_at' => $solicitud ? $this->toDateString($solicitud) : date('Y-m-d H:i:s'),
                    'notes' => 'Importado desde legacy xlsx',
                ]);
                $inserted++;
            }
        }

        $tag = $dryRun ? '[DRY-RUN] ' : '';
        CLI::write("{$tag}Insertadas: {$inserted} | Saltadas: {$skipped}", 'green');
        foreach ($warnings as $w) {
            CLI::write('  WARN: ' . $w, 'yellow');
        }
    }

    /**
     * Parsea texto libre en rangos.
     *
     * @return list<array{0:string,1:string}>
     */
    private function parseFechas(mixed $value): array
    {
        if ($value instanceof DateTimeInterface) {
            $d = $value->format('Y-m-d');
            return [[$d, $d]];
        }
        if (is_numeric($value)) {
            try {
                $d = SpreadsheetDate::excelToDateTimeObject((float) $value)->format('Y-m-d');
                return [[$d, $d]];
            } catch (Throwable) {
                return [];
            }
        }
        $text = strtolower((string) $value);
        $text = str_replace(['de ', 'del '], '', $text);
        $months = [
            'enero' => 1, 'febrero' => 2, 'marzo' => 3, 'abril' => 4, 'mayo' => 5, 'junio' => 6,
            'julio' => 7, 'agosto' => 8, 'septiembre' => 9, 'octubre' => 10, 'noviembre' => 11, 'diciembre' => 12,
        ];
        $monthNum = null;
        $year = null;
        foreach ($months as $k => $v) {
            if (str_contains($text, $k)) {
                $monthNum = $v;
                break;
            }
        }
        if (preg_match('/\b(20\d{2})\b/', $text, $m)) {
            $year = (int) $m[1];
        }
        if ($monthNum === null || $year === null) {
            return [];
        }

        if (preg_match('/(\d{1,2})(?:\s*[-y,]\s*\d{1,2})+/', $text, $m)) {
            $parts = preg_split('/\s*[-y,]\s*/', $m[0]) ?: [];
            $ints = array_values(array_map('intval', array_filter($parts, static fn($p) => ctype_digit(trim((string) $p)))));
            sort($ints);
            if ($ints !== [] && $this->isContiguous($ints)) {
                return [[
                    sprintf('%04d-%02d-%02d', $year, $monthNum, $ints[0]),
                    sprintf('%04d-%02d-%02d', $year, $monthNum, end($ints)),
                ]];
            }
            return array_map(
                static fn(int $d) => [
                    sprintf('%04d-%02d-%02d', $year, $monthNum, $d),
                    sprintf('%04d-%02d-%02d', $year, $monthNum, $d),
                ],
                $ints,
            );
        }
        if (preg_match('/\b(\d{1,2})\b/', $text, $m)) {
            $d = (int) $m[1];
            $iso = sprintf('%04d-%02d-%02d', $year, $monthNum, $d);
            return [[$iso, $iso]];
        }
        return [];
    }

    /** @param list<int> $ints */
    private function isContiguous(array $ints): bool
    {
        for ($i = 1; $i < count($ints); $i++) {
            if ($ints[$i] !== $ints[$i - 1] + 1) {
                return false;
            }
        }
        return count($ints) > 1;
    }

    private function toDateString(mixed $v): ?string
    {
        if ($v instanceof DateTimeInterface) {
            return $v->format('Y-m-d');
        }
        if (is_numeric($v)) {
            try {
                return SpreadsheetDate::excelToDateTimeObject((float) $v)->format('Y-m-d');
            } catch (Throwable) {
                return null;
            }
        }
        return null;
    }
}
