<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use CodeIgniter\API\ResponseTrait;

abstract class BaseApiController extends BaseController
{
    use ResponseTrait;

    protected function jsonBody(): array
    {
        $body = $this->request->getJSON(true);
        return is_array($body) ? $body : [];
    }

    protected function activeConfig(): array
    {
        $configModel = model(\App\Models\AppConfigModel::class);
        $active = $configModel->where('is_active', 1)->orderBy('id', 'DESC')->first();

        if (is_array($active)) {
            return $active;
        }

        $id = $configModel->insert([
            'entry_time' => '08:30:00',
            'exit_time' => '17:30:00',
            'tolerance_minutes' => 10,
            'late_threshold_minutes' => 30,
            'working_hours_per_day' => 8.50,
            'is_active' => 1,
        ], true);

        return $configModel->find($id) ?? [];
    }

    protected function jwtPayload(): array
    {
        $raw = $_SERVER['JWT_PAYLOAD_JSON'] ?? null;
        if (!is_string($raw) || $raw === '') {
            return [];
        }
        $payload = json_decode($raw, true);
        return is_array($payload) ? $payload : [];
    }
}

