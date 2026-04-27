import { useCallback, useEffect, useMemo, useState } from "react";
import { type ApiEmployee, getEmployees } from "../../api";
import { EmployeeProfileDrawer } from "./EmployeeProfileDrawer";
import styles from "./employees.module.css";

export function EmployeesSection() {
  const [rows, setRows] = useState<ApiEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEmployees();
      setRows(data.employees ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los empleados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.isActive) return false;
      if (!q) return true;
      const haystack = [
        r.name,
        r.employeeCode ?? "",
        r.email ?? "",
        r.position ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, showInactive]);

  const handleSaved = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className={styles["emp-panel"]}>
      <div className={styles["emp-toolbar"]}>
        <input
          className={styles["emp-search"]}
          placeholder="Buscar por nombre, código, puesto, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={styles["emp-toggle"]}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar inactivos
        </label>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(235,87,87,0.12)",
            border: "1px solid rgba(235,87,87,0.3)",
            borderRadius: 8,
            color: "#c0392b",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div className={styles["emp-table-wrapper"]}>
        <table className={styles["emp-table"]}>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Puesto</th>
              <th>Contratación</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className={styles["emp-empty"]} colSpan={5}>
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td className={styles["emp-empty"]} colSpan={5}>
                  Sin empleados que coincidan con la búsqueda.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r) => (
                <tr key={r.id} onClick={() => setDrawerId(r.id)}>
                  <td>
                    <div className={styles["emp-cell-name"]}>
                      <strong>{r.name}</strong>
                      <span>{r.employeeCode ?? "Sin código"}{r.email ? " · " + r.email : ""}</span>
                    </div>
                  </td>
                  <td>{r.position ?? "—"}</td>
                  <td>{r.hireDate ?? "—"}</td>
                  <td>
                    <span
                      className={
                        r.isActive
                          ? styles["emp-status-active"]
                          : styles["emp-status-inactive"]
                      }
                    >
                      {r.isActive ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles["emp-link"]}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDrawerId(r.id);
                      }}
                    >
                      Ver perfil →
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <EmployeeProfileDrawer
        employeeId={drawerId}
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
