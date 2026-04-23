<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class PayrollPeriodModel extends Model
{
    public const STATUS_OPEN = 'open';
    public const STATUS_CLOSED = 'closed';

    protected $table = 'payroll_periods';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'period_type', 'label', 'start_date', 'end_date',
        'expected_calendar_days', 'status', 'closed_by', 'closed_at',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';
}
