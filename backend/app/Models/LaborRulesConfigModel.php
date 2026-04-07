<?php

namespace App\Models;

use CodeIgniter\Model;

class LaborRulesConfigModel extends Model
{
    protected $table            = 'labor_rules_config';
    protected $primaryKey       = 'id';
    protected $returnType       = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields    = true;
    protected $allowedFields    = [
        'late_tolerance_minutes',
        'late_formal_from_nth_in_month',
        'direct_late_after_tolerance',
        'formal_late_acta_at_nth',
        'actas_for_termination_in_year',
        'absence_justification_deadline_hours',
        'absence_suspension_days_1',
        'absence_suspension_days_2',
        'absence_suspension_days_3',
        'absence_termination_from_count',
        'repeat_offense_extra_suspension_days',
        'is_active',
    ];
    protected bool $allowEmptyInserts = false;
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';
}
