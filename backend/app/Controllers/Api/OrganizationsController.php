<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\OrganizationModel;
use Throwable;

class OrganizationsController extends BaseApiController
{
    public function index()
    {
        try {
            $db = db_connect();
            if (!$db->tableExists('organizations')) {
                return $this->respond(['organizations' => []]);
            }
            return $this->respond(['organizations' => model(OrganizationModel::class)->listActive()]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron listar organizaciones: ' . $e->getMessage());
        }
    }
}
