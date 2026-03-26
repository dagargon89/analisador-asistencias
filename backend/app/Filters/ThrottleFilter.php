<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;

class ThrottleFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $limit = (int) ($arguments[0] ?? 20);
        $window = (int) ($arguments[1] ?? 60);
        $keyPrefix = (string) ($arguments[2] ?? 'global');

        $ip = (string) $request->getIPAddress();
        $cacheKey = 'throttle_' . preg_replace('/[^a-z0-9_]/i', '_', $keyPrefix) . '_' . md5($ip . '|' . $request->getPath());

        $cache = cache();
        $hits = (int) ($cache->get($cacheKey) ?? 0);
        if ($hits >= $limit) {
            return Services::response()->setStatusCode(429)->setJSON([
                'error' => 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.',
            ]);
        }
        $cache->save($cacheKey, $hits + 1, $window);
        return null;
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}

