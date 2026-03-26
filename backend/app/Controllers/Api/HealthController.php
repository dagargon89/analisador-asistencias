<?php

namespace App\Controllers\Api;

class HealthController extends BaseApiController
{
    public function index()
    {
        return $this->respond([
            'ok' => true,
            'service' => 'attendance-api',
            'timestamp' => date(DATE_ATOM),
        ]);
    }

    public function optionsPreflight()
    {
        return $this->respondNoContent();
    }
}

