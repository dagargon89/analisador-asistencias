import { clearAuthState, getAuthState, setAuthState, type AuthUser } from "./authStore";
import { API_BASE } from "../config";
import { formatHttpErrorResponse } from "../lib/httpErrorMessage";

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(formatHttpErrorResponse(res.status, txt));
  }
  const trimmed = txt.trim();
  if (!trimmed) {
    throw new Error("Respuesta vacía del servidor.");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error("El servidor devolvió datos que no son JSON válidos.");
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await rawRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.accessToken !== "string" ||
    typeof data.refreshToken !== "string" ||
    !data.user ||
    typeof data.user !== "object"
  ) {
    throw new Error(
      "La respuesta de inicio de sesión no es válida. Comprueba que VITE_API_BASE_URL apunte al backend correcto.",
    );
  }
  setAuthState({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
  });
  return data.user;
}

export async function refreshTokens(): Promise<boolean> {
  const { refreshToken, user } = getAuthState();
  if (!refreshToken || !user) return false;
  try {
    const data = await rawRequest<{ accessToken: string; refreshToken: string }>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
    setAuthState({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user,
    });
    return true;
  } catch {
    clearAuthState();
    return false;
  }
}

export async function logout(): Promise<void> {
  const { refreshToken, accessToken } = getAuthState();
  try {
    await rawRequest("/api/auth/logout", {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // ignore
  } finally {
    clearAuthState();
  }
}

export async function me(): Promise<AuthUser | null> {
  const { accessToken } = getAuthState();
  if (!accessToken) return null;
  try {
    const res = await rawRequest<{ user: AuthUser }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setAuthState({ ...getAuthState(), user: res.user });
    return res.user;
  } catch {
    return null;
  }
}

