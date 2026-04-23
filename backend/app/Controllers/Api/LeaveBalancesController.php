<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Services\LeaveBalanceService;
use Throwable;

class LeaveBalancesController extends BaseApiController
{
    public function show()
    {
        try {
            $employeeId = (int) ($this->request->getGet('employee_id') ?? 0);
            if ($employeeId <= 0) {
                return $this->failValidationErrors(['employee_id' => 'requerido']);
            }
            $asOf = (string) ($this->request->getGet('as_of') ?? '');
            $balance = (new LeaveBalanceService())->getCurrentForEmployee($employeeId, $asOf !== '' ? $asOf : null);
            if ($balance === null) {
                return $this->respond(['balance' => null]);
            }
            return $this->respond(['balance' => $balance]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo obtener el saldo: ' . $e->getMessage());
        }
    }

    public function recalc()
    {
        try {
            $body = $this->jsonBody();
            $asOf = isset($body['as_of']) && is_string($body['as_of']) && $body['as_of'] !== '' ? (string) $body['as_of'] : null;
            $n = (new LeaveBalanceService())->recalculateAll($asOf);
            return $this->respond(['recalculated' => $n]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo recalcular: ' . $e->getMessage());
        }
    }
}
