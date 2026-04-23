<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class AbsenceTypeModel extends Model
{
    protected $table = 'absence_types';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'code', 'label', 'paid', 'counts_as_worked_day',
        'affects_leave_balance', 'requires_document',
        'color_hex', 'display_order', 'is_active',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';

    protected $validationRules = [
        'code' => 'required|alpha_dash|max_length[32]|is_unique[absence_types.code,id,{id}]',
        'label' => 'required|max_length[120]',
        'paid' => 'in_list[0,1]',
        'counts_as_worked_day' => 'in_list[0,1]',
        'affects_leave_balance' => 'in_list[0,1]',
        'requires_document' => 'in_list[0,1]',
        'color_hex' => 'regex_match[/^#[0-9A-Fa-f]{6}$/]',
    ];

    /** @return list<array<string, mixed>> */
    public function listActive(): array
    {
        return $this->where('is_active', 1)
            ->orderBy('display_order', 'ASC')
            ->orderBy('label', 'ASC')
            ->findAll();
    }
}
