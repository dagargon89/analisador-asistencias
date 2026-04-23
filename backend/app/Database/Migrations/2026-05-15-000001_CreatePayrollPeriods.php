<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreatePayrollPeriods extends Migration
{
    public function up(): void
    {
        if ($this->db->tableExists('payroll_periods')) {
            return;
        }

        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'period_type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'biweekly'],
            'label' => ['type' => 'VARCHAR', 'constraint' => 60],
            'start_date' => ['type' => 'DATE'],
            'end_date' => ['type' => 'DATE'],
            'expected_calendar_days' => ['type' => 'TINYINT', 'unsigned' => true, 'default' => 15],
            'status' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'open'],
            'closed_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'closed_at' => ['type' => 'DATETIME', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['start_date', 'end_date', 'period_type'], 'uq_payroll_period_range');
        $this->forge->addKey('status');
        $this->forge->createTable('payroll_periods', true);
    }

    public function down(): void
    {
        if ($this->db->tableExists('payroll_periods')) {
            $this->forge->dropTable('payroll_periods', true);
        }
    }
}
