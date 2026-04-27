# Implementación: Módulo Unificado de Vacaciones, Ausencias Tipificadas y Reporte Quincenal

> Documento de especificación técnica para implementación asistida por IA. Está alineado con el estado actual del repositorio `dagargon89/analisador-asistencias` (rama main al 23-abr-2026). Todas las rutas de archivo, namespaces, convenciones de CI4 y patrones de React reflejan el código existente.

---

## 0. Cómo usar este documento

Este documento está escrito para ser ejecutado **paso a paso** por una IA de editor de código (Cursor, Claude Code, Copilot Agent). Cada sección incluye:

- Archivos nuevos a crear con **contenido completo listo para pegar**.
- Archivos existentes a modificar con **diffs conceptuales** (qué agregar y dónde).
- Comandos de verificación (`php spark migrate`, `npm run build`).
- Criterios de "done" verificables.

**Regla de oro**: No reescribir archivos existentes; **extender**. El `AbsenceExpectationService` actual se refactoriza sin romper su firma pública `computeAbsences()` — se le añade un segundo método que devuelve estados tipificados, y el antiguo se mantiene como fachada que delega internamente.

**Orden obligatorio de ejecución**: Sprint 1 → 2 → 3 → 4. Cada sprint deja el sistema funcional y desplegable.

---

## 1. Contexto y objetivos del cambio

### 1.1 Problema actual

El servicio `App\Services\AbsenceExpectationService` hoy clasifica cada par `(empleado, día laboral)` en dos estados: **Presente** o **Ausente**. No distingue entre una falta real, unas vacaciones autorizadas, una incapacidad del IMSS ni un permiso. Esto sesga:

- Tasa de inasistencia en el dashboard (`/api/summary`, `/api/absences`).
- Faltas equivalentes por retardos (`lateAccumulationReport` en `src/App.tsx`).
- Contexto del chat IA (`/api/chat`).

### 1.2 Estado objetivo

Cada par `(empleado, día laboral)` se resolverá en **cinco estados determinísticos**:

| Estado | Significado | Afecta tasa inasistencia | Cuenta como día trabajado |
|---|---|---|---|
| `NOT_EXPECTED` | Fuera de contrato, fin de semana o inhábil | No | n/a |
| `PRESENT` | Registro en `attendance_records` | No | Sí |
| `JUSTIFIED_WORKED` | Vacaciones, incapacidad pagada, permiso con goce | No | Sí (nómina) |
| `JUSTIFIED_UNPAID` | Permiso sin goce, suspensión | No | No |
| `UNJUSTIFIED_ABSENCE` | Falta real | Sí | No |

Adicionalmente:

- Catálogo de **tipos de ausencia** configurable (`absence_types`).
- Registro formal de **ausencias aprobadas** (`employee_absences`) con documento soporte.
- **Saldo de vacaciones** conforme LFT reforma 2023 (`employee_leave_balances`).
- Concepto de **periodo quincenal** (`payroll_periods`) para cierre y reporte.
- **Exportador XLSX** que replica el formato de `Incidencias_FCFN_2026.xlsx`.

### 1.3 Sprints

| Sprint | Entregable | Semanas |
|---|---|---|
| 1 | Motor de 5 estados + catálogo de tipos + CRUD ausencias | 2 |
| 2 | Saldos LFT + job de aniversario + importador histórico | 3 |
| 3 | Periodos quincenales + reporte XLSX | 3 |
| 4 | Flujo de aprobación + multi-organización + dashboard tipificado | 3 |

---

## 2. Principios y convenciones no negociables

### 2.1 Backend (CodeIgniter 4.7)

- **Migraciones**: usar `$this->forge`. Nunca `$this->db->query('CREATE TABLE ...')`. Los nombres siguen el patrón `YYYY-MM-DD-NNNNNN_DescriptionInPascalCase.php`.
- **Models**: extender `CodeIgniter\Model`, con `$allowedFields` explícito, `$useTimestamps = true`, `$returnType = 'array'`. No usar Entity a menos que la lógica lo justifique (actualmente el proyecto no usa Entities).
- **Controllers API**: extender `App\Controllers\Api\BaseApiController`. Usar `$this->respond()`, `$this->fail*()`. Nunca `echo` ni `header()` manual. El body JSON siempre con `$this->jsonBody()`.
- **Validación**: usar `CodeIgniter\Validation\ValidationInterface` vía `service('validation')` con reglas inline o `app/Config/Validation.php`. No librerías externas.
- **Rutas**: agregarlas al grupo existente en `backend/app/Config/Routes.php` dentro de `['filter' => 'jwtAuth']` y, si son de escritura/admin, dentro de `['filter' => 'role:admin,supervisor']`.
- **Transacciones**: para operaciones multi-tabla (crear ausencia + actualizar saldo) usar `$db->transStart()` / `$db->transComplete()`.
- **Logging**: `log_message('info', ...)` para eventos de negocio. `log_message('error', ...)` para excepciones con contexto.
- **Tests**: agregar unit tests en `backend/tests/unit/` extendiendo `CIUnitTestCase`, usando `DatabaseTestTrait` cuando toque BD.
- **No romper firmas públicas existentes**: `AbsenceExpectationService::computeAbsences()` debe seguir devolviendo la misma estructura actual. Lo nuevo se expone en métodos adicionales.
- **PHP 8.2 strict**: usar `declare(strict_types=1);` en archivos nuevos, tipar parámetros y retornos, usar `readonly` donde aplique, enums nativos para catálogos de estado.

### 2.2 Frontend (React 19.2 + TypeScript 5.9)

- **No introducir librerías UI** (Tailwind, MUI, shadcn) a menos que se documente. El proyecto usa CSS clásico (`App.css`, `theme/`). Si un módulo requiere una librería de tabla o de fechas, primero se evalúa y se registra aquí.
- **Descomposición progresiva de `App.tsx`**: los componentes nuevos de este módulo se crean en `src/modules/absences/` con sus propios archivos. No se inyectan dentro de `App.tsx`.
- **Tipos**: extender `src/api.ts` con tipos nuevos. Nunca duplicar tipos entre módulos; importar desde ahí.
- **Data fetching**: seguir el patrón actual (fetch directo con helpers de `src/api.ts` + `useEffect` + estado local). No introducir React Query en este sprint (evaluar en Sprint 4).
- **Hooks de React 19**: preferir `use()` para promesas cuando aplique; `useOptimistic` para las acciones de aprobación; `useActionState` para el formulario de solicitud de vacaciones.
- **Validación de formularios**: se permite introducir `zod` (solo 12 KB gzip) para validación declarativa de solicitudes. Si se rechaza, validación manual inline — pero nunca reglas dispersas por el render.
- **Accesibilidad**: labels asociados, roles ARIA en modales, focus trap en overlays.

### 2.3 Datos y compliance

- Todos los timestamps en **UTC en BD**, conversión a zona local en frontend.
- Las ausencias aprobadas son **append-only**: cualquier corrección genera una nueva fila con `supersedes_id` apuntando a la anterior y `status = 'superseded'`. Nunca `UPDATE` ni `DELETE` sobre una fila aprobada.
- Los documentos soporte (incapacidades IMSS, cartas) se almacenan con **URL firmada** en un bucket S3-compatible. En este sprint se deja el campo `document_url` como VARCHAR; la integración con S3 es un ticket aparte.

---

## 3. Sprint 1 — Motor de 5 estados + Catálogo + CRUD de ausencias

Objetivo: al finalizar el sprint, el endpoint `/api/absences` devuelve ausencias tipificadas; existe un endpoint nuevo `/api/absences-typed` con los cinco estados; y hay CRUD completo para `employee_absences`.

### 3.1 Migración: tablas nuevas

**Archivo**: `backend/app/Database/Migrations/2026-04-24-000001_CreateAbsenceTyping.php`

```php
<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateAbsenceTyping extends Migration
{
    public function up(): void
    {
        // 1) Catálogo de tipos de ausencia
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'code' => ['type' => 'VARCHAR', 'constraint' => 32],
            'label' => ['type' => 'VARCHAR', 'constraint' => 120],
            'paid' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'counts_as_worked_day' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'affects_leave_balance' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'requires_document' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'color_hex' => ['type' => 'VARCHAR', 'constraint' => 9, 'default' => '#999999'],
            'display_order' => ['type' => 'INT', 'unsigned' => true, 'default' => 100],
            'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('code', 'uq_absence_types_code');
        $this->forge->addKey('is_active', false, false, 'idx_absence_types_active');
        $this->forge->createTable('absence_types', true);

        // 2) Ausencias registradas
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'absence_type_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'start_date' => ['type' => 'DATE'],
            'end_date' => ['type' => 'DATE'],
            'business_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'status' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'pending'],
            'reason' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
            'document_url' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
            'requested_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'requested_at' => ['type' => 'DATETIME', 'null' => true],
            'approved_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'approved_at' => ['type' => 'DATETIME', 'null' => true],
            'rejected_reason' => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
            'supersedes_id' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'notes' => ['type' => 'TEXT', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['employee_id', 'start_date', 'end_date'], false, false, 'idx_absences_employee_range');
        $this->forge->addKey(['status'], false, false, 'idx_absences_status');
        $this->forge->addKey(['start_date', 'end_date'], false, false, 'idx_absences_range');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_absences_employee');
        $this->forge->addForeignKey('absence_type_id', 'absence_types', 'id', 'RESTRICT', 'CASCADE', 'fk_absences_type');
        $this->forge->addForeignKey('supersedes_id', 'employee_absences', 'id', 'SET NULL', 'CASCADE', 'fk_absences_supersedes');
        $this->forge->createTable('employee_absences', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('employee_absences', true);
        $this->forge->dropTable('absence_types', true);
    }
}
```

**Nota**: los valores del enum `status` se validan en el modelo, no en un CHECK de MySQL (compatibilidad MariaDB < 10.4). Valores permitidos: `pending`, `approved`, `rejected`, `cancelled`, `superseded`.

### 3.2 Seeder: catálogo inicial

**Archivo**: `backend/app/Database/Seeds/AbsenceTypesSeeder.php`

```php
<?php

declare(strict_types=1);

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class AbsenceTypesSeeder extends Seeder
{
    public function run(): void
    {
        $now = date('Y-m-d H:i:s');
        $types = [
            ['VAC',          'Vacaciones',             1, 1, 1, 0, '#2F80ED', 10],
            ['PRIMA_VAC',    'Prima vacacional',       1, 0, 0, 0, '#6FCF97', 20],
            ['PER_GOCE',     'Permiso con goce',       1, 1, 0, 0, '#56CCF2', 30],
            ['PER_SIN_GOCE', 'Permiso sin goce',       0, 0, 0, 1, '#F2994A', 40],
            ['INC_IMSS',     'Incapacidad IMSS',       1, 1, 0, 1, '#9B51E0', 50],
            ['INC_GEN',      'Incapacidad general',    1, 1, 0, 1, '#BB6BD9', 55],
            ['MAT',          'Maternidad',             1, 1, 0, 1, '#EB5757', 60],
            ['PAT',          'Paternidad',             1, 1, 0, 1, '#F2C94C', 65],
            ['LUTO',         'Defunción familiar',     1, 1, 0, 0, '#828282', 70],
            ['CAP',          'Capacitación',           1, 1, 0, 0, '#219653', 80],
            ['SUSP',         'Suspensión disciplinaria', 0, 0, 0, 1, '#EB5757', 90],
            ['FALTA_JUST',   'Falta justificada s/goce', 0, 0, 0, 1, '#F2994A', 95],
        ];

        $rows = [];
        foreach ($types as [$code, $label, $paid, $cw, $ab, $rd, $color, $order]) {
            $rows[] = [
                'code' => $code,
                'label' => $label,
                'paid' => $paid,
                'counts_as_worked_day' => $cw,
                'affects_leave_balance' => $ab,
                'requires_document' => $rd,
                'color_hex' => $color,
                'display_order' => $order,
                'is_active' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        $this->db->table('absence_types')->ignore(true)->insertBatch($rows);
    }
}
```

### 3.3 Models

**Archivo**: `backend/app/Models/AbsenceTypeModel.php`

```php
<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class AbsenceTypeModel extends Model
{
    protected $table = 'absence_types';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'code', 'label', 'paid', 'counts_as_worked_day',
        'affects_leave_balance', 'requires_document',
        'color_hex', 'display_order', 'is_active',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';

    protected $validationRules = [
        'code' => 'required|alpha_dash|max_length[32]|is_unique[absence_types.code,id,{id}]',
        'label' => 'required|max_length[120]',
        'paid' => 'in_list[0,1]',
        'counts_as_worked_day' => 'in_list[0,1]',
        'affects_leave_balance' => 'in_list[0,1]',
        'requires_document' => 'in_list[0,1]',
        'color_hex' => 'regex_match[/^#[0-9A-Fa-f]{6}$/]',
    ];

    /** @return list<array<string, mixed>> */
    public function listActive(): array
    {
        return $this->where('is_active', 1)
            ->orderBy('display_order', 'ASC')
            ->orderBy('label', 'ASC')
            ->findAll();
    }
}
```

**Archivo**: `backend/app/Models/EmployeeAbsenceModel.php`

```php
<?php

declare(strict_types=1);

namespace App\Models;

use CodeIgniter\Model;

class EmployeeAbsenceModel extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_SUPERSEDED = 'superseded';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_APPROVED,
        self::STATUS_REJECTED,
        self::STATUS_CANCELLED,
        self::STATUS_SUPERSEDED,
    ];

    protected $table = 'employee_absences';
    protected $primaryKey = 'id';
    protected $returnType = 'array';
    protected $useAutoIncrement = true;
    protected $protectFields = true;
    protected $allowedFields = [
        'employee_id', 'absence_type_id',
        'start_date', 'end_date', 'business_days',
        'status', 'reason', 'document_url',
        'requested_by', 'requested_at',
        'approved_by', 'approved_at', 'rejected_reason',
        'supersedes_id', 'notes',
    ];
    protected bool $updateOnlyChanged = true;

    protected $useTimestamps = true;
    protected $dateFormat = 'datetime';
    protected $createdField = 'created_at';
    protected $updatedField = 'updated_at';

    protected $validationRules = [
        'employee_id' => 'required|is_natural_no_zero',
        'absence_type_id' => 'required|is_natural_no_zero',
        'start_date' => 'required|valid_date[Y-m-d]',
        'end_date' => 'required|valid_date[Y-m-d]',
        'status' => 'required|in_list[pending,approved,rejected,cancelled,superseded]',
    ];

    /**
     * Devuelve ausencias aprobadas (y superseded=false) que intersectan el rango.
     *
     * @return list<array<string, mixed>>
     */
    public function findApprovedInRange(string $from, string $to, ?int $employeeId = null): array
    {
        $builder = $this->builder()
            ->select('employee_absences.*, absence_types.code AS type_code, absence_types.label AS type_label, absence_types.counts_as_worked_day, absence_types.paid')
            ->join('absence_types', 'absence_types.id = employee_absences.absence_type_id', 'inner')
            ->where('employee_absences.status', self::STATUS_APPROVED)
            ->where('employee_absences.start_date <=', $to)
            ->where('employee_absences.end_date >=', $from)
            ->orderBy('employee_absences.start_date', 'ASC');

        if ($employeeId !== null) {
            $builder->where('employee_absences.employee_id', $employeeId);
        }

        return $builder->get()->getResultArray();
    }
}
```

### 3.4 Enum de estado resuelto

**Archivo**: `backend/app/Services/AttendanceDayState.php`

```php
<?php

declare(strict_types=1);

namespace App\Services;

enum AttendanceDayState: string
{
    case NotExpected = 'NOT_EXPECTED';
    case Present = 'PRESENT';
    case JustifiedWorked = 'JUSTIFIED_WORKED';
    case JustifiedUnpaid = 'JUSTIFIED_UNPAID';
    case UnjustifiedAbsence = 'UNJUSTIFIED_ABSENCE';

    public function countsAsAbsence(): bool
    {
        return $this === self::UnjustifiedAbsence;
    }

    public function countsAsWorkedDay(): bool
    {
        return $this === self::Present || $this === self::JustifiedWorked;
    }
}
```

### 3.5 Resolvedor tipificado

**Archivo**: `backend/app/Services/AbsenceResolver.php`

```php
<?php

declare(strict_types=1);

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use DateInterval;
use DatePeriod;
use DateTimeImmutable;

/**
 * Resolvedor de estado diario por empleado, con cinco estados tipificados.
 * Versión tipificada de AbsenceExpectationService.
 */
class AbsenceResolver
{
    public const DEFINITION_ID = 'weekdays_typed_absences_v1';

    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * @param list<array{id:int,name:string,hire_date:?string,termination_date:?string}>|null $employees
     *
     * @return array{
     *   days: list<array{employee_id:int,employee:string,date:string,state:string,absence_type?:string,absence_id?:int}>,
     *   summary: array{
     *     expected:int, present:int, justifiedWorked:int, justifiedUnpaid:int, unjustified:int
     *   },
     *   meta: array{definition:string, from:string, to:string}
     * }
     */
    public function resolveRange(string $from, string $to, ?array $employees = null): array
    {
        $weekdays = $this->listWeekdays($from, $to);
        $blocked = $this->loadBlockedDates($from, $to);
        $workdays = array_values(array_filter($weekdays, static fn(string $d): bool => !isset($blocked[$d])));

        $employees ??= $this->loadActiveEmployees();
        $present = $this->loadPresentSet($from, $to);
        $approvedAbsences = $this->loadApprovedAbsencesByEmployee($from, $to);

        $days = [];
        $counters = ['expected' => 0, 'present' => 0, 'justifiedWorked' => 0, 'justifiedUnpaid' => 0, 'unjustified' => 0];

        foreach ($employees as $emp) {
            $id = (int) $emp['id'];
            $hire = $emp['hire_date'] ?? null;
            $term = $emp['termination_date'] ?? null;

            foreach ($workdays as $day) {
                if ($hire !== null && $day < $hire) {
                    continue;
                }
                if ($term !== null && $day > $term) {
                    continue;
                }

                $counters['expected']++;
                $key = $id . '|' . $day;

                if (isset($present[$key])) {
                    $counters['present']++;
                    $days[] = ['employee_id' => $id, 'employee' => $emp['name'], 'date' => $day, 'state' => AttendanceDayState::Present->value];
                    continue;
                }

                $match = $this->matchAbsence($approvedAbsences[$id] ?? [], $day);
                if ($match !== null) {
                    $state = ((int) $match['counts_as_worked_day']) === 1
                        ? AttendanceDayState::JustifiedWorked
                        : AttendanceDayState::JustifiedUnpaid;
                    $counterKey = $state === AttendanceDayState::JustifiedWorked ? 'justifiedWorked' : 'justifiedUnpaid';
                    $counters[$counterKey]++;
                    $days[] = [
                        'employee_id' => $id,
                        'employee' => $emp['name'],
                        'date' => $day,
                        'state' => $state->value,
                        'absence_type' => (string) $match['type_code'],
                        'absence_id' => (int) $match['id'],
                    ];
                    continue;
                }

                $counters['unjustified']++;
                $days[] = ['employee_id' => $id, 'employee' => $emp['name'], 'date' => $day, 'state' => AttendanceDayState::UnjustifiedAbsence->value];
            }
        }

        usort($days, static function (array $a, array $b): int {
            $c = strcmp($a['date'], $b['date']);
            return $c !== 0 ? $c : strcmp($a['employee'], $b['employee']);
        });

        return [
            'days' => $days,
            'summary' => $counters,
            'meta' => ['definition' => self::DEFINITION_ID, 'from' => $from, 'to' => $to],
        ];
    }

    /** @return list<string> */
    public function listWeekdays(string $from, string $to): array
    {
        $start = new DateTimeImmutable($from);
        $end = (new DateTimeImmutable($to))->add(new DateInterval('P1D'));
        $out = [];
        foreach (new DatePeriod($start, new DateInterval('P1D'), $end) as $d) {
            $n = (int) $d->format('N');
            if ($n >= 1 && $n <= 5) {
                $out[] = $d->format('Y-m-d');
            }
        }
        return $out;
    }

    /** @return list<array{id:int,name:string,hire_date:?string,termination_date:?string}> */
    private function loadActiveEmployees(): array
    {
        $rows = $this->db->table('employees')
            ->select('id, name, hire_date, termination_date')
            ->where('is_active', 1)
            ->orderBy('name', 'ASC')
            ->get()->getResultArray();

        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'name' => (string) $r['name'],
            'hire_date' => $r['hire_date'] ?: null,
            'termination_date' => $r['termination_date'] ?: null,
        ], $rows);
    }

    /** @return array<string, true> */
    private function loadBlockedDates(string $from, string $to): array
    {
        if (!$this->db->tableExists('calendar_non_working_days')) {
            return [];
        }
        $rows = $this->db->table('calendar_non_working_days')
            ->select('calendar_date')
            ->where('calendar_date >=', $from)
            ->where('calendar_date <=', $to)
            ->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['calendar_date']] = true;
        }
        return $out;
    }

    /** @return array<string, true> */
    private function loadPresentSet(string $from, string $to): array
    {
        $rows = $this->db->table('attendance_records')
            ->select('employee_id, work_date')
            ->distinct()
            ->where('work_date >=', $from)
            ->where('work_date <=', $to)
            ->get()->getResultArray();

        $out = [];
        foreach ($rows as $r) {
            $out[((int) $r['employee_id']) . '|' . ((string) $r['work_date'])] = true;
        }
        return $out;
    }

    /** @return array<int, list<array<string,mixed>>> */
    private function loadApprovedAbsencesByEmployee(string $from, string $to): array
    {
        $rows = $this->db->table('employee_absences ea')
            ->select('ea.id, ea.employee_id, ea.start_date, ea.end_date, at.code AS type_code, at.counts_as_worked_day')
            ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
            ->where('ea.status', 'approved')
            ->where('ea.start_date <=', $to)
            ->where('ea.end_date >=', $from)
            ->get()->getResultArray();

        $byEmp = [];
        foreach ($rows as $r) {
            $eid = (int) $r['employee_id'];
            $byEmp[$eid] ??= [];
            $byEmp[$eid][] = $r;
        }
        return $byEmp;
    }

    /**
     * @param list<array<string,mixed>> $absences
     * @return array<string,mixed>|null
     */
    private function matchAbsence(array $absences, string $day): ?array
    {
        foreach ($absences as $a) {
            if ($day >= (string) $a['start_date'] && $day <= (string) $a['end_date']) {
                return $a;
            }
        }
        return null;
    }
}
```

### 3.6 Refactor no-destructivo del servicio existente

**Archivo**: `backend/app/Services/AbsenceExpectationService.php` — agregar al final de la clase (no borrar nada):

```php
    /**
     * Versión tipificada (delegación al nuevo resolvedor).
     * No modifica el contrato de computeAbsences().
     */
    public function computeTypedAbsences(string $from, string $to, ?string $employeeName = null): array
    {
        $resolver = new AbsenceResolver($this->db);
        $filter = $this->normalizeEmployeeFilter($employeeName);

        $employees = null;
        if ($filter !== null) {
            $row = $this->db->table('employees')
                ->select('id, name, hire_date, termination_date')
                ->where('is_active', 1)
                ->where('name', $filter)
                ->get()->getFirstRow('array');
            $employees = $row ? [[
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
                'hire_date' => $row['hire_date'] ?: null,
                'termination_date' => $row['termination_date'] ?: null,
            ]] : [];
        }

        return $resolver->resolveRange($from, $to, $employees);
    }
```

> **Importante**: el método `computeAbsences()` existente debe modificarse internamente para **filtrar** los días con `JUSTIFIED_WORKED` y `JUSTIFIED_UNPAID`, de modo que la tasa de inasistencias del dashboard (que sigue llamando a este método) deje de contar justificadas. El cambio es aditivo: cargar el set de ausencias aprobadas y saltar el `$absences[]` cuando el día caiga en una ausencia aprobada. Conservar la estructura de retorno intacta.

Diff conceptual a aplicar dentro de `computeAbsences()`:

```php
// ANTES del foreach sobre $employees:
$approvedByEmployee = $this->loadApprovedAbsencesIndexedByEmployee($from, $to);

// DENTRO del inner foreach (cuando no hay $present), ANTES de push al array:
if (isset($approvedByEmployee[$id]) && $this->dayInAnyAbsence($approvedByEmployee[$id], $day)) {
    continue; // día justificado, no es inasistencia
}
```

Añadir los dos métodos privados `loadApprovedAbsencesIndexedByEmployee()` y `dayInAnyAbsence()` duplicando la lógica de `AbsenceResolver` (o inyectar `AbsenceResolver` y delegar). La opción más limpia es **inyección**: el constructor acepta opcionalmente un `AbsenceResolver`.

### 3.7 Controller de tipos y de ausencias

**Archivo**: `backend/app/Controllers/Api/AbsenceTypesController.php`

```php
<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\AbsenceTypeModel;
use Throwable;

class AbsenceTypesController extends BaseApiController
{
    public function index()
    {
        try {
            $model = model(AbsenceTypeModel::class);
            return $this->respond(['types' => $model->listActive()]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron cargar tipos: ' . $e->getMessage());
        }
    }
}
```

**Archivo**: `backend/app/Controllers/Api/AbsencesController.php`

```php
<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Models\AbsenceTypeModel;
use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use App\Services\AbsenceResolver;
use DateTimeImmutable;
use Throwable;

class AbsencesController extends BaseApiController
{
    public function list()
    {
        try {
            $from = (string) ($this->request->getGet('from') ?? '');
            $to = (string) ($this->request->getGet('to') ?? '');
            $status = (string) ($this->request->getGet('status') ?? '');
            $employee = trim((string) ($this->request->getGet('employee') ?? ''));

            $builder = db_connect()->table('employee_absences ea')
                ->select('ea.*, e.name AS employee_name, at.code AS type_code, at.label AS type_label, at.color_hex')
                ->join('employees e', 'e.id = ea.employee_id', 'inner')
                ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
                ->orderBy('ea.start_date', 'DESC');

            if ($from !== '' && $to !== '') {
                $builder->where('ea.end_date >=', $from)->where('ea.start_date <=', $to);
            }
            if ($status !== '' && in_array($status, EmployeeAbsenceModel::STATUSES, true)) {
                $builder->where('ea.status', $status);
            }
            if ($employee !== '' && $employee !== 'all') {
                $builder->where('e.name', $employee);
            }

            return $this->respond(['absences' => $builder->get()->getResultArray()]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudieron listar ausencias: ' . $e->getMessage());
        }
    }

    public function create()
    {
        try {
            $body = $this->jsonBody();
            $validation = service('validation');
            $validation->setRules([
                'employee_id' => 'required|is_natural_no_zero',
                'absence_type_id' => 'required|is_natural_no_zero',
                'start_date' => 'required|valid_date[Y-m-d]',
                'end_date' => 'required|valid_date[Y-m-d]',
                'reason' => 'permit_empty|max_length[500]',
            ]);
            if (!$validation->run($body)) {
                return $this->failValidationErrors($validation->getErrors());
            }
            if ($body['start_date'] > $body['end_date']) {
                return $this->failValidationErrors(['range' => 'start_date > end_date']);
            }

            $employee = model(EmployeeModel::class)->find((int) $body['employee_id']);
            if (!$employee) {
                return $this->failNotFound('Empleado no encontrado');
            }
            $type = model(AbsenceTypeModel::class)->find((int) $body['absence_type_id']);
            if (!$type || (int) $type['is_active'] !== 1) {
                return $this->failNotFound('Tipo de ausencia inválido');
            }

            $businessDays = (new AbsenceResolver())->listWeekdays($body['start_date'], $body['end_date']);
            $payload = $this->jwtPayload();
            $userId = isset($payload['sub']) ? (int) $payload['sub'] : null;

            $row = [
                'employee_id' => (int) $body['employee_id'],
                'absence_type_id' => (int) $body['absence_type_id'],
                'start_date' => (string) $body['start_date'],
                'end_date' => (string) $body['end_date'],
                'business_days' => count($businessDays),
                'status' => EmployeeAbsenceModel::STATUS_PENDING,
                'reason' => isset($body['reason']) ? (string) $body['reason'] : null,
                'document_url' => isset($body['document_url']) ? (string) $body['document_url'] : null,
                'requested_by' => $userId,
                'requested_at' => (new DateTimeImmutable())->format('Y-m-d H:i:s'),
                'notes' => isset($body['notes']) ? (string) $body['notes'] : null,
            ];

            $id = model(EmployeeAbsenceModel::class)->insert($row, true);
            return $this->respondCreated(['id' => $id]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo crear la ausencia: ' . $e->getMessage());
        }
    }

    public function approve($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_APPROVED);
    }

    public function reject($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_REJECTED);
    }

    public function cancel($id = null)
    {
        return $this->changeStatus((int) $id, EmployeeAbsenceModel::STATUS_CANCELLED);
    }

    private function changeStatus(int $id, string $newStatus)
    {
        try {
            $model = model(EmployeeAbsenceModel::class);
            $row = $model->find($id);
            if (!$row) {
                return $this->failNotFound('Ausencia no encontrada');
            }
            if ((string) $row['status'] !== EmployeeAbsenceModel::STATUS_PENDING) {
                return $this->failValidationErrors(['status' => 'solo ausencias pending pueden cambiar de estado; usar supersedes para corregir una aprobada']);
            }

            $payload = $this->jwtPayload();
            $userId = isset($payload['sub']) ? (int) $payload['sub'] : null;
            $body = $this->jsonBody();

            $update = ['status' => $newStatus];
            if ($newStatus === EmployeeAbsenceModel::STATUS_APPROVED) {
                $update['approved_by'] = $userId;
                $update['approved_at'] = (new DateTimeImmutable())->format('Y-m-d H:i:s');
            } elseif ($newStatus === EmployeeAbsenceModel::STATUS_REJECTED) {
                $update['rejected_reason'] = isset($body['reason']) ? (string) $body['reason'] : null;
            }

            $model->update($id, $update);
            log_message('info', "Absence #{$id} -> {$newStatus} by user {$userId}");
            return $this->respondUpdated(['id' => $id, 'status' => $newStatus]);
        } catch (Throwable $e) {
            return $this->failServerError('No se pudo actualizar: ' . $e->getMessage());
        }
    }
}
```

### 3.8 Endpoint tipificado

**Archivo**: `backend/app/Controllers/Api/AttendanceController.php` — agregar método:

```php
    public function absencesTyped()
    {
        try {
            [$from, $to] = $this->resolveRange();
            $employee = trim((string) $this->request->getGet('employee'));
            $service = new \App\Services\AbsenceExpectationService();
            return $this->respond($service->computeTypedAbsences($from, $to, $employee !== '' ? $employee : null));
        } catch (\Throwable $e) {
            return $this->failServerError('No se pudo resolver estado tipificado: ' . $e->getMessage());
        }
    }
```

### 3.9 Rutas

**Archivo**: `backend/app/Config/Routes.php` — agregar dentro del grupo `role:admin,supervisor`:

```php
// Tipos
$routes->get('absence-types', 'Api\AbsenceTypesController::index');

// Ausencias CRUD
$routes->get('absences-typed', 'Api\AttendanceController::absencesTyped');
$routes->get('employee-absences', 'Api\AbsencesController::list');
$routes->post('employee-absences', 'Api\AbsencesController::create');
$routes->post('employee-absences/(:num)/approve', 'Api\AbsencesController::approve/$1');
$routes->post('employee-absences/(:num)/reject', 'Api\AbsencesController::reject/$1');
$routes->post('employee-absences/(:num)/cancel', 'Api\AbsencesController::cancel/$1');
```

### 3.10 Tests

**Archivo**: `backend/tests/unit/AbsenceResolverTest.php`

```php
<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\AbsenceResolver;
use App\Services\AttendanceDayState;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;

/**
 * @internal
 */
final class AbsenceResolverTest extends CIUnitTestCase
{
    use DatabaseTestTrait;

    protected $refresh = true;
    protected $namespace = 'App';

    public function testWeekdaysOnly(): void
    {
        $resolver = new AbsenceResolver();
        $days = $resolver->listWeekdays('2026-04-01', '2026-04-10');
        $this->assertSame(['2026-04-01','2026-04-02','2026-04-03','2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10'], $days);
    }

    public function testPresentEmployeeYieldsPresentState(): void
    {
        $this->seedBasicEmployeeAndAttendance();
        $out = (new AbsenceResolver())->resolveRange('2026-04-06', '2026-04-06');
        $this->assertCount(1, $out['days']);
        $this->assertSame(AttendanceDayState::Present->value, $out['days'][0]['state']);
    }

    public function testApprovedVacationYieldsJustifiedWorked(): void
    {
        $this->seedEmployeeWithApprovedVacation();
        $out = (new AbsenceResolver())->resolveRange('2026-04-06', '2026-04-06');
        $this->assertSame(AttendanceDayState::JustifiedWorked->value, $out['days'][0]['state']);
        $this->assertSame('VAC', $out['days'][0]['absence_type']);
    }

    // Helpers seedBasic*() — insertar rows directamente vía $this->db.
}
```

### 3.11 Frontend — capa de API

**Archivo**: `src/api.ts` — agregar al final:

```ts
export type AbsenceType = {
  id: number;
  code: string;
  label: string;
  paid: boolean;
  countsAsWorkedDay: boolean;
  affectsLeaveBalance: boolean;
  requiresDocument: boolean;
  colorHex: string;
};

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

export type EmployeeAbsence = {
  id: number;
  employeeId: number;
  employeeName: string;
  absenceTypeId: number;
  typeCode: string;
  typeLabel: string;
  colorHex: string;
  startDate: string;
  endDate: string;
  businessDays: number;
  status: AbsenceStatus;
  reason: string | null;
  documentUrl: string | null;
  notes: string | null;
};

export type TypedDayState = "NOT_EXPECTED" | "PRESENT" | "JUSTIFIED_WORKED" | "JUSTIFIED_UNPAID" | "UNJUSTIFIED_ABSENCE";

export type TypedDay = {
  employeeId: number;
  employee: string;
  date: string;
  state: TypedDayState;
  absenceType?: string;
  absenceId?: number;
};

export async function getAbsenceTypes(): Promise<AbsenceType[]> {
  const r = await authFetch("/api/absence-types");
  const data = await r.json();
  return (data.types ?? []).map((t: any) => ({
    id: t.id, code: t.code, label: t.label,
    paid: !!t.paid,
    countsAsWorkedDay: !!t.counts_as_worked_day,
    affectsLeaveBalance: !!t.affects_leave_balance,
    requiresDocument: !!t.requires_document,
    colorHex: t.color_hex,
  }));
}

export async function listEmployeeAbsences(params: {
  from?: string; to?: string; status?: AbsenceStatus; employee?: string;
}): Promise<EmployeeAbsence[]> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.status) q.set("status", params.status);
  if (params.employee) q.set("employee", params.employee);
  const r = await authFetch(`/api/employee-absences?${q.toString()}`);
  const data = await r.json();
  return (data.absences ?? []).map(normalizeAbsence);
}

export async function createEmployeeAbsence(input: {
  employeeId: number;
  absenceTypeId: number;
  startDate: string;
  endDate: string;
  reason?: string;
  documentUrl?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const r = await authFetch("/api/employee-absences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employee_id: input.employeeId,
      absence_type_id: input.absenceTypeId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
      document_url: input.documentUrl,
      notes: input.notes,
    }),
  });
  return r.json();
}

export async function approveAbsence(id: number): Promise<void> {
  await authFetch(`/api/employee-absences/${id}/approve`, { method: "POST" });
}
export async function rejectAbsence(id: number, reason: string): Promise<void> {
  await authFetch(`/api/employee-absences/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}
export async function getTypedAbsences(from: string, to: string, employee?: string): Promise<{
  days: TypedDay[]; summary: Record<string, number>;
}> {
  const q = new URLSearchParams({ from, to });
  if (employee && employee !== "all") q.set("employee", employee);
  const r = await authFetch(`/api/absences-typed?${q.toString()}`);
  const data = await r.json();
  return {
    days: (data.days ?? []).map((d: any) => ({
      employeeId: d.employee_id, employee: d.employee, date: d.date,
      state: d.state, absenceType: d.absence_type, absenceId: d.absence_id,
    })),
    summary: data.summary ?? {},
  };
}

function normalizeAbsence(r: any): EmployeeAbsence {
  return {
    id: r.id, employeeId: r.employee_id, employeeName: r.employee_name,
    absenceTypeId: r.absence_type_id, typeCode: r.type_code, typeLabel: r.type_label,
    colorHex: r.color_hex, startDate: r.start_date, endDate: r.end_date,
    businessDays: Number(r.business_days), status: r.status,
    reason: r.reason, documentUrl: r.document_url, notes: r.notes,
  };
}
```

> Nota: `authFetch` es el helper existente del proyecto que inyecta el `Authorization: Bearer <jwt>`. Si no existe como símbolo exportable, se debe extraer de `src/auth/apiAuth.ts` a `src/api.ts` en esta iteración.

### 3.12 Frontend — módulo de UI

Crear la estructura:

```
src/modules/absences/
├── AbsencesPanel.tsx        # Vista con lista + filtros + botón "Nueva solicitud"
├── AbsenceFormDialog.tsx    # Modal de solicitud con useActionState
├── AbsenceStatusBadge.tsx   # Píldora coloreada según status
├── TypedCalendar.tsx        # Grilla empleado×día con el estado coloreado
├── useAbsenceTypes.ts       # Hook con cache local del catálogo
└── absences.module.css      # CSS scoped
```

**Archivo**: `src/modules/absences/useAbsenceTypes.ts`

```ts
import { useEffect, useState } from "react";
import { getAbsenceTypes, type AbsenceType } from "../../api";

let cache: AbsenceType[] | null = null;

export function useAbsenceTypes() {
  const [types, setTypes] = useState<AbsenceType[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    getAbsenceTypes()
      .then((t) => {
        if (cancelled) return;
        cache = t;
        setTypes(t);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return { types, loading };
}
```

**Archivo**: `src/modules/absences/AbsenceFormDialog.tsx` — patrón React 19 con `useActionState`:

```tsx
import { useActionState, useState } from "react";
import { createEmployeeAbsence } from "../../api";
import { useAbsenceTypes } from "./useAbsenceTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
  employees: { id: number; name: string }[];
};

type FormState = { ok: boolean; error?: string };

export function AbsenceFormDialog({ open, onClose, onCreated, employees }: Props) {
  const { types, loading } = useAbsenceTypes();
  const [state, submitAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      try {
        const res = await createEmployeeAbsence({
          employeeId: Number(formData.get("employeeId")),
          absenceTypeId: Number(formData.get("absenceTypeId")),
          startDate: String(formData.get("startDate")),
          endDate: String(formData.get("endDate")),
          reason: String(formData.get("reason") ?? "") || undefined,
        });
        onCreated(res.id);
        onClose();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Error" };
      }
    },
    { ok: false },
  );

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="abs-modal">
      <div className="abs-modal__backdrop" onClick={onClose} />
      <div className="abs-modal__content">
        <h2>Nueva ausencia</h2>
        <form action={submitAction}>
          <label>Empleado
            <select name="employeeId" required>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>Tipo
            <select name="absenceTypeId" required disabled={loading}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>Inicio <input type="date" name="startDate" required /></label>
          <label>Fin <input type="date" name="endDate" required /></label>
          <label>Motivo <textarea name="reason" rows={3} maxLength={500} /></label>
          {state.error && <p role="alert" className="abs-error">{state.error}</p>}
          <div className="abs-modal__actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={pending}>{pending ? "Guardando..." : "Solicitar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

El resto de componentes (`AbsencesPanel`, `AbsenceStatusBadge`, `TypedCalendar`) siguen el mismo patrón: estado local + `authFetch` vía helpers de `api.ts` + CSS modules.

### 3.13 Integración en `App.tsx`

Cambio mínimo: agregar una nueva pestaña "Ausencias" al tab-bar existente. El componente `<AbsencesPanel />` se renderiza condicionalmente. No tocar la lógica de carga de asistencias.

### 3.14 Criterios de "done" Sprint 1

- [ ] `php spark migrate` pasa sin errores.
- [ ] `php spark db:seed AbsenceTypesSeeder` deja 12 tipos en BD.
- [ ] `GET /api/absence-types` devuelve los 12 tipos activos.
- [ ] `POST /api/employee-absences` con payload válido crea registro con `status='pending'`.
- [ ] `POST /api/employee-absences/:id/approve` cambia a `approved` solo si estaba `pending`.
- [ ] `GET /api/absences-typed?from=X&to=Y` devuelve array `days` con los cinco estados.
- [ ] `GET /api/absences` (el viejo) **ya no cuenta** como inasistencia los días con ausencia aprobada.
- [ ] `npm run build` compila sin errores TypeScript.
- [ ] La pestaña "Ausencias" aparece en la UI y permite crear/listar/aprobar.
- [ ] Tests unitarios de `AbsenceResolver` pasan.

---

## 4. Sprint 2 — Saldos LFT + Job aniversario + Importador histórico

Objetivo: automatizar el cálculo de días de vacaciones por antigüedad (LFT reforma 2023), mantener saldos actualizados, e importar el histórico del archivo `Control_de_vacaciones_GPJ_Actualizado_Marzo2026.xlsx`.

### 4.1 Migración de saldos

**Archivo**: `backend/app/Database/Migrations/2026-05-01-000001_CreateLeaveBalances.php`

```php
<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateLeaveBalances extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'employee_id' => ['type' => 'BIGINT', 'unsigned' => true],
            'anniversary_year' => ['type' => 'SMALLINT', 'unsigned' => true],
            'years_of_service' => ['type' => 'TINYINT', 'unsigned' => true],
            'entitled_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'used_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'carried_over_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'prima_vacacional_days' => ['type' => 'DECIMAL', 'constraint' => '5,2', 'default' => 0],
            'period_start' => ['type' => 'DATE'],
            'period_end' => ['type' => 'DATE'],
            'expiration_date' => ['type' => 'DATE'],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['employee_id', 'anniversary_year'], 'uq_leave_balance_employee_year');
        $this->forge->addForeignKey('employee_id', 'employees', 'id', 'CASCADE', 'CASCADE', 'fk_leave_balance_employee');
        $this->forge->createTable('employee_leave_balances', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('employee_leave_balances', true);
    }
}
```

### 4.2 Calculadora LFT

**Archivo**: `backend/app/Services/MexicanLaborLawService.php`

```php
<?php

declare(strict_types=1);

namespace App\Services;

use DateTimeImmutable;

/**
 * Cálculo LFT reforma 2023 (vigente desde ene-2023).
 * Tabla oficial: art. 76 LFT.
 */
class MexicanLaborLawService
{
    /**
     * Devuelve días de vacaciones y prima vacacional (días) para una antigüedad dada.
     * Prima vacacional = 25% del salario correspondiente a los días de vacaciones.
     * Aquí se devuelve el equivalente en días (para usar en cálculos internos); el monto
     * monetario se calcula en el motor de nómina externo.
     *
     * @return array{vacationDays:int, primaVacationalDays:float}
     */
    public static function entitlementFor(int $yearsOfService): array
    {
        $years = max(0, $yearsOfService);

        $table = [
            1 => 12, 2 => 14, 3 => 16, 4 => 18, 5 => 20,
        ];

        if ($years === 0) {
            $vac = 0;
        } elseif ($years <= 5) {
            $vac = $table[$years];
        } elseif ($years <= 10) {
            $vac = 22;
        } elseif ($years <= 15) {
            $vac = 24;
        } elseif ($years <= 20) {
            $vac = 26;
        } elseif ($years <= 25) {
            $vac = 28;
        } elseif ($years <= 30) {
            $vac = 30;
        } else {
            $vac = 32;
        }

        $prima = round($vac * 0.25, 2);
        return ['vacationDays' => $vac, 'primaVacationalDays' => $prima];
    }

    public static function yearsOfServiceAt(string $hireDate, string $referenceDate): int
    {
        $h = new DateTimeImmutable($hireDate);
        $r = new DateTimeImmutable($referenceDate);
        return (int) $h->diff($r)->y;
    }

    /**
     * Rango del año aniversario vigente en una fecha de referencia.
     *
     * @return array{start:string, end:string}
     */
    public static function anniversaryYearRange(string $hireDate, string $referenceDate): array
    {
        $h = new DateTimeImmutable($hireDate);
        $r = new DateTimeImmutable($referenceDate);
        $years = (int) $h->diff($r)->y;
        $start = $h->modify("+{$years} years");
        $next = $h->modify('+' . ($years + 1) . ' years');
        return ['start' => $start->format('Y-m-d'), 'end' => $next->modify('-1 day')->format('Y-m-d')];
    }
}
```

### 4.3 Servicio de saldos

**Archivo**: `backend/app/Services/LeaveBalanceService.php`

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use CodeIgniter\Database\BaseConnection;
use DateTimeImmutable;

class LeaveBalanceService
{
    public function __construct(private ?BaseConnection $db = null)
    {
        $this->db = $db ?? db_connect();
    }

    /**
     * Calcula y persiste el saldo para el año aniversario vigente del empleado.
     * Idempotente: si ya existe, lo actualiza; si no, lo crea.
     */
    public function recalculateForEmployee(int $employeeId, ?string $asOf = null): ?array
    {
        $asOf ??= (new DateTimeImmutable())->format('Y-m-d');
        $emp = model(EmployeeModel::class)->find($employeeId);
        if (!$emp || empty($emp['hire_date'])) {
            return null;
        }

        $hire = (string) $emp['hire_date'];
        $years = MexicanLaborLawService::yearsOfServiceAt($hire, $asOf);
        $ent = MexicanLaborLawService::entitlementFor($years);
        $range = MexicanLaborLawService::anniversaryYearRange($hire, $asOf);

        $used = $this->sumUsedVacationDays($employeeId, $range['start'], $range['end']);
        $anniversaryYear = (int) (new DateTimeImmutable($range['start']))->format('Y');

        $row = [
            'employee_id' => $employeeId,
            'anniversary_year' => $anniversaryYear,
            'years_of_service' => $years,
            'entitled_days' => $ent['vacationDays'],
            'used_days' => $used,
            'prima_vacacional_days' => $ent['primaVacationalDays'],
            'period_start' => $range['start'],
            'period_end' => $range['end'],
            'expiration_date' => (new DateTimeImmutable($range['end']))->modify('+18 months')->format('Y-m-d'),
        ];

        $existing = $this->db->table('employee_leave_balances')
            ->where('employee_id', $employeeId)
            ->where('anniversary_year', $anniversaryYear)
            ->get()->getFirstRow('array');

        if ($existing) {
            $this->db->table('employee_leave_balances')
                ->where('id', (int) $existing['id'])
                ->update($row + ['updated_at' => date('Y-m-d H:i:s')]);
            $row['id'] = (int) $existing['id'];
        } else {
            $this->db->table('employee_leave_balances')->insert($row + [
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $row['id'] = (int) $this->db->insertID();
        }

        return $row;
    }

    public function recalculateAll(?string $asOf = null): int
    {
        $rows = $this->db->table('employees')
            ->select('id')
            ->where('is_active', 1)
            ->where('hire_date IS NOT NULL')
            ->get()->getResultArray();

        $n = 0;
        foreach ($rows as $r) {
            if ($this->recalculateForEmployee((int) $r['id'], $asOf) !== null) {
                $n++;
            }
        }
        return $n;
    }

    private function sumUsedVacationDays(int $employeeId, string $from, string $to): float
    {
        $rows = $this->db->table('employee_absences ea')
            ->select('ea.business_days')
            ->join('absence_types at', 'at.id = ea.absence_type_id', 'inner')
            ->where('ea.employee_id', $employeeId)
            ->where('ea.status', EmployeeAbsenceModel::STATUS_APPROVED)
            ->where('at.affects_leave_balance', 1)
            ->where('ea.start_date >=', $from)
            ->where('ea.end_date <=', $to)
            ->get()->getResultArray();

        $total = 0.0;
        foreach ($rows as $r) {
            $total += (float) $r['business_days'];
        }
        return $total;
    }
}
```

### 4.4 Comando Spark para el job programado

**Archivo**: `backend/app/Commands/RecalculateLeaveBalancesCommand.php`

```php
<?php

declare(strict_types=1);

namespace App\Commands;

use App\Services\LeaveBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

class RecalculateLeaveBalancesCommand extends BaseCommand
{
    protected $group = 'HR';
    protected $name = 'hr:recalc-balances';
    protected $description = 'Recalcula saldos de vacaciones LFT para todos los empleados activos.';

    public function run(array $params): void
    {
        $asOf = $params['as-of'] ?? null;
        $n = (new LeaveBalanceService())->recalculateAll($asOf);
        CLI::write("Balances recalculados: {$n}", 'green');
    }
}
```

Cron sugerido (documentar en README):

```cron
5 0 * * * cd /var/www/app/backend && php spark hr:recalc-balances >> writable/logs/balances.log 2>&1
```

### 4.5 Controller de saldos

**Archivo**: `backend/app/Controllers/Api/LeaveBalancesController.php` — exponer:

- `GET /api/leave-balances?employee_id=X` → saldo vigente del empleado.
- `POST /api/leave-balances/recalc` → dispara el recálculo (solo admin).

(Implementación análoga a `AbsencesController`; omitida aquí por brevedad pero obligatoria.)

### 4.6 Importador histórico (one-shot)

**Archivo**: `backend/app/Commands/ImportLegacyVacationsCommand.php`

```php
<?php

declare(strict_types=1);

namespace App\Commands;

use App\Models\EmployeeAbsenceModel;
use App\Models\EmployeeModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * Importa el histórico desde 'Control de vacaciones GPJ'.
 * Uso: php spark hr:import-legacy-vacations /ruta/archivo.xlsx FCFN
 *
 * Requisito: instalar phpoffice/phpspreadsheet
 *   composer require phpoffice/phpspreadsheet
 */
class ImportLegacyVacationsCommand extends BaseCommand
{
    protected $group = 'HR';
    protected $name = 'hr:import-legacy-vacations';
    protected $description = 'Importa vacaciones históricas desde xlsx.';

    public function run(array $params): void
    {
        $path = $params[0] ?? null;
        $sheet = $params[1] ?? 'FCFN';
        if (!$path || !is_file($path)) {
            CLI::error('Uso: spark hr:import-legacy-vacations <path.xlsx> [hoja=FCFN]');
            return;
        }

        if (!class_exists(\PhpOffice\PhpSpreadsheet\IOFactory::class)) {
            CLI::error('Falta phpoffice/phpspreadsheet. Ejecuta: composer require phpoffice/phpspreadsheet');
            return;
        }

        $reader = \PhpOffice\PhpSpreadsheet\IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(true);
        $reader->setLoadSheetsOnly([$sheet]);
        $spreadsheet = $reader->load($path);
        $ws = $spreadsheet->getActiveSheet();

        $vacTypeId = (int) db_connect()->table('absence_types')->where('code', 'VAC')
            ->get()->getFirstRow('array')['id'];

        $currentEmployee = null;
        $currentEmployeeId = null;
        $inserted = 0;
        $skipped = 0;
        $warnings = [];

        foreach ($ws->getRowIterator(7) as $row) {
            $cells = [];
            foreach ($row->getCellIterator('B', 'H') as $c) {
                $cells[] = $c->getValue();
            }
            [$name, $hire, $available, $fechas, $numDias, $restantes, $solicitud] = array_pad($cells, 7, null);

            if ($name !== null && trim((string) $name) !== '') {
                $currentEmployee = trim((string) $name);
                $emp = model(EmployeeModel::class)->where('name', $currentEmployee)->first();
                if (!$emp) {
                    $warnings[] = "Empleado no encontrado: {$currentEmployee}";
                    $currentEmployeeId = null;
                } else {
                    $currentEmployeeId = (int) $emp['id'];
                    if ($hire && empty($emp['hire_date'])) {
                        $hireDate = $this->toDateString($hire);
                        if ($hireDate) {
                            model(EmployeeModel::class)->update($currentEmployeeId, ['hire_date' => $hireDate]);
                        }
                    }
                }
                continue;
            }

            if ($currentEmployeeId === null || $fechas === null || $numDias === null) {
                continue;
            }

            $ranges = $this->parseFechas($fechas);
            if ($ranges === []) {
                $warnings[] = "Fechas no parseables para {$currentEmployee}: '{$fechas}'";
                $skipped++;
                continue;
            }

            foreach ($ranges as [$start, $end]) {
                $businessDays = (new \App\Services\AbsenceResolver())->listWeekdays($start, $end);
                model(EmployeeAbsenceModel::class)->insert([
                    'employee_id' => $currentEmployeeId,
                    'absence_type_id' => $vacTypeId,
                    'start_date' => $start,
                    'end_date' => $end,
                    'business_days' => count($businessDays),
                    'status' => EmployeeAbsenceModel::STATUS_APPROVED,
                    'approved_at' => $solicitud ? $this->toDateString($solicitud) : date('Y-m-d H:i:s'),
                    'notes' => 'Importado desde legacy xlsx',
                ]);
                $inserted++;
            }
        }

        CLI::write("Insertadas: {$inserted} | Saltadas: {$skipped}", 'green');
        foreach ($warnings as $w) {
            CLI::write("  WARN: {$w}", 'yellow');
        }
    }

    /**
     * Parsea texto libre en rangos. Ejemplos:
     *   "13 de marzo de 2026" -> un día
     *   "24-25-26-27 junio 2025" -> rango
     *   "6-7-8-9-10 abril 2026" -> rango
     *   "15 y 26 septiembre 2025" -> dos días sueltos
     *   DateTimeImmutable (celda Excel como fecha)
     *
     * @return list<array{0:string,1:string}>
     */
    private function parseFechas(mixed $value): array
    {
        if ($value instanceof \DateTimeInterface) {
            $d = $value->format('Y-m-d');
            return [[$d, $d]];
        }
        if (is_numeric($value)) {
            // Excel serial date
            try {
                $d = \PhpOffice\PhpSpreadsheet\Shared\Date::excelToDateTimeObject((float) $value)->format('Y-m-d');
                return [[$d, $d]];
            } catch (\Throwable) {
                return [];
            }
        }
        $text = strtolower((string) $value);
        $text = str_replace(['de ', 'del '], '', $text);
        $months = [
            'enero'=>1,'febrero'=>2,'marzo'=>3,'abril'=>4,'mayo'=>5,'junio'=>6,
            'julio'=>7,'agosto'=>8,'septiembre'=>9,'octubre'=>10,'noviembre'=>11,'diciembre'=>12,
        ];
        $monthNum = null; $year = null;
        foreach ($months as $k => $v) {
            if (str_contains($text, $k)) { $monthNum = $v; break; }
        }
        if (preg_match('/\b(20\d{2})\b/', $text, $m)) { $year = (int) $m[1]; }
        if ($monthNum === null || $year === null) {
            return [];
        }

        // Buscar rango contiguo A-B-C-D
        if (preg_match('/(\d{1,2})(?:\s*[-y,]\s*\d{1,2})+/', $text, $m)) {
            $parts = preg_split('/\s*[-y,]\s*/', $m[0]);
            $ints = array_map('intval', array_filter($parts, static fn($p) => ctype_digit(trim((string) $p))));
            sort($ints);
            if ($ints && $this->isContiguous($ints)) {
                return [[sprintf('%04d-%02d-%02d', $year, $monthNum, $ints[0]), sprintf('%04d-%02d-%02d', $year, $monthNum, end($ints))]];
            }
            return array_map(
                static fn(int $d) => [sprintf('%04d-%02d-%02d', $year, $monthNum, $d), sprintf('%04d-%02d-%02d', $year, $monthNum, $d)],
                $ints,
            );
        }
        // Día suelto
        if (preg_match('/\b(\d{1,2})\b/', $text, $m)) {
            $d = (int) $m[1];
            $iso = sprintf('%04d-%02d-%02d', $year, $monthNum, $d);
            return [[$iso, $iso]];
        }
        return [];
    }

    /** @param list<int> $ints */
    private function isContiguous(array $ints): bool
    {
        for ($i = 1; $i < count($ints); $i++) {
            if ($ints[$i] !== $ints[$i - 1] + 1) return false;
        }
        return count($ints) > 1;
    }

    private function toDateString(mixed $v): ?string
    {
        if ($v instanceof \DateTimeInterface) return $v->format('Y-m-d');
        if (is_numeric($v)) {
            try { return \PhpOffice\PhpSpreadsheet\Shared\Date::excelToDateTimeObject((float) $v)->format('Y-m-d'); }
            catch (\Throwable) { return null; }
        }
        return null;
    }
}
```

**Instalación de dependencia**:

```bash
cd backend
composer require phpoffice/phpspreadsheet
```

**Estrategia de conciliación**: antes de importar a producción, ejecutar primero contra una base de staging y revisar los warnings. El parser es best-effort; casos como "22 y 25 de agosto 2025" (dos días no contiguos) generan dos filas separadas, pero "6 días de vacaciones" (sin fechas) se skipean con warning para revisión manual.

### 4.7 Criterios de "done" Sprint 2

- [ ] `employee_leave_balances` creada con unique `(employee_id, anniversary_year)`.
- [ ] `MexicanLaborLawService::entitlementFor(6)` devuelve 22 días, `entitlementFor(15)` devuelve 24 días, `entitlementFor(40)` devuelve 32 días.
- [ ] `php spark hr:recalc-balances` corre y popula saldos para todos los activos con `hire_date`.
- [ ] `GET /api/leave-balances?employee_id=X` devuelve saldo con `entitled_days`, `used_days`, `available_days`.
- [ ] `php spark hr:import-legacy-vacations /ruta/xlsx FCFN` importa ≥ 80% de las filas sin warnings.
- [ ] El formulario de solicitud de vacaciones muestra el saldo disponible del empleado y bloquea el submit si el rango excede el saldo.

---

## 5. Sprint 3 — Periodos quincenales + Reporte XLSX

Objetivo: modelar el concepto de periodo de nómina quincenal y exportar un reporte que replique exactamente el formato de `Incidencias_FCFN_2026.xlsx`.

### 5.1 Migración

**Archivo**: `backend/app/Database/Migrations/2026-05-15-000001_CreatePayrollPeriods.php`

```php
<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreatePayrollPeriods extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
            'period_type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'biweekly'],
            'label' => ['type' => 'VARCHAR', 'constraint' => 60],
            'start_date' => ['type' => 'DATE'],
            'end_date' => ['type' => 'DATE'],
            'expected_calendar_days' => ['type' => 'TINYINT', 'unsigned' => true, 'default' => 15],
            'status' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'open'],
            'closed_by' => ['type' => 'BIGINT', 'unsigned' => true, 'null' => true],
            'closed_at' => ['type' => 'DATETIME', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['start_date', 'end_date', 'period_type'], 'uq_payroll_period_range');
        $this->forge->addKey('status');
        $this->forge->createTable('payroll_periods', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('payroll_periods', true);
    }
}
```

### 5.2 Generador de periodos

**Archivo**: `backend/app/Services/PayrollPeriodService.php` — método estático `generateBiweeklyForYear(int $year)` que crea 24 periodos: del 1 al 15 y del 16 al último día de cada mes. Se ejecuta vía `php spark hr:generate-periods --year=2026`.

### 5.3 Service de reporte

**Archivo**: `backend/app/Services/PayrollReportService.php`

Responsabilidades:

1. Recibir `period_id`.
2. Cargar todos los empleados activos con contrato vigente en el periodo.
3. Para cada empleado, llamar a `AbsenceResolver::resolveRange(period.start, period.end, [emp])`.
4. Derivar:
   - `days_worked = 15 - unjustified - unpaid_absence_days`.
   - `vacation_days = count(state=JUSTIFIED_WORKED && absence_type=VAC)`.
   - `leave_days = count(state=JUSTIFIED_WORKED && absence_type != VAC)`.
   - `unjustified_absences = count(state=UNJUSTIFIED_ABSENCE)`.
5. Construir `observations` automáticas: por ejemplo, "3 días de vacaciones" si `vacation_days=3`.
6. Devolver array estructurado para ser serializado a XLSX o JSON.

### 5.4 Exportador XLSX con PhpSpreadsheet

**Archivo**: `backend/app/Controllers/Api/PayrollReportController.php` con método `exportXlsx($periodId)`. Usa `PhpOffice\PhpSpreadsheet\Writer\Xlsx` y replica el formato exacto del libro de incidencias:

- Fila 2: nombre de la organización (placeholder hasta Sprint 4).
- Fila 3: "Incidencias de nomina".
- Fila 5: "Nómina del: {label}".
- Fila 8: encabezados `FECHA INGRESO | Departamento | #Empleado | Nombre | Días Trabajados | Compensación | Fondo de Ahorro | Prima Vacacional | Observaciones`.
- Filas 10+: una por empleado.

Output: stream directo con headers:

```php
return $this->response
    ->setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    ->setHeader('Content-Disposition', 'attachment; filename="Incidencias_' . $periodLabel . '.xlsx"')
    ->setBody($xlsxBinary);
```

### 5.5 Frontend del módulo de reporte

- Nuevo panel `src/modules/payroll/PayrollPeriodsPanel.tsx`: lista de periodos con su estado.
- `PayrollReportView.tsx`: vista previa del reporte (tabla) + botón "Descargar XLSX" + botón "Cerrar quincena" (solo admin).
- Endpoint que consume: `GET /api/payroll-report/:period_id` (JSON preview) y `GET /api/payroll-report/:period_id/xlsx` (download).

### 5.6 Criterios de "done" Sprint 3

- [ ] Existen 24 periodos quincenales para el año actual.
- [ ] `GET /api/payroll-report/:id` devuelve filas con `days_worked`, `vacation_days`, `leave_days`, `unjustified_absences`, `observations`.
- [ ] El XLSX descargado se abre en Excel sin warnings y tiene los mismos encabezados que `Incidencias_FCFN_2026.xlsx`.
- [ ] Cerrar un periodo cambia `status='closed'` y bloquea futuros cambios en ausencias cuyo rango caiga dentro (regla aplicada en `AbsencesController::create()`).

---

## 6. Sprint 4 — Multi-organización + Aprobación con notificaciones + Dashboard

Objetivo: soportar las 4 organizaciones del Excel maestro (FCFN, PEJ, Cehlider, AEP), flujo de aprobación con email, y dashboard tipificado.

### 6.1 Migración multi-org

```php
// 2026-06-01-000001_CreateOrganizations.php
$this->forge->addField([
    'id' => ['type' => 'BIGINT', 'unsigned' => true, 'auto_increment' => true],
    'code' => ['type' => 'VARCHAR', 'constraint' => 16],
    'name' => ['type' => 'VARCHAR', 'constraint' => 180],
    'legal_name' => ['type' => 'VARCHAR', 'constraint' => 240, 'null' => true],
    'rfc' => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => true],
    'is_active' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
    'created_at' => ['type' => 'DATETIME', 'null' => true],
    'updated_at' => ['type' => 'DATETIME', 'null' => true],
]);
// + addColumn('employees', ['organization_id' => [...nullable, default NULL]])
// + backfill: UPDATE employees SET organization_id = 1 (FCFN)
// + addColumn('calendar_non_working_days', ['organization_id' => [...nullable]])
```

Seeder que inserta las 4 orgs con códigos FCFN, PEJ, CEHLIDER, AEP.

### 6.2 Scope por organización en el resolvedor

Modificar `AbsenceResolver::loadActiveEmployees()` para aceptar un `?int $organizationId` y filtrar. Todos los endpoints protegidos reciben query param `?org=X` opcional.

### 6.3 Notificaciones

- Servicio `App\Services\NotificationService` con método `sendAbsenceApprovalRequest($absenceId)` y `sendAbsenceDecision($absenceId)`.
- Usar `\CodeIgniter\Email\Email::class` con SMTP (config en `.env`).
- Templates en `backend/app/Views/emails/absence_*.php`.
- Queue opcional con `tatter/queues` o procesamiento síncrono en este sprint.

### 6.4 Dashboard tipificado

Nuevo panel en `src/modules/dashboard/TypedAttendanceDashboard.tsx`:

- KPIs: % presente, % justificado, % injustificado, tasa de inasistencia real.
- Stacked bar chart por día mostrando los 4 estados (sin incluir `NOT_EXPECTED`).
- Heatmap empleado × día con colores de `absence_types.color_hex`.

Para la gráfica, introducir **Recharts** (`npm i recharts`) — justificado por la reducción drástica de código custom SVG.

### 6.5 Criterios de "done" Sprint 4

- [ ] Existen 4 organizaciones; cada empleado pertenece a una.
- [ ] Al solicitar una ausencia, el supervisor asignado recibe email con link directo.
- [ ] Al aprobar/rechazar, el empleado recibe email con el veredicto.
- [ ] Dashboard muestra KPIs separados para presencia efectiva vs inasistencia injustificada.
- [ ] Filtro "Organización" funciona transversalmente en todos los endpoints.

---

## 7. Dependencias a instalar

### Backend

```bash
cd backend
composer require phpoffice/phpspreadsheet    # Sprint 2 (importador)
```

### Frontend

```bash
npm install zod               # Sprint 1 (validación de formularios)
npm install recharts          # Sprint 4 (dashboard tipificado)
```

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper cálculos existentes al extender `AbsenceExpectationService` | Mantener firma pública y testear con fixture del estado actual (snapshot de `/api/absences` hoy vs post-cambio para rango sin ausencias registradas; deben ser idénticos). |
| Parser de fechas del xlsx legacy falle en edge cases | Logging exhaustivo de warnings + flag `--dry-run` + revisión manual de una muestra del 10%. |
| `App.tsx` de 3489 líneas se vuelve inmantenible al agregar más paneles | Política: todo módulo nuevo vive en `src/modules/<name>/`. Ninguna lógica de negocio del nuevo módulo entra en `App.tsx`. |
| Inconsistencia entre `attendance_records` y `employee_absences` (empleado con registro + ausencia aprobada el mismo día) | `AbsenceResolver` aplica precedencia: si hay registro de asistencia, prevalece `PRESENT`. Documentado en el enum. |
| Migración de producción con datos existentes | Las migraciones son aditivas (no DROP ni RENAME de campos existentes). Backup de BD antes de `php spark migrate` en prod. |

---

## 9. Checklist consolidado para la IA implementadora

**Sprint 1** (orden estricto):

1. `php spark make:migration CreateAbsenceTyping` y pegar contenido de §3.1.
2. Crear `AbsenceTypesSeeder` (§3.2) y ejecutar `php spark db:seed AbsenceTypesSeeder`.
3. Crear `AbsenceTypeModel`, `EmployeeAbsenceModel` (§3.3).
4. Crear `AttendanceDayState` enum (§3.4).
5. Crear `AbsenceResolver` (§3.5).
6. Modificar `AbsenceExpectationService` (§3.6) — aditivo, sin borrar.
7. Crear `AbsenceTypesController`, `AbsencesController` (§3.7).
8. Modificar `AttendanceController` para agregar `absencesTyped()` (§3.8).
9. Registrar rutas (§3.9).
10. Escribir tests (§3.10) y correr `vendor/bin/phpunit --testsuite Unit`.
11. Extender `src/api.ts` (§3.11).
12. Crear `src/modules/absences/` con los archivos listados (§3.12).
13. Agregar pestaña en `App.tsx` (§3.13).
14. `npm run build` debe pasar. `npm run lint` debe pasar.
15. Verificar cada criterio de §3.14.

**Sprint 2**: idem con §4. **Sprint 3**: idem con §5. **Sprint 4**: idem con §6.

Tras cada sprint, crear un PR con el título `feat(hr): Sprint N - <tema>` y descripción enlazando a la sección correspondiente de este documento.

---

## 10. Apéndice — Mapa de archivos nuevos

```
backend/app/
├── Commands/
│   ├── RecalculateLeaveBalancesCommand.php      [Sprint 2]
│   ├── ImportLegacyVacationsCommand.php         [Sprint 2]
│   └── GeneratePayrollPeriodsCommand.php        [Sprint 3]
├── Controllers/Api/
│   ├── AbsenceTypesController.php               [Sprint 1]
│   ├── AbsencesController.php                   [Sprint 1]
│   ├── LeaveBalancesController.php              [Sprint 2]
│   └── PayrollReportController.php              [Sprint 3]
├── Database/
│   ├── Migrations/
│   │   ├── 2026-04-24-000001_CreateAbsenceTyping.php       [Sprint 1]
│   │   ├── 2026-05-01-000001_CreateLeaveBalances.php       [Sprint 2]
│   │   ├── 2026-05-15-000001_CreatePayrollPeriods.php      [Sprint 3]
│   │   └── 2026-06-01-000001_CreateOrganizations.php       [Sprint 4]
│   └── Seeds/
│       ├── AbsenceTypesSeeder.php                           [Sprint 1]
│       └── OrganizationsSeeder.php                          [Sprint 4]
├── Models/
│   ├── AbsenceTypeModel.php                     [Sprint 1]
│   ├── EmployeeAbsenceModel.php                 [Sprint 1]
│   ├── LeaveBalanceModel.php                    [Sprint 2]
│   ├── PayrollPeriodModel.php                   [Sprint 3]
│   └── OrganizationModel.php                    [Sprint 4]
├── Services/
│   ├── AbsenceResolver.php                      [Sprint 1]
│   ├── AttendanceDayState.php                   [Sprint 1]
│   ├── MexicanLaborLawService.php               [Sprint 2]
│   ├── LeaveBalanceService.php                  [Sprint 2]
│   ├── PayrollPeriodService.php                 [Sprint 3]
│   ├── PayrollReportService.php                 [Sprint 3]
│   └── NotificationService.php                  [Sprint 4]
└── Views/emails/
    ├── absence_request.php                      [Sprint 4]
    └── absence_decision.php                     [Sprint 4]

src/modules/
├── absences/
│   ├── AbsencesPanel.tsx                        [Sprint 1]
│   ├── AbsenceFormDialog.tsx                    [Sprint 1]
│   ├── AbsenceStatusBadge.tsx                   [Sprint 1]
│   ├── TypedCalendar.tsx                        [Sprint 1]
│   ├── useAbsenceTypes.ts                       [Sprint 1]
│   └── absences.module.css                      [Sprint 1]
├── balances/
│   ├── LeaveBalancePanel.tsx                    [Sprint 2]
│   └── useLeaveBalance.ts                       [Sprint 2]
├── payroll/
│   ├── PayrollPeriodsPanel.tsx                  [Sprint 3]
│   ├── PayrollReportView.tsx                    [Sprint 3]
│   └── payroll.module.css                       [Sprint 3]
└── dashboard/
    └── TypedAttendanceDashboard.tsx             [Sprint 4]
```

---

## 11. Apéndice — Ejemplo de cURL para pruebas manuales

```bash
# Obtener token (login existente)
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local","password":"XXX"}' | jq -r .accessToken)

# Listar tipos
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/absence-types

# Crear ausencia
curl -X POST http://localhost:8080/api/employee-absences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"employee_id":1,"absence_type_id":1,"start_date":"2026-05-04","end_date":"2026-05-08","reason":"Vacaciones programadas"}'

# Aprobar
curl -X POST http://localhost:8080/api/employee-absences/1/approve \
  -H "Authorization: Bearer $TOKEN"

# Ver días tipificados de la semana
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/absences-typed?from=2026-05-04&to=2026-05-08"
```

---

---

## Apéndice C — Contratos compartidos tras refactor de duplicidades

Este apéndice se agrega como resultado del plan de remediación de duplicidades. Resume las **fuentes de verdad** del sistema para evitar divergencias futuras entre frontend y backend.

### C.1 Calendario laboral (días hábiles e inhábiles)

- Servicio único en backend: [`App\Services\WorkingCalendarService`](../backend/app/Services/WorkingCalendarService.php).
  - `WorkingCalendarService::listWeekdays($from, $to)` — días lunes a viernes en rango ISO inclusivo.
  - `WorkingCalendarService::workingDays($from, $to)` — hábiles menos inhábiles (`calendar_non_working_days`).
- `AbsenceResolver` y `AbsenceExpectationService` delegan en este servicio. **No** duplicar el cálculo en otros servicios PHP.
- Frontend espejo: [`src/lib/dates.ts::listWeekdaysBetween`](../src/lib/dates.ts) — usar este helper en lugar de bucles ad-hoc.

### C.2 Clasificación de entrada (ontime/late/verylate)

- Fuente de verdad: [`App\Services\AttendanceClassifier::classify`](../backend/app/Services/AttendanceClassifier.php).
- Versión de previsualización en UI: [`src/App.tsx::classifyEntry`](../src/App.tsx) — debe mantenerse alineada al backend.
- Política: cualquier cambio de regla (umbrales, tolerancia) se modifica primero en backend; luego se replica en el espejo del frontend dentro del mismo PR.

### C.3 Lockout temporal por intentos fallidos

- Helper compartido en backend: `BaseApiController::isLocked($lockedUntil)` — usado por `AuthController` (login web) y `KioskController` (kiosko).
- Política: nuevos flujos con bloqueo temporal deben reutilizar este helper en lugar de reimplementar la verificación.

### C.4 Configuración global del frontend

- `API_BASE` único en [`src/config.ts`](../src/config.ts). Todos los clientes HTTP (`src/api.ts`, `src/auth/apiAuth.ts`, `src/KioskShell.tsx`) deben importarlo desde ahí.

### C.5 Componente KPI compartido

- Componente reutilizable en [`src/modules/shared/Kpi.tsx`](../src/modules/shared/Kpi.tsx). Usado por dashboards de ausencias, nómina y saldos de vacaciones.

---

**Fin del documento.** Cualquier desviación de estas especificaciones durante la implementación debe justificarse en el PR y actualizarse aquí.