<?php

namespace App\Filters;

use App\Services\JwtService;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;

class RoleFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $allowed = is_array($arguments) ? $arguments : [];
        if ($allowed === []) {
            return null;
        }

        $payload = null;
        if (isset($_SERVER['JWT_PAYLOAD_JSON']) && is_string($_SERVER['JWT_PAYLOAD_JSON'])) {
            $decoded = json_decode($_SERVER['JWT_PAYLOAD_JSON'], true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }
        if (!is_array($payload)) {
            $auth = (string) $request->getHeaderLine('Authorization');
            if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
                return Services::response()->setStatusCode(401)->setJSON(['error' => 'No autorizado.']);
            }
            try {
                $payload = (new JwtService())->verify(trim($m[1]));
            } catch (\Throwable $e) {
                return Services::response()->setStatusCode(401)->setJSON(['error' => 'Token inválido.']);
            }
        }

        $role = (string) ($payload['role'] ?? '');
        if (!in_array($role, $allowed, true)) {
            return Services::response()->setStatusCode(403)->setJSON(['error' => 'Sin permisos para este recurso.']);
        }

        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}

