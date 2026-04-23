<?php

declare(strict_types=1);

namespace App\Commands;

use App\Services\PayrollPeriodService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

class GeneratePayrollPeriodsCommand extends BaseCommand
{
    protected $group = 'HR';
    protected $name = 'hr:generate-periods';
    protected $description = 'Genera 24 periodos quincenales para un año dado (idempotente).';
    protected $usage = 'hr:generate-periods [--year=YYYY]';
    protected $options = ['--year' => 'Año a generar. Por defecto, el actual.'];

    public function run(array $params): void
    {
        $yearOpt = CLI::getOption('year');
        $year = is_string($yearOpt) && ctype_digit($yearOpt) ? (int) $yearOpt : (int) date('Y');

        $n = (new PayrollPeriodService())->generateBiweeklyForYear($year);
        CLI::write("Periodos insertados para {$year}: {$n}", 'green');
    }
}
