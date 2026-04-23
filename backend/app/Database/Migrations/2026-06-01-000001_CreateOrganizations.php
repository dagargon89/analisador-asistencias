<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateOrganizations extends Migration
{
    public function up(): void
    {
        if (!$this->db->tableExists('organizations')) {
            $this->forge->addField([
                'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
                'code' => ['type' => 'VARCHAR', 'constraint' => 16],
                'name' => ['type' => 'VARCHAR', 'constraint' => 180],
                'legal_name' => ['type' => 'VARCHAR', 'constraint' => 240, 'null' => true],
                'rfc' => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => true],
                'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addUniqueKey('code', 'uq_organizations_code');
            $this->forge->createTable('organizations', true);
        }

        if ($this->db->tableExists('employees') && !$this->db->fieldExists('organization_id', 'employees')) {
            $this->forge->addColumn('employees', [
                'organization_id' => [
                    'type' => 'BIGINT',
                    'unsigned' => true,
                    'null' => true,
                    'after' => 'is_active',
                ],
            ]);
        }

        if ($this->db->tableExists('calendar_non_working_days') && !$this->db->fieldExists('organization_id', 'calendar_non_working_days')) {
            $this->forge->addColumn('calendar_non_working_days', [
                'organization_id' => [
                    'type' => 'BIGINT',
                    'unsigned' => true,
                    'null' => true,
                    'after' => 'calendar_date',
                ],
            ]);
        }
    }

    public function down(): void
    {
        if ($this->db->tableExists('calendar_non_working_days') && $this->db->fieldExists('organization_id', 'calendar_non_working_days')) {
            $this->forge->dropColumn('calendar_non_working_days', 'organization_id');
        }
        if ($this->db->tableExists('employees') && $this->db->fieldExists('organization_id', 'employees')) {
            $this->forge->dropColumn('employees', 'organization_id');
        }
        if ($this->db->tableExists('organizations')) {
            $this->forge->dropTable('organizations', true);
        }
    }
}
