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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
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
  return request<{ ok: boolean; importId: number; stats: { received: number; inserted: number; updated: number; duplicates: number } }>(
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

