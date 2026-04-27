import { useMemo, useState, useTransition } from "react";
import { recalcLeaveBalances } from "../../api";
import { useLeaveBalance } from "./useLeaveBalance";
import { Kpi } from "../shared/Kpi";
import styles from "./absences.module.css";

type Props = {
  employees: { id: number; name: string; isActive: boolean }[];
  canManage?: boolean;
};

export function LeaveBalancePanel({ employees, canManage = true }: Props) {
  const active = useMemo(() => employees.filter((e) => e.isActive), [employees]);
  const [selected, setSelected] = useState<number | null>(active[0]?.id ?? null);
  const { balance, loading, error, refresh } = useLeaveBalance(selected);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const handleRecalc = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await recalcLeaveBalances();
        setMessage(`Saldos recalculados para ${res.recalculated} empleado(s).`);
        await refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Error al recalcular");
      }
    });
  };

  return (
    <div className={styles["abs-panel"]}>
      <div className={styles["abs-toolbar"]}>
        <select
          className="input-field"
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
          style={{ minWidth: 240 }}
        >
          <option value="">Seleccionar empleado</option>
          {active.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <div className={styles["abs-toolbar__spacer"]} />
        {canManage && (
          <button
            type="button"
            className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}
            onClick={handleRecalc}
            disabled={pending}
          >
            {pending ? "Recalculando..." : "Recalcular saldos globales"}
          </button>
        )}
      </div>

      {error && <div className={styles["abs-error"]}>{error}</div>}
      {message && <div className={styles["abs-balance-hint"]}>{message}</div>}

      {loading && <div className={styles["abs-empty"]}>Cargando saldo...</div>}

      {!loading && balance && (
        <div className={styles["abs-kpi-row"]}>
          <Kpi label="Antigüedad" value={`${balance.yearsOfService} años`} />
          <Kpi label="Otorgados" value={`${balance.entitledDays.toFixed(2)}`} />
          <Kpi label="Usados" value={`${balance.usedDays.toFixed(2)}`} tone="#f2994a" />
          <Kpi label="Arrastre" value={`${balance.carriedOverDays.toFixed(2)}`} />
          <Kpi label="Disponibles" value={`${balance.availableDays.toFixed(2)}`} tone="#27ae60" />
          <Kpi label="Prima vac. (días)" value={`${balance.primaVacacionalDays.toFixed(2)}`} />
        </div>
      )}

      {!loading && balance && (
        <div className={styles["abs-balance-hint"]}>
          Año aniversario: <b>{balance.periodStart}</b> → <b>{balance.periodEnd}</b> · Caducidad: <b>{balance.expirationDate}</b>
        </div>
      )}

      {!loading && selected && !balance && (
        <div className={styles["abs-empty"]}>El empleado no tiene saldo calculado. Asegúrate de que tenga hire_date.</div>
      )}
    </div>
  );
}

