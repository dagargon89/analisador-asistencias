<?php

namespace App\Filters;

use App\Services\JwtService;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;

class JwtAuthFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $auth = (string) $request->getHeaderLine('Authorization');
        if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            return Services::response()
                ->setStatusCode(401)
                ->setJSON(['error' => 'No autorizado. Falta token Bearer.']);
        }

        try {
            $payload = (new JwtService())->verify(trim($m[1]));
            $_SERVER['JWT_PAYLOAD_JSON'] = json_encode($payload, JSON_UNESCAPED_UNICODE);
            return null;
        } catch (\Throwable $e) {
            return Services::response()
                ->setStatusCode(401)
                ->setJSON(['error' => 'Token inválido o expirado.']);
        }
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}

