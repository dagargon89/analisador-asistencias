# Funcionamiento de la aplicación y cálculos sobre los datos

Documento técnico **alineado con el código vigente** (frontend React/Vite, backend CodeIgniter 4, MySQL). Describe qué datos entran, cómo se transforman, qué se persiste y **qué fórmulas o reglas** se aplican en cada capa.

---

## 1. Arquitectura general

| Capa | Rol |
|------|-----|
| **SPA (`src/`)** | Parseo del archivo (XLSX/CSV vía SheetJS), visualización, filtros por periodo, exportes, parte de la analítica en memoria, llamadas a API autenticadas. |
| **API (`backend/app/Controllers/Api/`)** | Importación persistente, listados, resúmenes, inasistencias (motor unificado), ajustes, chat con contexto, checador (kiosko). |
| **MySQL** | Empleados, registros de asistencia, importaciones, configuración de horario, reglas laborales (UI), calendario de inhábiles, fechas de contrato opcionales. |

**Fuente de verdad de los registros** tras iniciar sesión: la base de datos (tras `POST /api/import` o marcajes del checador). La UI recarga registros con `GET /api/records`.

---

## 2. Datos que se suben (archivo Odoo / Excel)

### 2.1 Formato esperado

- Archivo **`.xlsx`** o **`.csv`** (la UI usa principalmente XLSX con SheetJS).
- Primera hoja del libro; filas con encabezados reconocidos por **alias** (normalización sin acentos y sin caracteres especiales).

### 2.2 Columnas reconocidas (frontend)

Definidas en `FIELD_ALIASES` en `src/App.tsx`:

| Concepto | Aliases de columna (ejemplos) |
|----------|--------------------------------|
| Empleado | `employee`, `empleado`, `employee name`, `nombre`, `trabajador` |
| Entrada / check-in | `check in`, `checkin`, `check_in`, `entrada`, `fecha entrada`, `hora entrada` |
| Salida / check-out | `check out`, `checkout`, `check_out`, `salida`, `fecha salida`, `hora salida` |
| Horas trabajadas | `worked hours`, `hours worked`, `horas trabajadas`, `duracion`, `duration` |

### 2.3 Reglas de fila válida (parseo en cliente)

1. **Empleado**: texto no vacío tras `trim`.
2. **Entrada**: debe parsearse a fecha/hora (`parseDateLike`: fechas Excel numéricas, ISO, `dd/mm/yyyy` con hora opcional).
3. Si falta empleado o entrada → fila **inválida** (contador `invalidRows`, no entra al arreglo de registros).

### 2.4 Derivación por fila válida

| Campo | Cálculo |
|-------|---------|
| **`date`** | Fecha calendario (ISO `yyyy-mm-dd`) extraída del **check-in**, no de una columna “fecha” independiente. |
| **`entry`** | Hora `HH:mm` del check-in. |
| **`exit`** | Si hay check-out parseable → `HH:mm`; si no → cadena vacía. |
| **`hoursWorked`** | Si la columna de horas es numérica (o string con coma decimal) → ese valor. Si no es finito pero hay entrada y salida → \((\text{checkOut} - \text{checkIn}) / 3600000\) horas. Luego `max(0, …)` redondeado a 2 decimales. |

### 2.5 Deduplicación en cliente (antes de enviar al API)

- Clave: `empleado|yyyy-mm-dd|HH:mm` (entrada).
- Segunda fila con la misma clave → cuenta como **duplicado** en el resumen de subida y **no** se envía duplicada en el payload (solo la primera de cada clave).

### 2.6 Identificador de empleado en todo el sistema

Hoy el vínculo principal es el **nombre de empleado** (string) alineado entre:

- filas del archivo,
- tabla `employees.name`,
- joins en consultas.

No hay en el flujo de importación un ID externo de Odoo obligatorio; conviene mantener nombres **estables y únicos** para evitar duplicados lógicos o empleados bifurcados.

---

## 3. Qué envía el frontend al importar (`POST /api/import`)

Payload (`ImportPayload` en `src/api.ts`), generado tras `parseXlsx`:

- **`fileName`**, **`sourceType`**: `xlsx` o `csv` según extensión.
- **`config`**: horario usado para clasificar al persistir (ver sección 4).
- **`summary`**: `totalRows`, `invalidRows`, `duplicates` del parseo cliente.
- **`records`**: lista de objetos con al menos `employee`, `date` (`yyyy-mm-dd`), `entry` (`HH:mm`), `exit`, `hoursWorked` (el backend valida `date` + `entry`).

Tras éxito, la app llama **`getRecords()`** y sustituye el estado local por lo que devuelve la API (IDs reales de BD, etc.).

---

## 4. Importación en backend (`ImportController::store`)

### 4.1 Configuración activa (`app_config`)

En cada importación exitosa se **desactiva** la fila anterior (`is_active = 0`) y se inserta una nueva fila activa con:

| Campo | Origen / default |
|-------|------------------|
| `entry_time` | `config.entryTime` (default `08:30`) |
| `exit_time` | `config.exitTime` (default `17:30`) |
| `tolerance_minutes` | `config.toleranceMinutes` (default 10) |
| `late_threshold_minutes` | `config.lateThresholdMinutes` (default 30) |
| `working_hours_per_day` | `config.workingHoursPerDay` (default 8.5) |

Esa configuración activa es la que usa después el **checador** (`ClockService`) para clasificar entradas en vivo.

### 4.2 Normalización de filas en servidor

- Se eliminan duplicados **dentro del mismo payload** con clave `empleado|fecha|hora_entrada`.
- Cada fila debe tener `employee` no vacío, `date` en formato `yyyy-mm-dd`, `entry` en `HH:mm` o `HH:mm:ss`.

### 4.3 Empleados

- Se obtienen nombres únicos del lote.
- Por cada nombre que **no** exista en `employees`, se inserta (`name`; `is_active` por defecto 1 según migraciones).

### 4.4 Clasificación al persistir (`AttendanceClassifier`)

Para cada fila válida:

- `diff_minutos = minutos(entrada) - minutos(hora_entrada_programada)` usando solo HH:mm de la configuración del import.
- Si `diff <= tolerance_minutes` → **`ontime`**
- Si no, pero `diff <= late_threshold_minutes` → **`late`**
- Si no → **`verylate`**

(Es la misma lógica conceptual que `classifyEntry` en el frontend: mismos umbrales expresados en minutos respecto a `config.entryTime`.)

### 4.5 Inserción en `attendance_records`

- SQL **`INSERT IGNORE`** con clave única natural `(employee_id, work_date, check_in_time)`.
- Si ya existe esa terna → no se actualiza el registro existente; cuenta como duplicado detectado (`skippedExisting` + duplicados en archivo).
- Campos relevantes: `hours_worked`, `status`, `source_import_id`, `check_out_time` (nullable).

**Implicación:** corregir una hora de entrada en un reimport con la misma terna **no** sobrescribe la fila anterior; habría que borrar o cambiar el modelo de upsert para soportarlo.

---

## 5. Carga y filtros en la interfaz

### 5.1 Lista de empleados para reportes

- Si `GET /api/employees` responde: se usan nombres con **`is_active === true`** (ordenados).
- Si falla: **fallback** a nombres únicos derivados de los registros cargados (`recordEmployees`).

### 5.2 Periodo del reporte

- **Mes**: del día 1 al último día del mes seleccionado, **capado** a la fecha de hoy (no se proyectan días futuros del mes).
- **Semana**: rango de la opción de semana (lógica de calendario en `weekOptions`), también capado a hoy.
- **Día**: un solo `yyyy-mm-dd`.

Los KPIs “del periodo” usan **`filteredData`**: registros cuyo `date` cae en `[start, end]` del periodo y, si aplica, del empleado seleccionado.

---

## 6. Clasificación en pantalla (retardo / a tiempo)

Función **`classifyEntry(entryTime, config)`** (frontend), equivalente al clasificador PHP:

1. `diff = minutos(entrada) - minutos(config.entryTime)`.
2. Si `diff <= toleranceMinutes` → **a tiempo** (`ontime`).
3. Si `diff <= lateThresholdMinutes` → **retardo** (`late`).
4. Si no → **retardo mayor** (`verylate`).

**Nota:** Los estados mostrados en tablas del periodo se recalculan **en cliente** con la `config` actual de la UI (sincronizada con `GET/PUT /api/settings` cuando hay sesión). Los valores `status` guardados en BD en el momento del import o del checador pueden diferir si luego cambias tolerancias sin reimportar.

---

## 7. Inasistencias (motor unificado en servidor)

Implementación: **`App\Services\AbsenceExpectationService`**, identificador lógico:

`weekdays_active_calendar_contract_v1`

### 7.1 Definición operativa

Para el rango `[from, to]` (inclusive):

1. **Días candidatos**: todos los **lunes a viernes** en el rango (`N` = 1 … 5 en ISO).
2. Se excluyen fechas presentes en **`calendar_non_working_days`** dentro del rango (festivos / inhábiles configurables).
3. **Empleados considerados**: filas en `employees` con **`is_active = 1`**, opcionalmente filtradas por `name` si el API recibe `employee` distinto de vacío y de `all`.
4. **Contrato (opcional)** por empleado:
   - Si `hire_date` no es nulo: no se espera asistencia en días **anteriores** a esa fecha.
   - Si `termination_date` no es nulo: no se espera asistencia en días **posteriores** a esa fecha.
5. **Presencia**: existe al menos un registro en `attendance_records` con ese `employee_id` y `work_date` (cualquier hora de entrada; no se exige mínimo de horas ni salida cerrada para “presente” a efectos de inasistencia).
6. **Inasistencia**: para cada par (empleado activo en scope, día laboral esperado según 1–4), si **no** hay registro ese día → una inasistencia (par empleado + fecha).

### 7.2 Metadatos devueltos (`GET /api/absences`)

| Meta | Significado |
|------|-------------|
| `weekdayDaysInRange` | Cantidad de lun–vie en `[from, to]` sin filtrar calendario. |
| `calendarDaysExcluded` | Cuántas de esas fechas están marcadas como inhábiles en BD. |
| `workingDaysAfterCalendar` | Días laborales tras quitar inhábiles. |
| `expectedAttendanceSlots` | Suma, sobre todos los empleados en scope, de días en los que **sí** se esperaba asistencia según contrato. |
| `absenceSlots` | Total de pares (empleado, día) sin registro = longitud de la lista `absences`. |

### 7.3 Uso en el frontend

- Con **sesión iniciada**, la pestaña / KPIs de inasistencias del **periodo seleccionado** obtienen la lista vía **`GET /api/absences`** (mismos `from`/`to` que el periodo capado y filtro de empleado).
- **Sin sesión o si la petición falla**: se usa el **cálculo local** anterior: cruza `absenceBaseEmployees` × `getWorkingDays(periodo)` contra un `Set` de `empleado|fecha` presente en los registros cargados (sin tabla de calendario ni `hire_date`/`termination_date`).

### 7.4 Export JSON (`buildAttendanceJson`)

- Si hay sesión y coincide caché del rango **mín–máx de fechas** de los registros cargados con la respuesta de `getAbsences` para ese mismo rango, las inasistencias del JSON usan **la misma lista del servidor**, filtrada a empleados que aparecen en el archivo/registros y al rango de fechas del conjunto.
- Si no hay caché servidor: mismo criterio local que el punto 7.3 (solo lun–vie entre min y max fecha de los registros, solo empleados que ya tienen al menos un registro en el conjunto).

---

## 8. Otros cálculos en dashboard y reportes (frontend)

### 8.1 Conteos del periodo filtrado

Sobre **`filteredData`** (registros del periodo, no “días únicos” obligatoriamente):

- **A tiempo / Retardo / Retardo mayor**: un conteo **por registro** según `classifyEntry`.
- **Horas totales**: suma de `hoursWorked`.
- **Promedio de horas**: `totalHoras / número de registros` del periodo (promedio por **marca**, no por día natural único).

### 8.2 Resumen por empleado (`employeeReport`)

Por empleado en el periodo:

- **`days`**: número de **registros** (filas), no necesariamente días únicos con varias entradas el mismo día.
- **`onTime` / `late` / `veryLate`**: conteos por registro.
- **`totalHours`**: suma de `hoursWorked`.
- **`absences`**: tomado del arreglo **`absenceData`** (servidor o local, según 7.3).

### 8.3 Tasa de inasistencias (widget)

\[
\text{tasa \%} = \frac{\text{absenceData.length}}{\max(1,\; |\text{empleados base}| \times |\text{días hábiles lun–vie en el periodo}|)} \times 100
\]

Donde “días hábiles” del denominador es **`getWorkingDays(start, end)`** en cliente (no resta inhábiles de BD). Con sesión, el **numerador** sí puede reflejar el motor del servidor; el denominador puede **no** coincidir al 100 % con `expectedAttendanceSlots` del API si hay calendario o contratos distintos. Es una limitación conocida del denominador en UI.

### 8.4 “Puntualidad %” en JSON agregado por empleado

\[
\text{puntualidadPct} = \text{round}\left( \frac{\text{aTiempo}}{\max(\text{días}, 1)} \times 100 \right)
\]

Aquí **`días`** es el número de registros agregados por empleado en `buildAttendanceJson`, no días esperados de asistencia.

---

## 9. Retardos acumulados y “faltas equivalentes” (solo frontend, reglas configurables)

Rango fijo: **mes calendario seleccionado**, capado a hoy (`lateAccumulationRange`).

Por empleado, sobre **`lateAccumulationSourceData`**:

- Cuenta **`late`** y **`veryLate`** según `classifyEntry`.

Parámetros desde **`laborRules`** (persistidos vía API de settings, más defaults en UI):

- `lateFormalFromNthInMonth` → `formalFrom = max(1, valor)`.
- `formalLateActaAtNth` → `actaAt = max(1, valor)`.
- `actasForTerminationInYear` → `terminationActas = max(1, valor)`.
- `directLateAfterTolerance`: si es `true`, `totalComputable = late + veryLate`; si es `false`, solo `veryLate`.

Derivados:

| Derivado | Fórmula / regla |
|----------|-----------------|
| `formalized` | `totalComputable >= formalFrom` |
| `actas` | `floor(totalComputable / actaAt)` |
| `equivalentAbsences` | **Igual a `actas`** en el código actual (etiqueta “faltas equivalentes” = número de actas por umbral). |
| `progressPct` | `(totalComputable % actaAt) / actaAt * 100` redondeado. |
| `nextActaIn` | Si el resto es 0 → `actaAt`; si no → `actaAt - resto`. |

Texto de **sanción** es heurístico en UI (concatena actas y riesgo si `actas >= terminationActas`). **No** sustituye dictamen legal; el archivo `reglas/reglas.md` es referencia normativa, no ejecutable línea a línea en el motor.

---

## 10. Checador (kiosko) y coherencia con import

- **`ClockService::clockIn`**: inserta fila en `attendance_records` con `check_in_time` actual, `status` según `AttendanceClassifier` y la **config activa** en `app_config`.
- **`clockOut`**: cierra la jornada abierta, calcula horas entre entrada y salida.
- Misma tabla `attendance_records` que el import: las inasistencias del servidor cuentan **cualquier** fila ese día (import o kiosko).

Restricción de unicidad: no puede haber dos filas con el mismo `(employee_id, work_date, check_in_time)`; un segundo checado con la misma hora exacta colisionaría.

---

## 11. Chat (`POST /api/chat`)

- Construye un **texto de contexto** con agregados del periodo (`from`/`to` del filtro o min/max de BD si faltan fechas válidas).
- Las **inasistencias** en ese contexto usan el mismo **`AbsenceExpectationService`** que `GET /api/absences`.
- Si Gemini está configurado, el modelo recibe ese contexto; si no, el usuario recibe el resumen textual igualmente.

---

## 12. Resumen ejecutivo: qué “promete” hoy el sistema

| Pregunta | Respuesta según implementación |
|----------|---------------------------------|
| ¿Qué es un día con asistencia? | Hay **≥ 1** registro en `attendance_records` para ese empleado y `work_date`. |
| ¿Qué es inasistencia (servidor)? | Día laboral esperado (lun–vie, sin inhábil, dentro de contrato) **sin** ese registro, para empleados **activos**. |
| ¿Justificaciones / vacaciones? | **No** modeladas aún; un día inhábil debe cargarse en `calendar_non_working_days`. |
| ¿Horas mínimas para considerar asistencia válida? | **No**; basta con una entrada (aunque horas sean 0). |
| ¿Retardo? | Comparación de **hora de entrada** vs horario y tolerancias (cliente y servidor al importar/checar). |
| ¿Faltas equivalentes por retardos? | **Solo** en la vista de acumulados; fórmula `floor(totalComputable / actaAt)` con reglas de `laborRules`. |

---

## 13. Referencias de código (orientación)

| Tema | Ubicación principal |
|------|----------------------|
| Parseo XLSX y horas | `src/App.tsx` — `parseXlsx`, `FIELD_ALIASES`, `parseDateLike` |
| Clasificación entrada | `src/App.tsx` — `classifyEntry`; `backend/app/Services/AttendanceClassifier.php` |
| Import y persistencia | `backend/app/Controllers/Api/ImportController.php` |
| Inasistencias servidor | `backend/app/Services/AbsenceExpectationService.php`, `GET .../api/absences` |
| Inasistencias cliente (fallback) | `src/App.tsx` — `absenceData`, `getWorkingDays`, `buildAttendanceJson` |
| Retardos acumulados | `src/App.tsx` — `lateAccumulationReport` |
| Calendario y contrato | Migración `2026-04-23-000001_AbsenceExpectationSupport`, tablas `calendar_non_working_days`, columnas `employees.hire_date`, `employees.termination_date` |

---

*Última revisión alineada con el repositorio: documento generado para describir el comportamiento actual; si cambian migraciones o fórmulas en UI/API, conviene actualizar este archivo en el mismo cambio.*
