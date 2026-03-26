<?php

namespace App\Services;

use RuntimeException;

class JwtService
{
    private string $secret;
    private string $issuer;
    private int $ttlAccess;
    private int $ttlKiosk;

    public function __construct()
    {
        $this->secret = (string) env('auth.jwtSecret', 'dev-secret-change-me');
        if (trim($this->secret) === '') {
            throw new RuntimeException('Configura auth.jwtSecret en backend/.env');
        }
        $this->issuer = (string) env('auth.jwtIssuer', 'attendance-app');
        $this->ttlAccess = (int) env('auth.accessTtlSeconds', 900);
        $this->ttlKiosk = (int) env('auth.kioskTtlSeconds', 600);
    }

    public function issueAccessToken(array $claims): string
    {
        return $this->encode($claims, $this->ttlAccess);
    }

    public function issueKioskToken(array $claims): string
    {
        return $this->encode($claims, $this->ttlKiosk);
    }

    public function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new RuntimeException('Token JWT inválido.');
        }
        [$h64, $p64, $s64] = $parts;
        $base = $h64 . '.' . $p64;
        $expected = $this->base64url(hash_hmac('sha256', $base, $this->secret, true));
        if (!hash_equals($expected, $s64)) {
            throw new RuntimeException('Firma JWT inválida.');
        }

        $payload = json_decode($this->base64urlDecode($p64), true);
        if (!is_array($payload)) {
            throw new RuntimeException('Payload JWT inválido.');
        }
        $now = time();
        if ((int) ($payload['exp'] ?? 0) < $now) {
            throw new RuntimeException('Token expirado.');
        }
        if ((string) ($payload['iss'] ?? '') !== $this->issuer) {
            throw new RuntimeException('Issuer JWT inválido.');
        }

        return $payload;
    }

    private function encode(array $claims, int $ttl): string
    {
        $now = time();
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $payload = array_merge($claims, [
            'iss' => $this->issuer,
            'iat' => $now,
            'exp' => $now + $ttl,
        ]);
        $h64 = $this->base64url(json_encode($header, JSON_UNESCAPED_UNICODE));
        $p64 = $this->base64url(json_encode($payload, JSON_UNESCAPED_UNICODE));
        $sig = hash_hmac('sha256', $h64 . '.' . $p64, $this->secret, true);
        return $h64 . '.' . $p64 . '.' . $this->base64url($sig);
    }

    private function base64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function base64urlDecode(string $raw): string
    {
        $remainder = strlen($raw) % 4;
        if ($remainder > 0) {
            $raw .= str_repeat('=', 4 - $remainder);
        }
        return (string) base64_decode(strtr($raw, '-_', '+/'));
    }
}

