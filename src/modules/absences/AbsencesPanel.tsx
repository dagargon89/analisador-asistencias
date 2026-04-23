import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  approveAbsence,
  cancelAbsence,
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

  const handleCancel = (id: number) => {
    if (!window.confirm("¿Cancelar la solicitud?")) return;
    startTransition(async () => {
      try {
        await cancelAbsence(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cancelar");
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
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className={styles["abs-toolbar__spacer"]} />
        {canManage && (
          <button
            className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}
            onClick={() => setDialogOpen(true)}
          >
            + Nueva ausencia
          </button>
        )}
      </div>

      {error && <div className={styles["abs-error"]}>{error}</div>}

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
            {!loading && absences.map((a) => (
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
                <td><AbsenceStatusBadge status={a.status} /></td>
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
                            onClick={() => handleCancel(a.id)}
                          >
                            Cancelar
                          </button>
                        </>
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
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          void refresh();
        }}
        employees={employeeOptions}
      />
    </div>
  );
}
