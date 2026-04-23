<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class LeaveBalanceModel extends Model
{
    protected $table = 'employee_leave_balances';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'employee_id', 'anniversary_year', 'years_of_service',
        'entitled_days', 'used_days', 'carried_over_days', 'prima_vacacional_days',
        'period_start', 'period_end', 'expiration_date',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';
}
