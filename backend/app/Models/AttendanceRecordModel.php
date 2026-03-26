<?php

namespace App\Models;

use CodeIgniter\Model;

class AttendanceRecordModel extends Model
{
    protected $table            = 'attendance_records';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'employee_id',
        'work_date',
        'check_in_time',
        'check_out_time',
        'hours_worked',
        'status',
        'source_import_id',
    ];
    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}

