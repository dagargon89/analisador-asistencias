<?php

declare(strict_types=1);

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class AbsenceTypesSeeder extends Seeder
{
    public function run(): void
    {
        $now = date('Y-m-d H:i:s');
        $types = [
            ['VAC',          'Vacaciones',               1, 1, 1, 0, '#2F80ED', 10],
            ['PRIMA_VAC',    'Prima vacacional',         1, 0, 0, 0, '#6FCF97', 20],
            ['PER_GOCE',     'Permiso con goce',         1, 1, 0, 0, '#56CCF2', 30],
            ['PER_SIN_GOCE', 'Permiso sin goce',         0, 0, 0, 1, '#F2994A', 40],
            ['INC_IMSS',     'Incapacidad IMSS',         1, 1, 0, 1, '#9B51E0', 50],
            ['INC_GEN',      'Incapacidad general',      1, 1, 0, 1, '#BB6BD9', 55],
            ['MAT',          'Maternidad',               1, 1, 0, 1, '#EB5757', 60],
            ['PAT',          'Paternidad',               1, 1, 0, 1, '#F2C94C', 65],
            ['LUTO',         'Defunción familiar',       1, 1, 0, 0, '#828282', 70],
            ['CAP',          'Capacitación',             1, 1, 0, 0, '#219653', 80],
            ['SUSP',         'Suspensión disciplinaria', 0, 0, 0, 1, '#EB5757', 90],
            ['FALTA_JUST',   'Falta justificada s/goce', 0, 0, 0, 1, '#F2994A', 95],
        ];

        $rows = [];
        foreach ($types as [$code, $label, $paid, $cw, $ab, $rd, $color, $order]) {
            $rows[] = [
                'code' => $code,
                'label' => $label,
                'paid' => $paid,
                'counts_as_worked_day' => $cw,
                'affects_leave_balance' => $ab,
                'requires_document' => $rd,
                'color_hex' => $color,
                'display_order' => $order,
                'is_active' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        $this->db->table('absence_types')->ignore(true)->insertBatch($rows);
    }
}
