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

export type ApiEmployee = {
  id: number;
  name: string;
  employeeCode: string | null;
  isActive: boolean;
};

export type ScheduleSettings = {
  entryTime: string;
  exitTime: string;
  toleranceMinutes: number;
  lateThresholdMinutes: number;
  workingHoursPerDay: number;
};

export type LaborRulesSettings = {
  lateToleranceMinutes: number;
  lateFormalFromNthInMonth: number;
  directLateAfterTolerance: boolean;
  formalLateActaAtNth: number;
  actasForTerminationInYear: number;
  absenceJustificationDeadlineHours: number;
  absenceSuspensionDays1: number;
  absenceSuspensionDays2: number;
  absenceSuspensionDays3: number;
  absenceTerminationFromCount: number;
  repeatOffenseExtraSuspensionDays: number;
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

export type AbsencesMeta = {
  definition: string;
  weekdayDaysInRange: number;
  calendarDaysExcluded: number;
  workingDaysAfterCalendar: number;
  expectedAttendanceSlots: number;
  absenceSlots: number;
};

export async function getAbsences(params: { from: string; to: string; employee?: string }) {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.employee) q.set("employee", params.employee);
  return request<{
    absences: { employee: string; date: string }[];
    period: { from: string; to: string };
    meta: AbsencesMeta;
  }>(`/api/absences?${q.toString()}`);
}

export async function getEmployees() {
  return request<{ employees: ApiEmployee[] }>("/api/employees");
}

export async function getSettings() {
  return request<{ schedule: ScheduleSettings; laborRules: LaborRulesSettings }>("/api/settings");
}

export async function updateSettings(payload: { schedule?: ScheduleSettings; laborRules?: LaborRulesSettings }) {
  return request<{ ok: boolean; settings: { schedule: ScheduleSettings; laborRules: LaborRulesSettings } }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
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

// =============================================================================
// Módulo Vacaciones / Ausencias tipificadas (Sprint 1)
// =============================================================================

export type AbsenceType = {
  id: number;
  code: string;
  label: string;
  paid: boolean;
  countsAsWorkedDay: boolean;
  affectsLeaveBalance: boolean;
  requiresDocument: boolean;
  colorHex: string;
  displayOrder: number;
};

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

export type EmployeeAbsence = {
  id: number;
  employeeId: number;
  employeeName: string;
  absenceTypeId: number;
  typeCode: string;
  typeLabel: string;
  colorHex: string;
  startDate: string;
  endDate: string;
  businessDays: number;
  status: AbsenceStatus;
  reason: string | null;
  documentUrl: string | null;
  notes: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
};

export type TypedDayState =
  | "NOT_EXPECTED"
  | "PRESENT"
  | "JUSTIFIED_WORKED"
  | "JUSTIFIED_UNPAID"
  | "UNJUSTIFIED_ABSENCE";

export type TypedDay = {
  employeeId: number;
  employee: string;
  date: string;
  state: TypedDayState;
  absenceType?: string;
  absenceId?: number;
};

export type TypedAbsencesSummary = {
  expected: number;
  present: number;
  justifiedWorked: number;
  justifiedUnpaid: number;
  unjustified: number;
};

type ApiAbsenceTypeRow = {
  id: number | string;
  code: string;
  label: string;
  paid: number | string;
  counts_as_worked_day: number | string;
  affects_leave_balance: number | string;
  requires_document: number | string;
  color_hex: string;
  display_order: number | string;
};

type ApiEmployeeAbsenceRow = {
  id: number | string;
  employee_id: number | string;
  employee_name: string;
  absence_type_id: number | string;
  type_code: string;
  type_label: string;
  color_hex: string;
  start_date: string;
  end_date: string;
  business_days: number | string;
  status: AbsenceStatus;
  reason: string | null;
  document_url: string | null;
  notes: string | null;
  requested_at: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
};

type ApiTypedDayRow = {
  employee_id: number | string;
  employee: string;
  date: string;
  state: TypedDayState;
  absence_type?: string;
  absence_id?: number | string;
};

function toBool(value: number | string): boolean {
  return Number(value) === 1;
}

function normalizeAbsenceType(r: ApiAbsenceTypeRow): AbsenceType {
  return {
    id: Number(r.id),
    code: r.code,
    label: r.label,
    paid: toBool(r.paid),
    countsAsWorkedDay: toBool(r.counts_as_worked_day),
    affectsLeaveBalance: toBool(r.affects_leave_balance),
    requiresDocument: toBool(r.requires_document),
    colorHex: r.color_hex,
    displayOrder: Number(r.display_order),
  };
}

function normalizeEmployeeAbsence(r: ApiEmployeeAbsenceRow): EmployeeAbsence {
  return {
    id: Number(r.id),
    employeeId: Number(r.employee_id),
    employeeName: r.employee_name,
    absenceTypeId: Number(r.absence_type_id),
    typeCode: r.type_code,
    typeLabel: r.type_label,
    colorHex: r.color_hex,
    startDate: r.start_date,
    endDate: r.end_date,
    businessDays: Number(r.business_days),
    status: r.status,
    reason: r.reason,
    documentUrl: r.document_url,
    notes: r.notes,
    requestedAt: r.requested_at,
    approvedAt: r.approved_at,
    rejectedReason: r.rejected_reason,
  };
}

function normalizeTypedDay(r: ApiTypedDayRow): TypedDay {
  return {
    employeeId: Number(r.employee_id),
    employee: r.employee,
    date: r.date,
    state: r.state,
    absenceType: r.absence_type,
    absenceId: r.absence_id !== undefined ? Number(r.absence_id) : undefined,
  };
}

export async function getAbsenceTypes(): Promise<AbsenceType[]> {
  const data = await request<{ types: ApiAbsenceTypeRow[] }>("/api/absence-types");
  return (data.types ?? []).map(normalizeAbsenceType);
}

export async function listEmployeeAbsences(params: {
  from?: string;
  to?: string;
  status?: AbsenceStatus;
  employee?: string;
}): Promise<EmployeeAbsence[]> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.status) q.set("status", params.status);
  if (params.employee) q.set("employee", params.employee);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const data = await request<{ absences: ApiEmployeeAbsenceRow[] }>(`/api/employee-absences${suffix}`);
  return (data.absences ?? []).map(normalizeEmployeeAbsence);
}

export async function createEmployeeAbsence(input: {
  employeeId: number;
  absenceTypeId: number;
  startDate: string;
  endDate: string;
  reason?: string;
  documentUrl?: string;
  notes?: string;
}): Promise<{ id: number }> {
  return request<{ id: number }>("/api/employee-absences", {
    method: "POST",
    body: JSON.stringify({
      employee_id: input.employeeId,
      absence_type_id: input.absenceTypeId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
      document_url: input.documentUrl,
      notes: input.notes,
    }),
  });
}

export async function approveAbsence(id: number): Promise<{ id: number; status: AbsenceStatus }> {
  return request<{ id: number; status: AbsenceStatus }>(`/api/employee-absences/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function rejectAbsence(id: number, reason: string): Promise<{ id: number; status: AbsenceStatus }> {
  return request<{ id: number; status: AbsenceStatus }>(`/api/employee-absences/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function cancelAbsence(id: number): Promise<{ id: number; status: AbsenceStatus }> {
  return request<{ id: number; status: AbsenceStatus }>(`/api/employee-absences/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getTypedAbsences(params: {
  from: string;
  to: string;
  employee?: string;
}): Promise<{ days: TypedDay[]; summary: TypedAbsencesSummary; period: { from: string; to: string } }> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.employee && params.employee !== "all") q.set("employee", params.employee);
  const data = await request<{
    days: ApiTypedDayRow[];
    summary: TypedAbsencesSummary;
    period: { from: string; to: string };
  }>(`/api/absences-typed?${q.toString()}`);
  return {
    days: (data.days ?? []).map(normalizeTypedDay),
    summary: data.summary ?? { expected: 0, present: 0, justifiedWorked: 0, justifiedUnpaid: 0, unjustified: 0 },
    period: data.period,
  };
}

