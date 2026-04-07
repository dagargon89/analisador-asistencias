import { useState } from "react";
import { kioskAuth } from "./api";
import { useTheme } from "./theme/ThemeContext";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

type KioskEmployee = { id: number; name: string; employeeCode: string };

export default function KioskShell() {
  const { theme, toggleTheme } = useTheme();
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [employee, setEmployee] = useState<KioskEmployee | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const callPunch = async (path: "/api/attendance/clock-in" | "/api/attendance/clock-out") => {
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceId: "kiosk-web" }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
      setMessage(path.endsWith("clock-in") ? "Entrada registrada correctamente." : "Salida registrada correctamente.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo registrar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ width: "min(560px, 96vw)", background: "var(--color-panel-bg)", border: "1px solid var(--color-border-strong)", borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Checador Kiosko</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={ghostBtnStyle} onClick={toggleTheme}>
              {theme === "dark" ? "Modo light" : "Modo dark"}
            </button>
            <a href="/" style={{ color: "var(--color-link)", fontSize: 13 }}>Ir a panel admin</a>
          </div>
        </div>
        {!token && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage(null);
              try {
                const data = await kioskAuth({ employeeCode: employeeCode.trim(), pin: pin.trim() });
                setToken(data.accessToken);
                setEmployee(data.employee);
                setPin("");
                setMessage(`Bienvenido/a ${data.employee.name}.`);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "No se pudo autenticar.");
              } finally {
                setBusy(false);
              }
            }}
            style={{ display: "grid", gap: 10 }}
          >
            <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())} placeholder="Código de empleado" style={inputStyle} />
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" type="password" style={inputStyle} />
            <button style={btnStyle} disabled={busy}>{busy ? "Validando..." : "Ingresar"}</button>
          </form>
        )}

        {token && employee && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
              Empleado: <strong style={{ color: "var(--color-text)" }}>{employee.name}</strong> ({employee.employeeCode})
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={btnStyle} disabled={busy} onClick={() => void callPunch("/api/attendance/clock-in")}>Checar entrada</button>
              <button style={{ ...btnStyle, background: "linear-gradient(135deg, #22c55e, #16a34a)" }} disabled={busy} onClick={() => void callPunch("/api/attendance/clock-out")}>Checar salida</button>
              <button style={{ ...btnStyle, background: "#25314e" }} onClick={() => { setToken(null); setEmployee(null); setEmployeeCode(""); setPin(""); setMessage(null); }}>Cerrar sesión</button>
            </div>
          </div>
        )}

        {message && <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-soft)", whiteSpace: "pre-wrap" }}>{message}</div>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 10,
  padding: "12px 12px",
  color: "var(--color-text)",
  outline: "none",
  fontSize: 16,
};

const btnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #6384ff, #5a6fff)",
  border: "none",
  borderRadius: 10,
  padding: "12px 12px",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

const ghostBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  borderRadius: 10,
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 12,
};

