<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateLeaveBalances extends Migration
{
    public function up(): void
    {
        if ($this->db->tableExists('employee_leave_balances')) {
            return;
        }

        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'anniversary_year' => ['type' => 'SMALLINT', 'unsigned' => true],
            'years_of_service' => ['type' => 'TINYINT', 'unsigned' => true],
            'entitled_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'used_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'carried_over_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'prima_vacacional_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'period_start' => ['type' => 'DATE'],
            'period_end' => ['type' => 'DATE'],
            'expiration_date' => ['type' => 'DATE'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['employee_id', 'anniversary_year'], 'uq_leave_balance_employee_year');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_leave_balance_employee');
        $this->forge->createTable('employee_leave_balances', true);
    }

    public function down(): void
    {
        if ($this->db->tableExists('employee_leave_balances')) {
            $this->forge->dropTable('employee_leave_balances', true);
        }
    }
}
