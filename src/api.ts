import { getAuthState } from "./auth/authStore";
import { refreshTokens } from "./auth/apiAuth";

export type ApiAttendanceRecord = {
  id: number;
  employee: string;
  date: string;
  entry: string;
  exit: string;
  hoursWorked: number;
};

export type ImportPayload = {
  fileName: string;
  sourceType: "xlsx" | "csv";
  config: {
    entryTime: string;
    exitTime: string;
    toleranceMinutes: number;
    lateThresholdMinutes: number;
    workingHoursPerDay: number;
  };
  summary: {
    totalRows: number;
    invalidRows: number;
    duplicates: number;
  };
  records: ApiAttendanceRecord[];
};

type ChatHistory = { role: "user" | "model"; text: string };

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = async () => {
    const { accessToken } = getAuthState();
    const extraHeaders: Record<string, string> = {};
    if (accessToken) extraHeaders.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...extraHeaders, ...(init?.headers ?? {}) },
      ...init,
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch();
    }
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getRecords(params?: { from?: string; to?: string; employee?: string }) {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.employee) q.set("employee", params.employee);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return request<{ records: ApiAttendanceRecord[]; period: { from: string; to: string } }>(`/api/records${suffix}`);
}

export async function postImport(payload: ImportPayload) {
  return request<{
    ok: boolean;
    importId: number;
    stats: { received: number; inserted: number; updated: number; skippedExisting: number; duplicates: number };
  }>(
    "/api/import",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function postChat(payload: {
  message: string;
  history: ChatHistory[];
  filters: { from?: string; to?: string; employee?: string | null };
}) {
  return request<{ reply: string }>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function kioskAuth(payload: { employeeCode: string; pin: string }) {
  const res = await fetch(`${API_BASE}/api/kiosk/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as { accessToken: string; employee: { id: number; name: string; employeeCode: string } };
}

export async function clockIn(payload?: { employeeId?: number; deviceId?: string }) {
  return request<{ ok: boolean; result: unknown }>("/api/attendance/clock-in", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function clockOut(payload?: { employeeId?: number; deviceId?: string }) {
  return request<{ ok: boolean; result: unknown }>("/api/attendance/clock-out", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function getTodayAttendance() {
  return request<{ today: unknown | null }>("/api/attendance/me/today");
}

