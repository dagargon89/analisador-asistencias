<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateLaborRulesConfig extends Migration
{
    public function up()
    {
        if (!$this->db->tableExists('labor_rules_config')) {
            $this->forge->addField([
                'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
                'late_tolerance_minutes' => ['type' => 'INT', 'unsigned' => true, 'default' => 15],
                'late_formal_from_nth_in_month' => ['type' => 'INT', 'unsigned' => true, 'default' => 4],
                'direct_late_after_tolerance' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'formal_late_acta_at_nth' => ['type' => 'INT', 'unsigned' => true, 'default' => 5],
                'actas_for_termination_in_year' => ['type' => 'INT', 'unsigned' => true, 'default' => 3],
                'absence_justification_deadline_hours' => ['type' => 'INT', 'unsigned' => true, 'default' => 48],
                'absence_suspension_days_1' => ['type' => 'INT', 'unsigned' => true, 'default' => 1],
                'absence_suspension_days_2' => ['type' => 'INT', 'unsigned' => true, 'default' => 2],
                'absence_suspension_days_3' => ['type' => 'INT', 'unsigned' => true, 'default' => 3],
                'absence_termination_from_count' => ['type' => 'INT', 'unsigned' => true, 'default' => 4],
                'repeat_offense_extra_suspension_days' => ['type' => 'INT', 'unsigned' => true, 'default' => 1],
                'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('is_active');
            $this->forge->createTable('labor_rules_config', true);
        }

        $existing = $this->db->table('labor_rules_config')->where('is_active', 1)->countAllResults();
        if ((int) $existing === 0) {
            $this->db->table('labor_rules_config')->insert([
                'late_tolerance_minutes' => 15,
                'late_formal_from_nth_in_month' => 4,
                'direct_late_after_tolerance' => 1,
                'formal_late_acta_at_nth' => 5,
                'actas_for_termination_in_year' => 3,
                'absence_justification_deadline_hours' => 48,
                'absence_suspension_days_1' => 1,
                'absence_suspension_days_2' => 2,
                'absence_suspension_days_3' => 3,
                'absence_termination_from_count' => 4,
                'repeat_offense_extra_suspension_days' => 1,
                'is_active' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
        }
    }

    public function down()
    {
        $this->forge->dropTable('labor_rules_config', true);
    }
}
