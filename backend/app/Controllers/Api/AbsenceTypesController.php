<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\AbsenceTypeModel;
use Throwable;

class AbsenceTypesController extends BaseApiController
{
    public function index()
    {
        try {
            $model = model(AbsenceTypeModel::class);
            return $this->respond(['types' => $model->listActive()]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron cargar tipos: ' . $e->getMessage());
        }
    }
}
