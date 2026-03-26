# Plataforma de Asistencias (React + Vite + CodeIgniter 4 + MySQL)

Aplicación para analizar asistencias de Odoo con historial persistente en base de datos y chat consultando datos reales.

## Requisitos

- Node.js 20+
- npm 10+
- PHP 8.2+
- Composer 2+
- MySQL/MariaDB

## Instalación

```bash
npm install
cd backend && composer install
```

## Configuración backend (CodeIgniter 4)

1. Copia el archivo de entorno:

```bash
cp backend/.env.example backend/.env
```

2. Configura en `backend/.env`:
- `app.baseURL`
- credenciales `database.default.*`
- `gemini.apiKey` (opcional, pero recomendado para chat IA)
- `auth.jwtSecret` (obligatorio para sesión JWT)

3. Ejecuta migraciones:

```bash
cd backend
php spark migrate
```

4. Crear admin inicial (opcional pero recomendado):

```bash
php spark db:seed AuthBootstrapSeeder
```

Las credenciales se toman de `auth.bootstrapAdminEmail` y `auth.bootstrapAdminPassword` en `backend/.env`.

## Desarrollo local

Terminal 1 (frontend):

```bash
npm run dev
```

Terminal 2 (backend API):

```bash
cd backend
php spark serve
```

En frontend, define `VITE_API_BASE_URL` (por ejemplo `http://localhost:8080`) en `.env`.

## Sistema de usuarios + sesión + checador

### Login web (admin/supervisor)
- Endpoint login: `POST /api/auth/login`.
- La SPA usa `accessToken + refreshToken`.
- Reportes/import/chat quedan protegidos por JWT + rol (`admin` o `supervisor`).

### Kiosko (código + PIN)
- URL kiosko: `/kiosk`.
- Endpoint auth kiosko: `POST /api/kiosk/auth`.
- Endpoints de marcación:
  - `POST /api/attendance/clock-in`
  - `POST /api/attendance/clock-out`
  - `GET /api/attendance/me/today`

### Alta rápida de usuarios y credenciales
- Crear usuario de aplicación:
  - `POST /api/auth/users` (requiere admin/supervisor).
- Configurar código/PIN de empleado:
  - `POST /api/employees/{id}/credential` (requiere admin/supervisor).

## Build de producción

```bash
npm run build
npm run preview
```

## Formato esperado del archivo

Sube un archivo `.xlsx` (o `.xls`) exportado desde Odoo `hr.attendance` con encabezados equivalentes a:

- `Employee` / `Empleado`
- `Check In` / `Entrada`
- `Check Out` / `Salida`
- `Worked Hours` / `Horas trabajadas` (opcional)

La app:

- Normaliza fechas y horas.
- Omite filas inválidas (sin empleado o sin hora de entrada).
- Deduplica por `empleado + fecha + hora_entrada` y hace upsert en BBDD.
- Mantiene historial para consultas sin re-subir archivos antiguos.
- Recalcula KPIs, reportes e incidencias desde datos persistidos.

## Notas

- El endpoint principal de importación es `POST /api/import`.
- El chat consume `POST /api/chat` y usa contexto agregado desde SQL.
- En producción con cPanel, usar `.htaccess` de la raíz para enrutar `/api/*` a `backend/public/index.php`.
- Endpoints sensibles tienen `throttle` y bloqueo temporal por intentos fallidos (login y kiosko).
