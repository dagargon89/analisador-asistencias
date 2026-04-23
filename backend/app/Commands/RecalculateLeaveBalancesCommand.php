<?php

declare(strict_types=1);

namespace App\Commands;

use App\Services\LeaveBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

class RecalculateLeaveBalancesCommand extends BaseCommand
{
    protected $group = 'HR';
    protected $name = 'hr:recalc-balances';
    protected $description = 'Recalcula saldos de vacaciones LFT para todos los empleados activos.';
    protected $usage = 'hr:recalc-balances [--as-of=YYYY-MM-DD]';
    protected $options = ['--as-of' => 'Fecha de referencia (YYYY-MM-DD). Por defecto hoy.'];

    public function run(array $params): void
    {
        $asOf = CLI::getOption('as-of');
        $asOf = is_string($asOf) && $asOf !== '' ? $asOf : null;

        $n = (new LeaveBalanceService())->recalculateAll($asOf);
        CLI::write("Balances recalculados: {$n}", 'green');
    }
}
