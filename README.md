# Plataforma de Asistencias (React + Vite + TypeScript)

Aplicación para analizar asistencias de Odoo en tiempo real **sin datos mock incrustados**.

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

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
- Deduplica por `empleado + fecha + hora_entrada`.
- Recalcula KPIs, reportes e incidencias al instante.

## Notas

- Si no se sube archivo, la UI permanece en estado vacío controlado.
- Si el archivo tiene columnas no reconocibles o datos mal formados, se mostrará error sin romper la app.
