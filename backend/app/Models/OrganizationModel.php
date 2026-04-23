<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class OrganizationModel extends Model
{
    protected $table = 'organizations';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = ['code', 'name', 'legal_name', 'rfc', 'is_active'];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';

    /** @return list<array<string,mixed>> */
    public function listActive(): array
    {
        return $this->where('is_active', 1)->orderBy('name', 'ASC')->findAll();
    }
}
