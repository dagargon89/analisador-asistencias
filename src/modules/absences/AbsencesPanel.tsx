import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  approveAbsence,
  cancelAbsence,
  deleteEmployeeAbsence,
  getTypedAbsences,
  listEmployeeAbsences,
  rejectAbsence,
  type AbsenceStatus,
  type EmployeeAbsence,
  type TypedAbsencesSummary,
  type TypedDay,
} from "../../api";
import { AbsenceFormDialog } from "./AbsenceFormDialog";
import { AbsenceStatusBadge } from "./AbsenceStatusBadge";
import { TypedCalendar } from "./TypedCalendar";
import styles from "./absences.module.css";

export type AbsencesPanelEmployee = { id: number; name: string; isActive: boolean };

type Props = {
  from: string;
  to: string;
  employees: AbsencesPanelEmployee[];
  selectedEmployee?: string | null;
  canManage?: boolean;
};

const STATUS_OPTIONS: { value: "" | AbsenceStatus; label: string }[] = [
  { value: "", label: "Todos los estados" },
  { value: "pending", label: "Pendientes" },
  { value: "approved", label: "Aprobadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "superseded", label: "Reemplazadas" },
];

const EMPTY_SUMMARY: TypedAbsencesSummary = {
  expected: 0,
  present: 0,
  justifiedWorked: 0,
  justifiedUnpaid: 0,
  unjustified: 0,
};

export function AbsencesPanel({ from, to, employees, selectedEmployee, canManage = true }: Props) {
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | AbsenceStatus>("");
  const [typedDays, setTypedDays] = useState<TypedDay[]>([]);
  const [typedSummary, setTypedSummary] = useState<TypedAbsencesSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EmployeeAbsence | null>(null);
  const [, startTransition] = useTransition();

  const employeeFilter = selectedEmployee && selectedEmployee !== "all" ? selectedEmployee : undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [abs, typed] = await Promise.all([
        listEmployeeAbsences({
          from,
          to,
          status: statusFilter || undefined,
          employee: employeeFilter,
        }),
        getTypedAbsences({ from, to, employee: employeeFilter }),
      ]);
      setAbsences(abs);
      setTypedDays(typed.days);
      setTypedSummary(typed.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando ausencias");
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter, employeeFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const employeeOptions = useMemo(
    () => employees.filter((e) => e.isActive).map((e) => ({ id: e.id, name: e.name })),
    [employees],
  );

  const openCreateDialog = () => {
    setEditRecord(null);
    setDialogOpen(true);
  };

  const handleApprove = (id: number) => {
    startTransition(async () => {
      try {
        await approveAbsence(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al aprobar");
      }
    });
  };

  const handleReject = (id: number) => {
    const reason = window.prompt("Motivo del rechazo:");
    if (reason === null) return;
    startTransition(async () => {
      try {
        await rejectAbsence(id, reason);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al rechazar");
      }
    });
  };

  const handleAnular = (a: EmployeeAbsence) => {
    const isApproved = a.status === "approved";
    const msg = isApproved
      ? "¿Anular esta solicitud aprobada? Dejará de contar en el calendario tipado y en el saldo LFT."
      : "¿Cancelar esta solicitud pendiente?";
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      try {
        await cancelAbsence(a.id);
        setError(null);
        await refresh();
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (isApproved && /quincena cerrada|forzar/i.test(m)) {
          if (
            window.confirm(
              "El permiso cruza una quincena cerrada. ¿Intentar de nuevo forzando? (solo tiene efecto si su usuario es administrador.)",
            )
          ) {
            try {
              await cancelAbsence(a.id, { forceClosedPeriod: true });
              setError(null);
              await refresh();
            } catch (e2) {
              setError(e2 instanceof Error ? e2.message : "No se pudo anular");
            }
          } else {
            setError(m);
          }
        } else {
          setError(m || "Error al anular");
        }
      }
    });
  };

  const handleEliminar = (a: EmployeeAbsence) => {
    if (!window.confirm("¿Eliminar permanentemente este registro? Esta acción no se puede deshacer.")) return;
    startTransition(async () => {
      try {
        await deleteEmployeeAbsence(a.id);
        setError(null);
        await refresh();
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (/quincena cerrada|forzar/i.test(m)) {
          if (
            window.confirm(
              "El registro cruza una quincena cerrada. ¿Forzar eliminación? (solo administrador.)",
            )
          ) {
            try {
              await deleteEmployeeAbsence(a.id, { forceClosedPeriod: true });
              setError(null);
              await refresh();
            } catch (e2) {
              setError(e2 instanceof Error ? e2.message : "No se pudo eliminar");
            }
          } else {
            setError(m);
          }
        } else {
          setError(m || "Error al eliminar");
        }
      }
    });
  };

  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: "Esperados", value: typedSummary.expected },
    { label: "Presentes", value: typedSummary.present, tone: "#27ae60" },
    { label: "Justificados", value: typedSummary.justifiedWorked + typedSummary.justifiedUnpaid, tone: "#2f80ed" },
    { label: "Inasistencias", value: typedSummary.unjustified, tone: "#eb5757" },
  ];

  return (
    <div className={styles["abs-panel"]}>
      <div className={styles["abs-kpi-row"]}>
        {kpis.map((k) => (
          <div key={k.label} className={styles["abs-kpi"]}>
            <div className={styles["abs-kpi__label"]}>{k.label}</div>
            <div className={styles["abs-kpi__value"]} style={k.tone ? { color: k.tone } : undefined}>
              {k.value.toLocaleString("es-MX")}
            </div>
          </div>
        ))}
      </div>

      <div className={styles["abs-toolbar"]}>
        <select
          className="input-field"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | AbsenceStatus)}
          style={{ minWidth: 180 }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className={styles["abs-toolbar__spacer"]} />
        {canManage && (
          <button
            type="button"
            className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}
            onClick={openCreateDialog}
          >
            + Nueva ausencia
          </button>
        )}
      </div>

      {error && <div className={styles["abs-error"]}>{error}</div>}

      {canManage && (
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 8px 0" }}>
          Puede <strong>corregir</strong> fechas y tipo en pendientes y aprobadas, <strong>anular</strong> aprobadas o pendientes
          (dejan de contar en reportes) o <strong>eliminar</strong> el registro. Si el permiso cruza una quincena cerrada, un
          administrador puede forzar la operación.
        </p>
      )}

      <TypedCalendar days={typedDays} from={from} to={to} />

      <div className={styles["abs-table-wrapper"]}>
        <table className={styles["abs-table"]}>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Tipo</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Días</th>
              <th>Estado</th>
              <th>Motivo</th>
              {canManage && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={canManage ? 8 : 7} className={styles["abs-empty"]}>
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && absences.length === 0 && (
              <tr>
                <td colSpan={canManage ? 8 : 7} className={styles["abs-empty"]}>
                  Sin ausencias registradas en el rango.
                </td>
              </tr>
            )}
            {!loading &&
              absences.map((a) => (
                <tr key={a.id}>
                  <td>{a.employeeName}</td>
                  <td>
                    <span className={styles["abs-type-chip"]} style={{ background: a.colorHex }}>
                      {a.typeLabel}
                    </span>
                  </td>
                  <td>{a.startDate}</td>
                  <td>{a.endDate}</td>
                  <td>{a.businessDays}</td>
                  <td>
                    <AbsenceStatusBadge status={a.status} />
                  </td>
                  <td style={{ maxWidth: 260 }}>{a.reason ?? ""}</td>
                  {canManage && (
                    <td>
                      <div className={styles["abs-row-actions"]}>
                        {a.status === "pending" && (
                          <>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--approve"]}`}
                              onClick={() => handleApprove(a.id)}
                            >
                              Aprobar
                            </button>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--reject"]}`}
                              onClick={() => handleReject(a.id)}
                            >
                              Rechazar
                            </button>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--cancel"]}`}
                              onClick={() => handleAnular(a)}
                            >
                              Anular
                            </button>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--edit"]}`}
                              onClick={() => {
                                setEditRecord(a);
                                setDialogOpen(true);
                              }}
                            >
                              Corregir
                            </button>
                          </>
                        )}
                        {a.status === "approved" && (
                          <>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--cancel"]}`}
                              onClick={() => handleAnular(a)}
                            >
                              Anular
                            </button>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--edit"]}`}
                              onClick={() => {
                                setEditRecord(a);
                                setDialogOpen(true);
                              }}
                            >
                              Corregir
                            </button>
                            <button
                              type="button"
                              className={`${styles["abs-btn"]} ${styles["abs-btn--danger"]}`}
                              onClick={() => handleEliminar(a)}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                        {(a.status === "rejected" || a.status === "cancelled") && (
                          <button
                            type="button"
                            className={`${styles["abs-btn"]} ${styles["abs-btn--danger"]}`}
                            onClick={() => handleEliminar(a)}
                          >
                            Eliminar
                          </button>
                        )}
                        {a.status === "superseded" && (
                          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>—</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <AbsenceFormDialog
        open={dialogOpen}
        editRecord={editRecord}
        onClose={() => {
          setDialogOpen(false);
          setEditRecord(null);
        }}
        onSuccess={() => {
          void refresh();
        }}
        employees={employeeOptions}
      />
    </div>
  );
}
