<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateIdentityAndTimeClock extends Migration
{
    public function up()
    {
        // users
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'email' => ['type' => 'VARCHAR', 'constraint' => 255],
            'password_hash' => ['type' => 'VARCHAR', 'constraint' => 255],
            'role' => ['type' => 'VARCHAR', 'constraint' => 32, 'default' => 'employee'],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'failed_login_attempts' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'locked_until' => ['type' => 'DATETIME', 'null' => true],
            'last_login_at' => ['type' => 'DATETIME', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('email', 'uq_users_email');
        $this->forge->addUniqueKey('employee_id', 'uq_users_employee_id');
        $this->forge->addKey(['role', 'is_active'], false, false, 'idx_users_role_active');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'SET NULL', 'CASCADE', 'fk_users_employee');
        $this->forge->createTable('users', true);

        // employee credentials for kiosk
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'employee_code' => ['type' => 'VARCHAR', 'constraint' => 32],
            'pin_hash' => ['type' => 'VARCHAR', 'constraint' => 255],
            'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'failed_attempts' => ['type' => 'INT', 'unsigned' => true, 'default' => 0],
            'locked_until' => ['type' => 'DATETIME', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('employee_id', 'uq_employee_credentials_employee');
        $this->forge->addUniqueKey('employee_code', 'uq_employee_credentials_code');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_employee_credentials_employee');
        $this->forge->createTable('employee_credentials', true);

        // refresh tokens
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'user_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'token_hash' => ['type' => 'CHAR', 'constraint' => 64],
            'expires_at' => ['type' => 'DATETIME'],
            'revoked_at' => ['type' => 'DATETIME', 'null' => true],
            'ip_address' => ['type' => 'VARCHAR', 'constraint' => 45, 'null' => true],
            'user_agent' => ['type' => 'VARCHAR', 'constraint' => 512, 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('token_hash', 'uq_refresh_tokens_hash');
        $this->forge->addKey(['user_id', 'expires_at'], false, false, 'idx_refresh_user_exp');
        $this->forge->addForeignKey('user_id', 'users', 'id', 'CASCADE', 'CASCADE', 'fk_refresh_tokens_user');
        $this->forge->createTable('refresh_tokens', true);

        // punches
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'attendance_record_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'punch_type' => ['type' => 'VARCHAR', 'constraint' => 16],
            'punched_at' => ['type' => 'DATETIME'],
            'source' => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'web'],
            'device_id' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'created_by_user_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'geo_lat' => ['type' => 'DECIMAL', 'constraint' => '10,8', 'null' => true],
            'geo_lng' => ['type' => 'DECIMAL', 'constraint' => '11,8', 'null' => true],
            'geo_accuracy_meters' => ['type' => 'SMALLINT', 'unsigned' => true, 'null' => true],
            'notes' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['employee_id', 'punched_at'], false, false, 'idx_punches_emp_punched_at');
        $this->forge->addKey(['punch_type', 'punched_at'], false, false, 'idx_punches_type_punched_at');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_punches_employee');
        $this->forge->addForeignKey('attendance_record_id', 'attendance_records', 'id', 'SET NULL', 'CASCADE', 'fk_punches_attendance_record');
        $this->forge->addForeignKey('created_by_user_id', 'users', 'id', 'SET NULL', 'CASCADE', 'fk_punches_user');
        $this->forge->createTable('attendance_punches', true);

        // audit logs
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'actor_user_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'action' => ['type' => 'VARCHAR', 'constraint' => 64],
            'entity_type' => ['type' => 'VARCHAR', 'constraint' => 64],
            'entity_id' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'ip_address' => ['type' => 'VARCHAR', 'constraint' => 45, 'null' => true],
            'request_id' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'meta_json' => ['type' => 'LONGTEXT', 'null' => true],
            'occurred_at' => ['type' => 'DATETIME'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['entity_type', 'entity_id'], false, false, 'idx_audit_entity');
        $this->forge->addKey(['actor_user_id', 'occurred_at'], false, false, 'idx_audit_actor_time');
        $this->forge->addForeignKey('actor_user_id', 'users', 'id', 'SET NULL', 'CASCADE', 'fk_audit_user');
        $this->forge->createTable('audit_logs', true);

        // Extend existing employees
        $this->forge->addColumn('employees', [
            'employee_code' => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => true, 'after' => 'name'],
            'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1, 'after' => 'employee_code'],
        ]);
        $this->db->query('CREATE UNIQUE INDEX uq_employees_employee_code ON employees (employee_code)');

        // Extend attendance records for source traceability
        $this->forge->addColumn('attendance_records', [
            'data_source' => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'import', 'after' => 'status'],
            'first_punch_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true, 'after' => 'data_source'],
            'last_punch_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true, 'after' => 'first_punch_id'],
            'closed_at' => ['type' => 'DATETIME', 'null' => true, 'after' => 'last_punch_id'],
        ]);
    }

    public function down()
    {
        $this->forge->dropColumn('attendance_records', ['data_source', 'first_punch_id', 'last_punch_id', 'closed_at']);
        $this->db->query('DROP INDEX uq_employees_employee_code ON employees');
        $this->forge->dropColumn('employees', ['employee_code', 'is_active']);

        $this->forge->dropTable('audit_logs', true);
        $this->forge->dropTable('attendance_punches', true);
        $this->forge->dropTable('refresh_tokens', true);
        $this->forge->dropTable('employee_credentials', true);
        $this->forge->dropTable('users', true);
    }
}

