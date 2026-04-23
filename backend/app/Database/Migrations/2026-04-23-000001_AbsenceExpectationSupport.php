<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class AbsenceExpectationSupport extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('employees')) {
            if (!$this->db->fieldExists('hire_date', 'employees')) {
                $this->forge->addColumn('employees', [
                    'hire_date' => ['type' => 'DATE', 'null' => true, 'after' => 'is_active'],
                ]);
            }
            if (!$this->db->fieldExists('termination_date', 'employees')) {
                $this->forge->addColumn('employees', [
                    'termination_date' => ['type' => 'DATE', 'null' => true, 'after' => 'hire_date'],
                ]);
            }
        }

        if (!$this->db->tableExists('calendar_non_working_days')) {
            $this->forge->addField([
                'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
                'calendar_date' => ['type' => 'DATE'],
                'label' => ['type' => 'VARCHAR', 'constraint' => 160, 'null' => true],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addUniqueKey('calendar_date', 'uq_calendar_non_working_date');
            $this->forge->createTable('calendar_non_working_days', true);
        }
    }

    public function down()
    {
        if ($this->db->tableExists('calendar_non_working_days')) {
            $this->forge->dropTable('calendar_non_working_days', true);
        }
        if ($this->db->tableExists('employees')) {
            if ($this->db->fieldExists('termination_date', 'employees')) {
                $this->forge->dropColumn('employees', 'termination_date');
            }
            if ($this->db->fieldExists('hire_date', 'employees')) {
                $this->forge->dropColumn('employees', 'hire_date');
            }
        }
    }
}
