<?php

namespace App\Models;

use CodeIgniter\Model;

class AppConfigModel extends Model
{
    protected $table            = 'app_config';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'entry_time',
        'exit_time',
        'tolerance_minutes',
        'late_threshold_minutes',
        'working_hours_per_day',
        'is_active',
    ];
    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}

