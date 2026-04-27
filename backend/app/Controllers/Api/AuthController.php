<?php

namespace App\Controllers\Api;

use App\Services\AuditService;
use App\Services\JwtService;
use Throwable;

class AuthController extends BaseApiController
{
    public function login()
    {
        $body = $this->jsonBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $password === '') {
            return $this->failValidationErrors('Email y contraseña son obligatorios.');
        }

        $userModel = model(\App\Models\UserModel::class);
        $user = $userModel->where('email', $email)->first();
        if (!is_array($user)) {
            return $this->failUnauthorized('Credenciales inválidas.');
        }

        if (!(bool) $user['is_active']) {
            return $this->failForbidden('Usuario desactivado.');
        }

        if ($this->isLocked($user['locked_until'] ?? null)) {
            return $this->respond(['error' => 'Cuenta bloqueada temporalmente por intentos fallidos.'], 423);
        }

        if (!password_verify($password, (string) $user['password_hash'])) {
            $failed = ((int) $user['failed_login_attempts']) + 1;
            $updates = ['failed_login_attempts' => $failed];
            if ($failed >= (int) env('auth.maxFailedAttempts', 5)) {
                $minutes = (int) env('auth.lockoutMinutes', 10);
                $updates['locked_until'] = date('Y-m-d H:i:s', time() + ($minutes * 60));
                $updates['failed_login_attempts'] = 0;
            }
            $userModel->update((int) $user['id'], $updates);
            return $this->failUnauthorized('Credenciales inválidas.');
        }

        $userModel->update((int) $user['id'], [
            'failed_login_attempts' => 0,
            'locked_until' => null,
            'last_login_at' => date('Y-m-d H:i:s'),
        ]);

        try {
            $jwt = new JwtService();
            $accessToken = $jwt->issueAccessToken([
                'sub' => (int) $user['id'],
                'role' => (string) $user['role'],
                'employee_id' => $user['employee_id'] ? (int) $user['employee_id'] : null,
                'typ' => 'access',
            ]);
            $refreshToken = bin2hex(random_bytes(48));
            $this->persistRefreshToken((int) $user['id'], $refreshToken);

            (new AuditService())->log(
                (int) $user['id'],
                'LOGIN',
                'user',
                (string) $user['id'],
                $this->request->getIPAddress(),
                null,
                ['email' => $email]
            );

            return $this->respond([
                'accessToken' => $accessToken,
                'refreshToken' => $refreshToken,
                'user' => [
                    'id' => (int) $user['id'],
                    'email' => (string) $user['email'],
                    'role' => (string) $user['role'],
                    'employeeId' => $user['employee_id'] ? (int) $user['employee_id'] : null,
                ],
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo iniciar sesión: ' . $e->getMessage());
        }
    }

    public function refresh()
    {
        $body = $this->jsonBody();
        $refreshToken = trim((string) ($body['refreshToken'] ?? ''));
        if ($refreshToken === '') {
            return $this->failValidationErrors('refreshToken es obligatorio.');
        }

        $tokenModel = model(\App\Models\RefreshTokenModel::class);
        $userModel = model(\App\Models\UserModel::class);
        $tokenHash = hash('sha256', $refreshToken);
        $row = $tokenModel->where('token_hash', $tokenHash)->first();
        if (!is_array($row)) {
            return $this->failUnauthorized('Refresh token inválido.');
        }

        if ($row['revoked_at'] !== null || strtotime((string) $row['expires_at']) < time()) {
            return $this->failUnauthorized('Refresh token expirado o revocado.');
        }

        $user = $userModel->find((int) $row['user_id']);
        if (!is_array($user) || !(bool) $user['is_active']) {
            return $this->failUnauthorized('Usuario no válido para refrescar sesión.');
        }

        try {
            $jwt = new JwtService();
            $accessToken = $jwt->issueAccessToken([
                'sub' => (int) $user['id'],
                'role' => (string) $user['role'],
                'employee_id' => $user['employee_id'] ? (int) $user['employee_id'] : null,
                'typ' => 'access',
            ]);
            $newRefresh = bin2hex(random_bytes(48));
            $this->persistRefreshToken((int) $user['id'], $newRefresh);
            $tokenModel->update((int) $row['id'], ['revoked_at' => date('Y-m-d H:i:s')]);

            return $this->respond([
                'accessToken' => $accessToken,
                'refreshToken' => $newRefresh,
            ]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo refrescar la sesión.');
        }
    }

    public function logout()
    {
        $body = $this->jsonBody();
        $refreshToken = trim((string) ($body['refreshToken'] ?? ''));
        if ($refreshToken !== '') {
            $tokenHash = hash('sha256', $refreshToken);
            model(\App\Models\RefreshTokenModel::class)
                ->where('token_hash', $tokenHash)
                ->set(['revoked_at' => date('Y-m-d H:i:s')])
                ->update();
        }
        $payload = $this->jwtPayload();
        $uid = isset($payload['sub']) ? (int) $payload['sub'] : null;
        if ($uid) {
            (new AuditService())->log($uid, 'LOGOUT', 'user', (string) $uid, $this->request->getIPAddress());
        }
        return $this->respond(['ok' => true]);
    }

    public function me()
    {
        $payload = $this->jwtPayload();
        if ($payload === []) {
            return $this->failUnauthorized('No autorizado.');
        }

        $user = model(\App\Models\UserModel::class)->find((int) ($payload['sub'] ?? 0));
        if (!is_array($user)) {
            return $this->failNotFound('Usuario no encontrado.');
        }

        return $this->respond([
            'user' => [
                'id' => (int) $user['id'],
                'email' => (string) $user['email'],
                'role' => (string) $user['role'],
                'employeeId' => $user['employee_id'] ? (int) $user['employee_id'] : null,
            ],
        ]);
    }

    public function createUser()
    {
        $payload = $this->jwtPayload();
        if (!in_array((string) ($payload['role'] ?? ''), ['admin', 'supervisor'], true)) {
            return $this->failForbidden('Solo admin/supervisor puede crear usuarios.');
        }

        $body = $this->jsonBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = trim((string) ($body['password'] ?? ''));
        $role = trim((string) ($body['role'] ?? 'employee'));
        $employeeId = isset($body['employeeId']) ? (int) $body['employeeId'] : null;
        if ($email === '' || $password === '' || strlen($password) < 8) {
            return $this->failValidationErrors('Email y contraseña (mínimo 8) son obligatorios.');
        }
        if (!in_array($role, ['admin', 'supervisor', 'employee', 'readonly'], true)) {
            return $this->failValidationErrors('Rol no válido.');
        }

        $userModel = model(\App\Models\UserModel::class);
        $exists = $userModel->where('email', $email)->first();
        if ($exists) {
            return $this->failValidationErrors('El email ya está registrado.');
        }

        $id = $userModel->insert([
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => $role,
            'employee_id' => $employeeId > 0 ? $employeeId : null,
            'is_active' => 1,
        ], true);

        (new AuditService())->log(
            isset($payload['sub']) ? (int) $payload['sub'] : null,
            'USER_CREATE',
            'user',
            (string) $id,
            $this->request->getIPAddress(),
            null,
            ['email' => $email, 'role' => $role]
        );

        return $this->respondCreated([
            'ok' => true,
            'user' => [
                'id' => (int) $id,
                'email' => $email,
                'role' => $role,
                'employeeId' => $employeeId > 0 ? $employeeId : null,
            ],
        ]);
    }

    private function persistRefreshToken(int $userId, string $refreshToken): void
    {
        $ttlSeconds = (int) env('auth.refreshTtlSeconds', 2592000);
        model(\App\Models\RefreshTokenModel::class)->insert([
            'user_id' => $userId,
            'token_hash' => hash('sha256', $refreshToken),
            'expires_at' => date('Y-m-d H:i:s', time() + $ttlSeconds),
            'ip_address' => (string) $this->request->getIPAddress(),
            'user_agent' => substr((string) $this->request->getUserAgent(), 0, 512),
        ]);
    }

}

