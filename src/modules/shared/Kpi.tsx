import styles from "../absences/absences.module.css";

type KpiProps = {
  label: string;
  value: string | number;
  tone?: string;
};

/**
 * Tarjeta KPI compartida entre dashboards (ausencias, nómina, saldos, etc.).
 * - Si `value` es number, formatea con locale es-MX para consistencia.
 * - Si `value` es string, lo muestra tal cual (caller controla el formato).
 */
export function Kpi({ label, value, tone }: KpiProps) {
  return (
    <div className={styles["abs-kpi"]}>
      <div className={styles["abs-kpi__label"]}>{label}</div>
      <div className={styles["abs-kpi__value"]} style={tone ? { color: tone } : undefined}>
        {typeof value === "number" ? value.toLocaleString("es-MX") : value}
      </div>
    </div>
  );
}
