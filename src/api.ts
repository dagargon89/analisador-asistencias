import { getAuthState } from "./auth/authStore";
import { refreshTokens } from "./auth/apiAuth";
import { API_BASE } from "./config";
import { formatHttpErrorResponse } from "./lib/httpErrorMessage";

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
  position?: string | null;
  organizationId?: number | null;
  email?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
};

export type EmployeeProfile = {
  id: number;
  name: string;
  employeeCode: string | null;
  isActive: boolean;
  email: string | null;
  phone: string | null;
  position: string | null;
  birthdate: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  organizationId: number | null;
  organizationName: string | null;
  notes: string | null;
  hasCredential: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type EmployeeProfileUpdate = Partial<{
  name: string;
  employeeCode: string;
  email: string;
  phone: string;
  position: string;
  birthdate: string;
  hireDate: string;
  terminationDate: string;
  organizationId: number | null;
  isActive: boolean;
  notes: string;
}>;

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

export async function getEmployeeProfile(id: number): Promise<EmployeeProfile> {
  const data = await request<{ employee: EmployeeProfile }>(`/api/employees/${id}`);
  return data.employee;
}

export async function updateEmployeeProfile(
  id: number,
  payload: EmployeeProfileUpdate,
): Promise<EmployeeProfile> {
  const data = await request<{ employee: EmployeeProfile }>(`/api/employees/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return data.employee;
}

export async function setEmployeeCredential(
  id: number,
  payload: { employeeCode: string; pin: string },
): Promise<{ ok: boolean; employeeId: number; employeeCode: string }> {
  return request(`/api/employees/${id}/credential`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
  organizationId?: number;
}): Promise<{ days: TypedDay[]; summary: TypedAbsencesSummary; period: { from: string; to: string } }> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.employee && params.employee !== "all") q.set("employee", params.employee);
  if (params.organizationId) q.set("organization_id", String(params.organizationId));
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

// =============================================================================
// Sprint 2 — Saldos de vacaciones LFT
// =============================================================================

export type LeaveBalance = {
  id: number;
  employeeId: number;
  anniversaryYear: number;
  yearsOfService: number;
  entitledDays: number;
  usedDays: number;
  carriedOverDays: number;
  primaVacacionalDays: number;
  periodStart: string;
  periodEnd: string;
  expirationDate: string;
  availableDays: number;
};

type ApiLeaveBalance = {
  id: number | string;
  employee_id: number | string;
  anniversary_year: number | string;
  years_of_service: number | string;
  entitled_days: number | string;
  used_days: number | string;
  carried_over_days: number | string;
  prima_vacacional_days: number | string;
  period_start: string;
  period_end: string;
  expiration_date: string;
  available_days?: number | string;
};

function normalizeLeaveBalance(r: ApiLeaveBalance): LeaveBalance {
  const entitled = Number(r.entitled_days);
  const carried = Number(r.carried_over_days ?? 0);
  const used = Number(r.used_days);
  return {
    id: Number(r.id),
    employeeId: Number(r.employee_id),
    anniversaryYear: Number(r.anniversary_year),
    yearsOfService: Number(r.years_of_service),
    entitledDays: entitled,
    usedDays: used,
    carriedOverDays: carried,
    primaVacacionalDays: Number(r.prima_vacacional_days),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    expirationDate: r.expiration_date,
    availableDays: r.available_days !== undefined ? Number(r.available_days) : Math.max(0, entitled + carried - used),
  };
}

export async function getLeaveBalance(params: { employeeId: number; asOf?: string }): Promise<LeaveBalance | null> {
  const q = new URLSearchParams({ employee_id: String(params.employeeId) });
  if (params.asOf) q.set("as_of", params.asOf);
  const data = await request<{ balance: ApiLeaveBalance | null }>(`/api/leave-balances?${q.toString()}`);
  return data.balance ? normalizeLeaveBalance(data.balance) : null;
}

export async function recalcLeaveBalances(asOf?: string): Promise<{ recalculated: number }> {
  return request<{ recalculated: number }>("/api/leave-balances/recalc", {
    method: "POST",
    body: JSON.stringify(asOf ? { as_of: asOf } : {}),
  });
}

// =============================================================================
// Sprint 3 — Periodos quincenales + reporte XLSX
// =============================================================================

export type PayrollPeriodStatus = "open" | "closed";

export type PayrollPeriod = {
  id: number;
  label: string;
  startDate: string;
  endDate: string;
  expectedCalendarDays: number;
  status: PayrollPeriodStatus;
  closedAt: string | null;
};

type ApiPayrollPeriod = {
  id: number | string;
  label: string;
  start_date: string;
  end_date: string;
  expected_calendar_days: number | string;
  status: PayrollPeriodStatus;
  closed_at: string | null;
};

function normalizePayrollPeriod(r: ApiPayrollPeriod): PayrollPeriod {
  return {
    id: Number(r.id),
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    expectedCalendarDays: Number(r.expected_calendar_days),
    status: r.status,
    closedAt: r.closed_at,
  };
}

export async function getPayrollPeriods(year: number): Promise<PayrollPeriod[]> {
  const data = await request<{ periods: ApiPayrollPeriod[] }>(`/api/payroll-periods?year=${year}`);
  return (data.periods ?? []).map(normalizePayrollPeriod);
}

export async function generatePayrollPeriods(year: number): Promise<{ inserted: number; year: number }> {
  return request<{ inserted: number; year: number }>("/api/payroll-periods/generate", {
    method: "POST",
    body: JSON.stringify({ year }),
  });
}

export async function closePayrollPeriod(id: number): Promise<{ id: number; status: PayrollPeriodStatus }> {
  return request<{ id: number; status: PayrollPeriodStatus }>(`/api/payroll-periods/${id}/close`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type PayrollReportRow = {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  hireDate: string | null;
  department: string;
  daysWorked: number;
  vacationDays: number;
  leaveDays: number;
  unjustifiedAbsences: number;
  justifiedUnpaidDays: number;
  presentDays: number;
  observations: string;
};

type ApiPayrollReportRow = {
  employee_id: number | string;
  employee_name: string;
  employee_code: string;
  hire_date: string | null;
  department: string;
  days_worked: number | string;
  vacation_days: number | string;
  leave_days: number | string;
  unjustified_absences: number | string;
  justified_unpaid_days: number | string;
  present_days: number | string;
  observations: string;
};

export type PayrollReport = {
  period: PayrollPeriod;
  rows: PayrollReportRow[];
  totals: Record<string, number>;
};

export async function getPayrollReport(periodId: number): Promise<PayrollReport> {
  const data = await request<{ period: ApiPayrollPeriod; rows: ApiPayrollReportRow[]; totals: Record<string, number> }>(
    `/api/payroll-report/${periodId}`
  );
  return {
    period: normalizePayrollPeriod(data.period),
    rows: (data.rows ?? []).map((r) => ({
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      hireDate: r.hire_date,
      department: r.department,
      daysWorked: Number(r.days_worked),
      vacationDays: Number(r.vacation_days),
      leaveDays: Number(r.leave_days),
      unjustifiedAbsences: Number(r.unjustified_absences),
      justifiedUnpaidDays: Number(r.justified_unpaid_days),
      presentDays: Number(r.present_days),
      observations: r.observations,
    })),
    totals: data.totals ?? {},
  };
}

export async function downloadPayrollReportXlsx(periodId: number): Promise<Blob> {
  const doFetch = async () => {
    const { accessToken } = getAuthState();
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}/api/payroll-report/${periodId}/xlsx`, { headers });
  };
  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) res = await doFetch();
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return await res.blob();
}

// =============================================================================
// Sprint 4 — Organizaciones
// =============================================================================

export type Organization = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
};

type ApiOrganization = {
  id: number | string;
  code: string;
  name: string;
  is_active: number | string;
};

export async function getOrganizations(): Promise<Organization[]> {
  const data = await request<{ organizations: ApiOrganization[] }>("/api/organizations");
  return (data.organizations ?? []).map((o) => ({
    id: Number(o.id),
    code: o.code,
    name: o.name,
    isActive: Number(o.is_active) === 1,
  }));
}

