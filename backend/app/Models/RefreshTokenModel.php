<?php

namespace App\Models;

use CodeIgniter\Model;

class RefreshTokenModel extends Model
{
    protected $table            = 'refresh_tokens';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'user_id',
        'token_hash',
        'expires_at',
        'revoked_at',
        'ip_address',
        'user_agent',
    ];

    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}

