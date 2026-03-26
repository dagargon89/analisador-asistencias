<?php

namespace App\Models;

use CodeIgniter\Model;

class AttendancePunchModel extends Model
{
    protected $table            = 'attendance_punches';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'employee_id',
        'attendance_record_id',
        'punch_type',
        'punched_at',
        'source',
        'device_id',
        'created_by_user_id',
        'geo_lat',
        'geo_lng',
        'geo_accuracy_meters',
        'notes',
    ];

    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}

