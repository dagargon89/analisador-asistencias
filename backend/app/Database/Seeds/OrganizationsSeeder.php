<?php

declare(strict_types=1);

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class OrganizationsSeeder extends Seeder
{
    public function run(): void
    {
        $now = date('Y-m-d H:i:s');
        $orgs = [
            ['FCFN', 'Fundación Casa de la Familia Neyra'],
            ['PEJ', 'Participa Juárez'],
            ['CEHLIDER', 'Cehlider'],
            ['AEP', 'AEP'],
        ];
        $rows = [];
        foreach ($orgs as [$code, $name]) {
            $rows[] = [
                'code' => $code,
                'name' => $name,
                'is_active' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        $this->db->table('organizations')->ignore(true)->insertBatch($rows);
    }
}
