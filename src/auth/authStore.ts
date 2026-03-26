export type AuthUser = {
  id: number;
  email: string;
  role: string;
  employeeId: number | null;
};

const ACCESS_KEY = "auth_access_token";
const REFRESH_KEY = "auth_refresh_token";
const USER_KEY = "auth_user";

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
};

function parseUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

let state: AuthState = {
  accessToken: localStorage.getItem(ACCESS_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  user: parseUser(localStorage.getItem(USER_KEY)),
};

export function getAuthState(): AuthState {
  return state;
}

export function setAuthState(next: AuthState) {
  state = next;
  if (next.accessToken) localStorage.setItem(ACCESS_KEY, next.accessToken);
  else localStorage.removeItem(ACCESS_KEY);

  if (next.refreshToken) localStorage.setItem(REFRESH_KEY, next.refreshToken);
  else localStorage.removeItem(REFRESH_KEY);

  if (next.user) localStorage.setItem(USER_KEY, JSON.stringify(next.user));
  else localStorage.removeItem(USER_KEY);
}

export function clearAuthState() {
  setAuthState({ accessToken: null, refreshToken: null, user: null });
}

