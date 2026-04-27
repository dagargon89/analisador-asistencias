import { useMemo } from "react";
import type { TypedDay, TypedDayState } from "../../api";
import { listWeekdaysBetween } from "../../lib/dates";
import styles from "./absences.module.css";

type Props = {
  days: TypedDay[];
  from: string;
  to: string;
};

const CELL_CLASS: Record<TypedDayState, string> = {
  NOT_EXPECTED: styles["abs-cell--empty"],
  PRESENT: styles["abs-cell--present"],
  JUSTIFIED_WORKED: styles["abs-cell--justified-worked"],
  JUSTIFIED_UNPAID: styles["abs-cell--justified-unpaid"],
  UNJUSTIFIED_ABSENCE: styles["abs-cell--unjustified"],
};

const SHORT: Record<TypedDayState, string> = {
  NOT_EXPECTED: "",
  PRESENT: "P",
  JUSTIFIED_WORKED: "JT",
  JUSTIFIED_UNPAID: "JS",
  UNJUSTIFIED_ABSENCE: "F",
};

export function TypedCalendar({ days, from, to }: Props) {
  const grid = useMemo(() => {
    const weekdays = listWeekdaysBetween(from, to);
    const byEmployee = new Map<string, Map<string, TypedDay>>();
    for (const d of days) {
      if (!byEmployee.has(d.employee)) byEmployee.set(d.employee, new Map());
      byEmployee.get(d.employee)!.set(d.date, d);
    }
    const employees = Array.from(byEmployee.keys()).sort((a, b) => a.localeCompare(b, "es"));
    return { weekdays, employees, byEmployee };
  }, [days, from, to]);

  if (grid.employees.length === 0 || grid.weekdays.length === 0) {
    return <div className={styles["abs-empty"]}>No hay datos para el rango seleccionado.</div>;
  }

  return (
    <div className={styles["abs-calendar"]}>
      <table>
        <thead>
          <tr>
            <th className={styles["abs-calendar__emp"]}>Empleado</th>
            {grid.weekdays.map((d) => (
              <th key={d} title={d}>{d.slice(5)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.employees.map((emp) => {
            const map = grid.byEmployee.get(emp)!;
            return (
              <tr key={emp}>
                <td className={styles["abs-calendar__emp"]}>{emp}</td>
                {grid.weekdays.map((d) => {
                  const cell = map.get(d);
                  const state: TypedDayState = cell?.state ?? "NOT_EXPECTED";
                  const title = cell
                    ? `${d} • ${state}${cell.absenceType ? " • " + cell.absenceType : ""}`
                    : `${d} • Fuera de contrato o no registrado`;
                  return (
                    <td key={d}>
                      <span className={`${styles["abs-cell"]} ${CELL_CLASS[state]}`} title={title}>
                        {SHORT[state]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
