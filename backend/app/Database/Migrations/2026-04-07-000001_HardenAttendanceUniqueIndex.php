<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class HardenAttendanceUniqueIndex extends Migration
{
    public function up()
    {
        if (!$this->db->tableExists('attendance_records')) {
            return;
        }

        // Keep the oldest row per natural key and remove historical duplicates.
        $this->db->query(
            'DELETE ar1 FROM attendance_records ar1
             INNER JOIN attendance_records ar2
               ON ar1.employee_id = ar2.employee_id
              AND ar1.work_date = ar2.work_date
              AND ar1.check_in_time = ar2.check_in_time
              AND ar1.id > ar2.id'
        );

        $indexInfo = $this->db->query(
            "SELECT NON_UNIQUE
               FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'attendance_records'
                AND INDEX_NAME = 'uq_attendance_unique_record'
              LIMIT 1"
        )->getRowArray();

        $mustCreateUnique = $indexInfo === null || (int) ($indexInfo['NON_UNIQUE'] ?? 1) === 1;

        if ($indexInfo !== null && (int) ($indexInfo['NON_UNIQUE'] ?? 1) === 1) {
            $this->db->query('DROP INDEX uq_attendance_unique_record ON attendance_records');
        }

        if ($mustCreateUnique) {
            $this->db->query(
                'CREATE UNIQUE INDEX uq_attendance_unique_record
                 ON attendance_records (employee_id, work_date, check_in_time)'
            );
        }
    }

    public function down()
    {
        // No-op: duplicate cleanup is irreversible and unique index should remain.
    }
}
