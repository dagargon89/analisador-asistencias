import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AbsenceStatus,
  type EmployeeAbsence,
  listEmployeeAbsences,
} from "../../api";
import { toIsoDate } from "../../lib/dates";
import styles from "./absencesMonthCalendar.module.css";

/**
 * Calendario mensual de ausencias compartido.
 *
 * Se usa tanto en el Dashboard principal como en la sección de Vacaciones y
 * Ausencias para garantizar que ambos calendarios sean visualmente y
 * funcionalmente idénticos. Recibe únicamente filtros y carga las ausencias
 * directamente desde el API.
 */

type Props = {
  /**
   * Filtro por nombre de empleado. Si es undefined, "all" o vacío, se muestran
   * las ausencias de todos los empleados activos.
   */
  selectedEmployee?: string | null;
  /** Mes inicial a mostrar; por defecto el mes actual. */
  initialDate?: Date;
  /** Título visual de la tarjeta. */
  title?: string;
  /** Subtítulo opcional. */
  subtitle?: string;
};

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const STATUS_LABELS: Record<AbsenceStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  superseded: "Reemplazada",
};

const VISIBLE_STATUS: AbsenceStatus[] = ["pending", "approved"];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function buildGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date } {
  const firstDay = monthStart.getDay();
  const offsetToMonday = (firstDay + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - offsetToMonday);

  const monthEnd = endOfMonth(monthStart);
  const lastDay = monthEnd.getDay();
  const offsetToSunday = (7 - lastDay) % 7;
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + offsetToSunday);

  return { gridStart, gridEnd };
}

function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function isInRange(iso: string, fromIso: string, toIso: string): boolean {
  return iso >= fromIso && iso <= toIso;
}

function isWeekend(d: Date): boolean {
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

function abbrev(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 12);
  return (parts[0]![0] ?? "") + ". " + parts[parts.length - 1];
}

export function AbsencesMonthCalendar({
  selectedEmployee,
  initialDate,
  title = "Calendario de vacaciones, permisos y ausencias",
  subtitle,
}: Props) {
  const [cursor, setCursor] = useState<Date>(() =>
    startOfMonth(initialDate ?? new Date()),
  );
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const employeeFilter =
    selectedEmployee && selectedEmployee !== "all"
      ? selectedEmployee
      : undefined;

  const { from, to, days, monthStart } = useMemo(() => {
    const monthStart = cursor;
    const monthEnd = endOfMonth(monthStart);
    const { gridStart, gridEnd } = buildGridRange(monthStart);
    return {
      monthStart,
      monthEnd,
      from: toIsoDate(gridStart),
      to: toIsoDate(gridEnd),
      days: eachDay(gridStart, gridEnd),
    };
  }, [cursor]);

  const loadAbsences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        VISIBLE_STATUS.map((status) =>
          listEmployeeAbsences({
            from,
            to,
            status,
            employee: employeeFilter,
          }),
        ),
      );
      setAbsences(results.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando calendario");
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeFilter]);

  useEffect(() => {
    void loadAbsences();
  }, [loadAbsences]);

  const absencesByDay = useMemo(() => {
    const map = new Map<string, EmployeeAbsence[]>();
    for (const day of days) {
      const iso = toIsoDate(day);
      const matches = absences.filter((a) =>
        isInRange(iso, a.startDate, a.endDate),
      );
      if (matches.length > 0) {
        matches.sort((a, b) =>
          a.employeeName.localeCompare(b.employeeName, "es"),
        );
        map.set(iso, matches);
      }
    }
    return map;
  }, [days, absences]);

  const distinctTypes = useMemo(() => {
    const seen = new Map<string, { label: string; colorHex: string }>();
    for (const a of absences) {
      if (!seen.has(a.typeCode)) {
        seen.set(a.typeCode, { label: a.typeLabel, colorHex: a.colorHex });
      }
    }
    return Array.from(seen.entries()).map(([code, v]) => ({ code, ...v }));
  }, [absences]);

  const headerLabel = `${MONTH_LABELS[monthStart.getMonth()]} ${monthStart.getFullYear()}`;

  const goPrev = () => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  };
  const goNext = () => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  };
  const goToday = () => {
    setCursor(startOfMonth(new Date()));
  };

  const todayIso = toIsoDate(new Date());

  const selectedAbsences = selectedDay
    ? (absencesByDay.get(selectedDay) ?? [])
    : [];

  return (
    <div className={styles["amc-card"]}>
      <header className={styles["amc-header"]}>
        <div>
          <h3 className={styles["amc-title"]}>{title}</h3>
          {subtitle && <div className={styles["amc-subtitle"]}>{subtitle}</div>}
        </div>
        <div className={styles["amc-controls"]}>
          <button
            type="button"
            onClick={goPrev}
            className={styles["amc-nav-btn"]}
            aria-label="Mes anterior"
          >
            ◀
          </button>
          <div className={styles["amc-month-label"]}>{headerLabel}</div>
          <button
            type="button"
            onClick={goNext}
            className={styles["amc-nav-btn"]}
            aria-label="Mes siguiente"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={goToday}
            className={styles["amc-today-btn"]}
          >
            Hoy
          </button>
        </div>
      </header>

      {distinctTypes.length > 0 && (
        <div className={styles["amc-legend"]}>
          {distinctTypes.map((t) => (
            <span key={t.code} className={styles["amc-legend-item"]}>
              <span
                className={styles["amc-legend-swatch"]}
                style={{ background: t.colorHex }}
              />
              {t.label}
            </span>
          ))}
        </div>
      )}

      {error && <div className={styles["amc-error"]}>{error}</div>}

      <div
        className={styles["amc-grid-head"]}
        aria-hidden={loading ? true : undefined}
      >
        {WEEKDAY_LABELS.map((wd) => (
          <div key={wd} className={styles["amc-weekday-label"]}>
            {wd}
          </div>
        ))}
      </div>

      <div
        className={styles["amc-grid"]}
        style={loading ? { opacity: 0.5 } : undefined}
      >
        {days.map((day) => {
          const iso = toIsoDate(day);
          const inMonth = day.getMonth() === monthStart.getMonth();
          const events = absencesByDay.get(iso) ?? [];
          const isToday = iso === todayIso;
          const weekend = isWeekend(day);
          const visibleEvents = events.slice(0, 3);
          const remaining = events.length - visibleEvents.length;
          const cellClasses = [
            styles["amc-cell"],
            !inMonth ? styles["amc-cell--outside"] : "",
            weekend ? styles["amc-cell--weekend"] : "",
            isToday ? styles["amc-cell--today"] : "",
            events.length > 0 ? styles["amc-cell--has-events"] : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={iso}
              type="button"
              className={cellClasses}
              onClick={() =>
                events.length > 0 ? setSelectedDay(iso) : undefined
              }
              aria-label={`${iso} — ${events.length} eventos`}
              disabled={events.length === 0}
            >
              <div className={styles["amc-cell-day"]}>{day.getDate()}</div>
              <div className={styles["amc-cell-events"]}>
                {visibleEvents.map((ev) => (
                  <span
                    key={ev.id}
                    className={styles["amc-event-chip"]}
                    style={{
                      background: ev.colorHex,
                      opacity: ev.status === "pending" ? 0.7 : 1,
                    }}
                    title={`${ev.employeeName} • ${ev.typeLabel} (${STATUS_LABELS[ev.status]})`}
                  >
                    {abbrev(ev.employeeName)}
                  </span>
                ))}
                {remaining > 0 && (
                  <span className={styles["amc-event-more"]}>
                    +{remaining} más
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div
          className={styles["amc-modal"]}
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedDay(null)}
        >
          <div className={styles["amc-modal-backdrop"]} />
          <div
            className={styles["amc-modal-content"]}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles["amc-modal-header"]}>
              <h4>Ausencias del {selectedDay}</h4>
              <button
                type="button"
                className={styles["amc-modal-close"]}
                onClick={() => setSelectedDay(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            {selectedAbsences.length === 0 ? (
              <div className={styles["amc-modal-empty"]}>Sin ausencias.</div>
            ) : (
              <ul className={styles["amc-modal-list"]}>
                {selectedAbsences.map((a) => (
                  <li key={a.id} className={styles["amc-modal-item"]}>
                    <span
                      className={styles["amc-modal-swatch"]}
                      style={{ background: a.colorHex }}
                    />
                    <div className={styles["amc-modal-item-body"]}>
                      <div className={styles["amc-modal-item-title"]}>
                        {a.employeeName}
                      </div>
                      <div className={styles["amc-modal-item-sub"]}>
                        {a.typeLabel} · {a.startDate} → {a.endDate} ·{" "}
                        {a.businessDays} día(s) ·{" "}
                        <span className={styles["amc-status-" + a.status]}>
                          {STATUS_LABELS[a.status]}
                        </span>
                      </div>
                      {a.reason && (
                        <div className={styles["amc-modal-item-reason"]}>
                          {a.reason}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
