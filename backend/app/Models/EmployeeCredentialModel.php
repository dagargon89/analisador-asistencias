<?php

namespace App\Models;

use CodeIgniter\Model;

class EmployeeCredentialModel extends Model
{
    protected $table            = 'employee_credentials';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'employee_id',
        'employee_code',
        'pin_hash',
        'is_active',
        'failed_attempts',
        'locked_until',
    ];

    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}

