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

3. Ejecuta migraciones:

```bash
cd backend
php spark migrate
```

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
