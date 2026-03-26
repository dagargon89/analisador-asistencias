import { useState } from "react";
import { useAuth } from "./AuthContext";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, doLogin, doLogout, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0e17", color: "#c5cde0" }}>Verificando sesión...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0e17", color: "#e2e8f0" }}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            setError(null);
            try {
              await doLogin(email, password);
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
            } finally {
              setSubmitting(false);
            }
          }}
          style={{
            width: "min(420px, 92vw)",
            background: "linear-gradient(135deg, rgba(20,27,45,0.95), rgba(15,20,35,0.95))",
            border: "1px solid rgba(99,132,255,0.18)",
            borderRadius: 14,
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>Iniciar sesión</div>
          <div style={{ fontSize: 12, color: "#8fa0c5" }}>Acceso admin/supervisor para reportes, importación y chat.</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} autoComplete="username" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" type="password" style={inputStyle} autoComplete="current-password" />
          {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
          <button disabled={submitting} style={btnStyle}>{submitting ? "Entrando..." : "Entrar"}</button>
          <a href="/kiosk" style={{ color: "#8193ff", fontSize: 12, textAlign: "right" }}>Ir a modo kiosko</a>
        </form>
      </div>
    );
  }

  const role = user?.role ?? "";
  const canUseAdmin = role === "admin" || role === "supervisor";
  if (!canUseAdmin) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0e17", color: "#e2e8f0" }}>
        <div style={{ width: "min(460px, 94vw)", background: "#121a2d", border: "1px solid rgba(99,132,255,0.2)", borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Acceso restringido al panel</div>
          <div style={{ fontSize: 13, color: "#8fa0c5", lineHeight: 1.5 }}>
            Tu rol actual es <strong style={{ color: "#fff" }}>{role || "desconocido"}</strong>. Este panel está reservado para admin/supervisor.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <a href="/kiosk" style={{ color: "#8193ff", fontSize: 13 }}>Ir a kiosko</a>
            <button onClick={() => void doLogout()} style={{ ...btnStyle, padding: "6px 10px", fontSize: 11 }}>Salir</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: "fixed", top: 10, right: 14, zIndex: 9999, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8fa0c5", background: "rgba(10,14,23,0.9)", border: "1px solid rgba(99,132,255,0.2)", borderRadius: 8, padding: "4px 8px" }}>
          {user?.email} ({user?.role})
        </span>
        <button onClick={() => void doLogout()} style={{ ...btnStyle, padding: "6px 10px", fontSize: 11 }}>Salir</button>
      </div>
      {children}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(10,14,23,0.8)",
  border: "1px solid rgba(99,132,255,0.25)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#e2e8f0",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #6384ff, #5a6fff)",
  border: "none",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

