<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class AddEmployeeProfileFields extends Migration
{
    public function up()
    {
        if (!$this->db->tableExists('employees')) {
            return;
        }

        $columns = [];

        if (!$this->db->fieldExists('email', 'employees')) {
            $columns['email'] = ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true, 'after' => 'employee_code'];
        }
        if (!$this->db->fieldExists('phone', 'employees')) {
            $columns['phone'] = ['type' => 'VARCHAR', 'constraint' => 32, 'null' => true, 'after' => 'email'];
        }
        if (!$this->db->fieldExists('position', 'employees')) {
            $columns['position'] = ['type' => 'VARCHAR', 'constraint' => 120, 'null' => true, 'after' => 'phone'];
        }
        if (!$this->db->fieldExists('birthdate', 'employees')) {
            $columns['birthdate'] = ['type' => 'DATE', 'null' => true, 'after' => 'termination_date'];
        }
        if (!$this->db->fieldExists('notes', 'employees')) {
            $columns['notes'] = ['type' => 'TEXT', 'null' => true, 'after' => 'birthdate'];
        }

        if (!empty($columns)) {
            $this->forge->addColumn('employees', $columns);
        }

        if ($this->db->fieldExists('email', 'employees')) {
            try {
                $this->db->query('CREATE INDEX idx_employees_email ON employees (email)');
            } catch (\Throwable $e) {
                // índice puede ya existir
            }
        }
    }

    public function down()
    {
        if (!$this->db->tableExists('employees')) {
            return;
        }

        try {
            $this->db->query('DROP INDEX idx_employees_email ON employees');
        } catch (\Throwable $e) {
            // índice puede no existir
        }

        $drop = [];
        foreach (['notes', 'birthdate', 'position', 'phone', 'email'] as $field) {
            if ($this->db->fieldExists($field, 'employees')) {
                $drop[] = $field;
            }
        }
        if (!empty($drop)) {
            $this->forge->dropColumn('employees', $drop);
        }
    }
}
