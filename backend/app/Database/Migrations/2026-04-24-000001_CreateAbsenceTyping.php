<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateAbsenceTyping extends Migration
{
    public function up(): void
    {
        if (!$this->db->tableExists('absence_types')) {
            $this->forge->addField([
                'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
                'code' => ['type' => 'VARCHAR', 'constraint' => 32],
                'label' => ['type' => 'VARCHAR', 'constraint' => 120],
                'paid' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'counts_as_worked_day' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'affects_leave_balance' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
                'requires_document' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
                'color_hex' => ['type' => 'VARCHAR', 'constraint' => 9, 'default' => '#999999'],
                'display_order' => ['type' => 'INT', 'unsigned' => true, 'default' => 100],
                'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addUniqueKey('code', 'uq_absence_types_code');
            $this->forge->addKey('is_active', false, false, 'idx_absence_types_active');
            $this->forge->createTable('absence_types', true);
        }

        if (!$this->db->tableExists('employee_absences')) {
            $this->forge->addField([
                'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
                'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
                'absence_type_id' => ['type' => 'BIGINT', 'unsigned' => true],
                'start_date' => ['type' => 'DATE'],
                'end_date' => ['type' => 'DATE'],
                'business_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
                'status' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'pending'],
                'reason' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
                'document_url' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
                'requested_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
                'requested_at' => ['type' => 'DATETIME', 'null' => true],
                'approved_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
                'approved_at' => ['type' => 'DATETIME', 'null' => true],
                'rejected_reason' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
                'supersedes_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
                'notes' => ['type' => 'TEXT', 'null' => true],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey(['employee_id', 'start_date', 'end_date'], false, false, 'idx_absences_employee_range');
            $this->forge->addKey(['status'], false, false, 'idx_absences_status');
            $this->forge->addKey(['start_date', 'end_date'], false, false, 'idx_absences_range');
            $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_absences_employee');
            $this->forge->addForeignKey('absence_type_id', 'absence_types', 'id', 'RESTRICT', 'CASCADE', 'fk_absences_type');
            $this->forge->addForeignKey('supersedes_id', 'employee_absences', 'id', 'SET NULL', 'CASCADE', 'fk_absences_supersedes');
            $this->forge->createTable('employee_absences', true);
        }
    }

    public function down(): void
    {
        if ($this->db->tableExists('employee_absences')) {
            $this->forge->dropTable('employee_absences', true);
        }
        if ($this->db->tableExists('absence_types')) {
            $this->forge->dropTable('absence_types', true);
        }
    }
}
