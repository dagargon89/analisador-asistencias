import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getTypedAbsences, type TypedAbsencesSummary, type TypedDay } from "../../api";
import { Kpi } from "../shared/Kpi";
import styles from "./absences.module.css";

type Props = {
  from: string;
  to: string;
  employee?: string | null;
  organizationId?: number | null;
};

const STATE_COLOR: Record<string, string> = {
  PRESENT: "#27ae60",
  JUSTIFIED_WORKED: "#2f80ed",
  JUSTIFIED_UNPAID: "#f2994a",
  UNJUSTIFIED_ABSENCE: "#eb5757",
  NOT_EXPECTED: "#8a94b3",
};

export function TypedAttendanceDashboard({ from, to, employee, organizationId }: Props) {
  const [days, setDays] = useState<TypedDay[]>([]);
  const [summary, setSummary] = useState<TypedAbsencesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await getTypedAbsences({
          from,
          to,
          employee: employee ?? undefined,
          organizationId: organizationId ?? undefined,
        });
        if (!active) return;
        setDays(res.days);
        setSummary(res.summary);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Error al cargar dashboard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [from, to, employee, organizationId]);

  const pieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Presentes", value: summary.present, color: STATE_COLOR.PRESENT },
      { name: "Justificado (trabajado)", value: summary.justifiedWorked, color: STATE_COLOR.JUSTIFIED_WORKED },
      { name: "Sin goce", value: summary.justifiedUnpaid, color: STATE_COLOR.JUSTIFIED_UNPAID },
      { name: "Inasistencias", value: summary.unjustified, color: STATE_COLOR.UNJUSTIFIED_ABSENCE },
    ].filter((d) => d.value > 0);
  }, [summary]);

  const topOffenders = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((d) => {
      if (d.state === "UNJUSTIFIED_ABSENCE") {
        map.set(d.employee, (map.get(d.employee) ?? 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [days]);

  return (
    <div className={styles["abs-panel"]}>
      {loading && <div className={styles["abs-empty"]}>Cargando dashboard...</div>}
      {error && <div className={styles["abs-error"]}>{error}</div>}

      {summary && (
        <div className={styles["abs-kpi-row"]}>
          <Kpi label="Esperados" value={summary.expected} />
          <Kpi label="Presentes" value={summary.present} tone={STATE_COLOR.PRESENT} />
          <Kpi label="Justificado" value={summary.justifiedWorked + summary.justifiedUnpaid} tone={STATE_COLOR.JUSTIFIED_WORKED} />
          <Kpi label="Inasistencias" value={summary.unjustified} tone={STATE_COLOR.UNJUSTIFIED_ABSENCE} />
          <Kpi
            label="% Adherencia"
            value={summary.expected > 0 ? `${((summary.present / summary.expected) * 100).toFixed(1)}%` : "—"}
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        <div className={styles["abs-kpi"]} style={{ padding: 16 }}>
          <div className={styles["abs-kpi__label"]} style={{ marginBottom: 8 }}>Distribución de estados</div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={95} label>
                  {pieData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={styles["abs-kpi"]} style={{ padding: 16 }}>
          <div className={styles["abs-kpi__label"]} style={{ marginBottom: 8 }}>Top 10 inasistencias por empleado</div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={topOffenders} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,132,255,0.1)" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} fontSize={10} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill={STATE_COLOR.UNJUSTIFIED_ABSENCE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

