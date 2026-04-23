<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class EmployeeAbsenceModel extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_SUPERSEDED = 'superseded';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_APPROVED,
        self::STATUS_REJECTED,
        self::STATUS_CANCELLED,
        self::STATUS_SUPERSEDED,
    ];

    protected $table = 'employee_absences';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'employee_id', 'absence_type_id',
        'start_date', 'end_date', 'business_days',
        'status', 'reason', 'document_url',
        'requested_by', 'requested_at',
        'approved_by', 'approved_at', 'rejected_reason',
        'supersedes_id', 'notes',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';

    protected $validationRules = [
        'employee_id' => 'required|is_natural_no_zero',
        'absence_type_id' => 'required|is_natural_no_zero',
        'start_date' => 'required|valid_date[Y-m-d]',
        'end_date' => 'required|valid_date[Y-m-d]',
        'status' => 'required|in_list[pending,approved,rejected,cancelled,superseded]',
    ];

    /**
     * Devuelve ausencias aprobadas (status = 'approved') que intersectan el rango.
     *
     * @return list<array<string, mixed>>
     */
    public function findApprovedInRange(string $from, string $to, ?int $employeeId = null): array
    {
        $builder = $this->builder()
            ->select('employee_absences.*, absence_types.code AS type_code, absence_types.label AS type_label, absence_types.counts_as_worked_day, absence_types.paid')
            ->join('absence_types', 'absence_types.id = employee_absences.absence_type_id', 'inner')
            ->where('employee_absences.status', self::STATUS_APPROVED)
            ->where('employee_absences.start_date <=', $to)
            ->where('employee_absences.end_date >=', $from)
            ->orderBy('employee_absences.start_date', 'ASC');

        if ($employeeId !== null) {
            $builder->where('employee_absences.employee_id', $employeeId);
        }

        return $builder->get()->getResultArray();
    }
}
