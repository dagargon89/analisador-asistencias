import { useState } from "react";
import { kioskAuth } from "./api";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

type KioskEmployee = { id: number; name: string; employeeCode: string };

export default function KioskShell() {
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
    <div style={{ minHeight: "100vh", background: "#090d16", color: "#e2e8f0", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ width: "min(560px, 96vw)", background: "linear-gradient(135deg, rgba(20,27,45,0.95), rgba(15,20,35,0.95))", border: "1px solid rgba(99,132,255,0.2)", borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Checador Kiosko</div>
          <a href="/" style={{ color: "#90a0ff", fontSize: 13 }}>Ir a panel admin</a>
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
            <div style={{ fontSize: 14, color: "#8ea0c8" }}>
              Empleado: <strong style={{ color: "#e2e8f0" }}>{employee.name}</strong> ({employee.employeeCode})
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={btnStyle} disabled={busy} onClick={() => void callPunch("/api/attendance/clock-in")}>Checar entrada</button>
              <button style={{ ...btnStyle, background: "linear-gradient(135deg, #22c55e, #16a34a)" }} disabled={busy} onClick={() => void callPunch("/api/attendance/clock-out")}>Checar salida</button>
              <button style={{ ...btnStyle, background: "#25314e" }} onClick={() => { setToken(null); setEmployee(null); setEmployeeCode(""); setPin(""); setMessage(null); }}>Cerrar sesión</button>
            </div>
          </div>
        )}

        {message && <div style={{ marginTop: 12, fontSize: 13, color: "#c5cde0", whiteSpace: "pre-wrap" }}>{message}</div>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(10,14,23,0.8)",
  border: "1px solid rgba(99,132,255,0.25)",
  borderRadius: 10,
  padding: "12px 12px",
  color: "#e2e8f0",
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

