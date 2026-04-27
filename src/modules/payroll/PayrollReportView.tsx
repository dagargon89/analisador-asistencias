import { useEffect, useState } from "react";
import { getPayrollReport, type PayrollReport } from "../../api";
import { Kpi } from "../shared/Kpi";
import styles from "../absences/absences.module.css";

type Props = { periodId: number };

export function PayrollReportView({ periodId }: Props) {
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await getPayrollReport(periodId);
        if (active) setReport(r);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Error al cargar reporte");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [periodId]);

  if (loading) return <div className={styles["abs-empty"]}>Cargando reporte...</div>;
  if (error) return <div className={styles["abs-error"]}>{error}</div>;
  if (!report) return null;

  return (
    <div className={styles["abs-panel"]}>
      <h3 style={{ margin: 0 }}>Reporte: {report.period.label}</h3>

      <div className={styles["abs-kpi-row"]}>
        <Kpi label="Empleados" value={String(report.totals.employees ?? 0)} />
        <Kpi label="Días trabajados" value={String(report.totals.days_worked ?? 0)} tone="#27ae60" />
        <Kpi label="Vacaciones" value={String(report.totals.vacation_days ?? 0)} tone="#2f80ed" />
        <Kpi label="Permisos" value={String(report.totals.leave_days ?? 0)} tone="#f2994a" />
        <Kpi label="Inasistencias" value={String(report.totals.unjustified_absences ?? 0)} tone="#eb5757" />
      </div>

      <div className={styles["abs-table-wrapper"]}>
        <table className={styles["abs-table"]}>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Código</th>
              <th>Departamento</th>
              <th>Días trab.</th>
              <th>Vac.</th>
              <th>Permisos</th>
              <th>Inasist.</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr><td colSpan={8} className={styles["abs-empty"]}>Sin datos.</td></tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.employeeId}>
                <td>{r.employeeName}</td>
                <td>{r.employeeCode}</td>
                <td>{r.department}</td>
                <td>{r.daysWorked}</td>
                <td>{r.vacationDays}</td>
                <td>{r.leaveDays}</td>
                <td>{r.unjustifiedAbsences}</td>
                <td style={{ maxWidth: 360 }}>{r.observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

