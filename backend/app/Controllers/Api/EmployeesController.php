<?php

namespace App\Controllers\Api;

class EmployeesController extends BaseApiController
{
    public function index()
    {
        $rows = model(\App\Models\EmployeeModel::class)
            ->select('id, name')
            ->orderBy('name', 'ASC')
            ->findAll();

        return $this->respond([
            'employees' => array_map(static fn($r) => [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
            ], $rows),
        ]);
    }
}

