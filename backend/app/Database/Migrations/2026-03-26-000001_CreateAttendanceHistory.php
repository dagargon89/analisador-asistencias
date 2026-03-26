<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateAttendanceHistory extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'name' => ['type' => 'VARCHAR', 'constraint' => 180],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('name', 'uq_employees_name');
        $this->forge->createTable('employees', true);

        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'file_name' => ['type' => 'VARCHAR', 'constraint' => 255],
            'source_type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'xlsx'],
            'records_received' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'records_inserted' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'records_updated' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'duplicates_detected' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'invalid_rows' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'uploaded_at' => ['type' => 'DATETIME'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->createTable('imports', true);

        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'work_date' => ['type' => 'DATE'],
            'check_in_time' => ['type' => 'TIME'],
            'check_out_time' => ['type' => 'TIME', 'null' => true],
            'hours_worked' => ['type' => 'DECIMAL', 'constraint' => '6,2', 'default' => 0],
            'status' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'ontime'],
            'source_import_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['employee_id', 'work_date', 'check_in_time'], 'uq_attendance_unique_record');
        $this->forge->addKey('work_date', false, false, 'idx_attendance_work_date');
        $this->forge->addKey(['employee_id', 'work_date'], false, false, 'idx_attendance_employee_date');
        $this->forge->addKey(['work_date', 'status'], false, false, 'idx_attendance_status_date');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_attendance_employee');
        $this->forge->addForeignKey('source_import_id', 'imports', 'id', 'SET NULL', 'CASCADE', 'fk_attendance_import');
        $this->forge->createTable('attendance_records', true);

        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'entry_time' => ['type' => 'TIME'],
            'exit_time' => ['type' => 'TIME'],
            'tolerance_minutes' => ['type' => 'INT', 'unsigned' => true, 'default' => 10],
            'late_threshold_minutes' => ['type' => 'INT', 'unsigned' => true, 'default' => 30],
            'working_hours_per_day' => ['type' => 'DECIMAL', 'constraint' => '4,2', 'default' => 8.50],
            'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('is_active');
        $this->forge->createTable('app_config', true);
    }

    public function down()
    {
        $this->forge->dropTable('attendance_records', true);
        $this->forge->dropTable('app_config', true);
        $this->forge->dropTable('imports', true);
        $this->forge->dropTable('employees', true);
    }
}

