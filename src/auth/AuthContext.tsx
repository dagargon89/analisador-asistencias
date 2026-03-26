import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { login, logout, me, refreshTokens } from "./apiAuth";
import { getAuthState, type AuthUser } from "./authStore";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  doLogin: (email: string, password: string) => Promise<void>;
  doLogout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getAuthState().user);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const current = await me();
      if (current) {
        setUser(current);
        setLoading(false);
        return;
      }
      const refreshed = await refreshTokens();
      if (refreshed) {
        const after = await me();
        setUser(after);
      } else {
        setUser(null);
      }
      setLoading(false);
    })();
  }, []);

  const doLogin = useCallback(async (email: string, password: string) => {
    const current = await login(email, password);
    setUser(current);
  }, []);

  const doLogout = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const ok = await refreshTokens();
    if (ok) {
      const current = await me();
      setUser(current);
      return true;
    }
    setUser(null);
    return false;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    isAuthenticated: !!user,
    doLogin,
    doLogout,
    refresh,
  }), [user, loading, doLogin, doLogout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

