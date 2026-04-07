import { useState } from "react";
import { useAuth } from "./AuthContext";
import { useTheme } from "../theme/ThemeContext";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, doLogin, doLogout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--color-bg)", color: "var(--color-text-soft)" }}>Verificando sesión...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--color-bg)", color: "var(--color-text)" }}>
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
            background: "var(--color-panel-bg)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: 14,
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={toggleTheme} style={ghostBtnStyle}>
              {theme === "dark" ? "Modo light" : "Modo dark"}
            </button>
          </div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Iniciar sesión</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Acceso admin/supervisor para reportes, importación y chat.</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} autoComplete="username" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" type="password" style={inputStyle} autoComplete="current-password" />
          {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
          <button disabled={submitting} style={btnStyle}>{submitting ? "Entrando..." : "Entrar"}</button>
          <a href="/kiosk" style={{ color: "var(--color-link)", fontSize: 12, textAlign: "right" }}>Ir a modo kiosko</a>
        </form>
      </div>
    );
  }

  const role = user?.role ?? "";
  const canUseAdmin = role === "admin" || role === "supervisor";
  if (!canUseAdmin) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--color-bg)", color: "var(--color-text)" }}>
        <div style={{ width: "min(460px, 94vw)", background: "var(--color-panel-bg)", border: "1px solid var(--color-border-strong)", borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Acceso restringido al panel</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            Tu rol actual es <strong style={{ color: "var(--color-text)" }}>{role || "desconocido"}</strong>. Este panel está reservado para admin/supervisor.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <a href="/kiosk" style={{ color: "var(--color-link)", fontSize: 13 }}>Ir a kiosko</a>
            <button onClick={() => void doLogout()} style={{ ...btnStyle, padding: "6px 10px", fontSize: 11 }}>Salir</button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const inputStyle: React.CSSProperties = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "var(--color-text)",
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

const ghostBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 11,
};

