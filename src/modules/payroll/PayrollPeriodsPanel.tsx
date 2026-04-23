import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  closePayrollPeriod,
  downloadPayrollReportXlsx,
  generatePayrollPeriods,
  getPayrollPeriods,
  type PayrollPeriod,
} from "../../api";
import { PayrollReportView } from "./PayrollReportView";
import styles from "../absences/absences.module.css";

type Props = {
  canManage?: boolean;
};

export function PayrollPeriodsPanel({ canManage = true }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getPayrollPeriods(year);
      setPeriods(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar periodos");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (periods.length === 0) {
      if (selected !== null) setSelected(null);
      return;
    }
    if (!periods.some((p) => p.id === selected)) {
      setSelected(periods[0].id);
    }
  }, [periods, selected]);

  const handleGenerate = () => {
    setInfo(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await generatePayrollPeriods(year);
        setInfo(`Se insertaron ${res.inserted} periodo(s) para ${year}.`);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al generar");
      }
    });
  };

  const handleClose = (id: number) => {
    if (!window.confirm("¿Cerrar quincena? Una vez cerrada, no se podrán crear ausencias en su rango.")) return;
    setInfo(null);
    setError(null);
    startTransition(async () => {
      try {
        await closePayrollPeriod(id);
        setInfo(`Quincena #${id} cerrada.`);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cerrar");
      }
    });
  };

  const handleDownload = async (id: number, label: string) => {
    setError(null);
    try {
      const blob = await downloadPayrollReportXlsx(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = label.replace(/[^A-Za-z0-9_-]+/g, "_");
      a.download = `Incidencias_${safe}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al descargar");
    }
  };

  const handleView = (id: number) => {
    setError(null);
    setSelected(id);
  };

  const selectedPeriod = useMemo(() => periods.find((p) => p.id === selected) ?? null, [periods, selected]);

  return (
    <div className={styles["abs-panel"]}>
      <div className={styles["abs-toolbar"]}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          Año
          <input
            type="number"
            value={year}
            min={2020}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value) || currentYear)}
            style={{ width: 90 }}
            className="input-field"
          />
        </label>
        <div className={styles["abs-toolbar__spacer"]} />
        {canManage && (
          <button
            type="button"
            className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}
            disabled={pending}
            onClick={handleGenerate}
          >
            Generar periodos {year}
          </button>
        )}
      </div>

      {error && <div className={styles["abs-error"]}>{error}</div>}
      {info && <div className={styles["abs-balance-hint"]}>{info}</div>}

      <div className={styles["abs-table-wrapper"]}>
        <table className={styles["abs-table"]}>
          <thead>
            <tr>
              <th>Quincena</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Días</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className={styles["abs-empty"]}>Cargando...</td></tr>
            )}
            {!loading && periods.length === 0 && (
              <tr><td colSpan={6} className={styles["abs-empty"]}>No hay periodos. Genera los del año.</td></tr>
            )}
            {!loading && periods.map((p) => (
              <tr key={p.id} style={selected === p.id ? { background: "rgba(47,128,237,0.05)" } : undefined}>
                <td>{p.label}</td>
                <td>{p.startDate}</td>
                <td>{p.endDate}</td>
                <td>{p.expectedCalendarDays}</td>
                <td>
                  <span
                    className={styles["abs-status"]}
                    style={{
                      background: p.status === "closed" ? "rgba(130,130,130,0.18)" : "rgba(39,174,96,0.18)",
                      color: p.status === "closed" ? "#7a7a7a" : "#219653",
                    }}
                  >
                    {p.status === "closed" ? "Cerrada" : "Abierta"}
                  </span>
                </td>
                <td>
                  <div className={styles["abs-row-actions"]}>
                    <button
                      type="button"
                      className={`${styles["abs-btn"]} ${styles["abs-btn--ghost"]}`}
                      onClick={() => handleView(p.id)}
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}
                      onClick={() => handleDownload(p.id, p.label)}
                    >
                      XLSX
                    </button>
                    {canManage && p.status === "open" && (
                      <button
                        type="button"
                        className={`${styles["abs-btn"]} ${styles["abs-btn--reject"]}`}
                        onClick={() => handleClose(p.id)}
                      >
                        Cerrar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPeriod && <PayrollReportView periodId={selectedPeriod.id} />}
    </div>
  );
}
