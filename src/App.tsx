import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import * as XLSX from "xlsx";
import { getAbsences, getEmployees, getRecords, getSettings, postChat, postImport, updateSettings } from "./api";
import { useAuth } from "./auth/AuthContext";
import { useTheme } from "./theme/ThemeContext";

// --- Types ---
type EntryStatus = "ontime" | "late" | "verylate";

type AttendanceRecord = {
  id: number;
  employee: string;
  date: string; // yyyy-mm-dd
  entry: string; // HH:mm
  exit: string; // HH:mm
  hoursWorked: number;
};

type Config = {
  entryTime: string;
  exitTime: string;
  toleranceMinutes: number;
  lateThresholdMinutes: number;
  workingHoursPerDay: number;
};

type LaborRulesConfig = {
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

type UploadSummary = {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicates: number;
  skippedExisting?: number;
  employeesDetected: number;
  uploadedAt: string;
};

type EmployeeTableFilter = "all" | "withAttendance" | "withAbsences" | "withIncidents";
type LateAccumulationFilter = "all" | "withFormalization" | "withActa" | "withEquivalentAbsence";

// --- XLSX Parsing Utilities ---
const FIELD_ALIASES = {
  employee: ["employee", "empleado", "employee name", "nombre", "trabajador"],
  checkIn: ["check in", "checkin", "check_in", "entrada", "fecha entrada", "hora entrada"],
  checkOut: ["check out", "checkout", "check_out", "salida", "fecha salida", "hora salida"],
  workedHours: ["worked hours", "hours worked", "horas trabajadas", "duracion", "duration"],
};

function normalizeKey(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHourMinute(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const d = new Date(
      parsed.y,
      (parsed.m ?? 1) - 1,
      parsed.d ?? 1,
      parsed.H ?? 0,
      parsed.M ?? 0,
      Math.floor(parsed.S ?? 0)
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const txt = value.trim();
    if (!txt) return null;
    const direct = new Date(txt.replace(" ", "T"));
    if (!Number.isNaN(direct.getTime())) return direct;
    // dd/mm/yyyy HH:mm
    const m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) {
      const d2 = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
      if (!Number.isNaN(d2.getTime())) return d2;
    }
  }
  return null;
}

function getField(row: Record<string, unknown>, candidates: string[]): unknown {
  const aliasSet = new Set(candidates.map(normalizeKey));
  for (const [k, v] of Object.entries(row)) {
    if (aliasSet.has(normalizeKey(k))) return v;
  }
  return undefined;
}

async function parseXlsx(
  file: File
): Promise<{ records: AttendanceRecord[]; summary: UploadSummary }> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene hojas.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    defval: "",
    raw: true,
    blankrows: false,
  });

  const records: AttendanceRecord[] = [];
  const dedup = new Set<string>();
  let invalidRows = 0;
  let duplicates = 0;

  for (const row of rows) {
    const empRaw = getField(row, FIELD_ALIASES.employee);
    const inRaw = getField(row, FIELD_ALIASES.checkIn);
    const outRaw = getField(row, FIELD_ALIASES.checkOut);
    const hrsRaw = getField(row, FIELD_ALIASES.workedHours);

    const employee = typeof empRaw === "string" ? empRaw.trim() : "";
    const checkIn = parseDateLike(inRaw);
    const checkOut = parseDateLike(outRaw);

    if (!employee || !checkIn) {
      invalidRows += 1;
      continue;
    }

    const date = toIsoDate(checkIn);
    const entry = toHourMinute(checkIn);
    const exit = checkOut ? toHourMinute(checkOut) : "";

    const workedNum =
      typeof hrsRaw === "number" ? hrsRaw : Number(String(hrsRaw).replace(",", "."));
    const computed = checkOut ? (checkOut.getTime() - checkIn.getTime()) / 3600000 : 0;
    const hoursWorked = Math.max(0, Number((Number.isFinite(workedNum) ? workedNum : computed).toFixed(2)));

    const dedupKey = `${employee}|${date}|${entry}`;
    if (dedup.has(dedupKey)) {
      duplicates += 1;
      continue;
    }
    dedup.add(dedupKey);

    records.push({ id: records.length + 1, employee, date, entry, exit, hoursWorked });
  }

  return {
    records,
    summary: {
      fileName: file.name,
      totalRows: rows.length,
      validRows: records.length,
      invalidRows,
      duplicates,
      employeesDetected: new Set(records.map((r) => r.employee)).size,
      uploadedAt: new Date().toLocaleString("es-MX"),
    },
  };
}

// --- Icons (inline SVGs) ---
const Icons = {
  Upload: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  Calendar: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  Users: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Chart: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  Download: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  X: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Alert: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Database: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  Filter: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
    </svg>
  ),
  UserX: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
      <line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>
    </svg>
  ),
};

// --- Utility Functions ---
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function getWorkingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (current <= end) {
    const dow = current.getDay();
    if (dow >= 1 && dow <= 5) days.push(toIsoDate(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function classifyEntry(entryTime: string, config: Config): EntryStatus {
  const mins = timeToMinutes(entryTime);
  const scheduledMins = timeToMinutes(config.entryTime);
  const diff = mins - scheduledMins;
  if (diff <= config.toleranceMinutes) return "ontime";
  if (diff <= config.lateThresholdMinutes) return "late";
  return "verylate";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// --- Chat Types ---
type ChatRole = "user" | "model";
type ChatMessage = { role: ChatRole; text: string };

// --- Attendance JSON Type ---
type AttendanceDataJson = {
  generado: string;
  archivo: string;
  configuracion: {
    horaEntrada: string;
    horaSalida: string;
    toleranciaMinutos: number;
    umbralRetardoMayor: number;
    jornadaHoras: number;
  };
  resumen: {
    totalRegistros: number;
    totalEmpleados: number;
    periodoDesde: string;
    periodoHasta: string;
    meses: string[];
    aTiempoTotal: number;
    retardosTotal: number;
    retardosMayoresTotal: number;
    horasTotales: number;
    horasPromedioRegistro: number;
    inasistenciasTotal: number;
  };
  porEmpleado: {
    nombre: string;
    dias: number;
    aTiempo: number;
    retardos: number;
    retardosMayores: number;
    horasTotal: number;
    horasPromedio: number;
    puntualidadPct: number;
    inasistencias: number;
  }[];
  registros: {
    empleado: string;
    fecha: string;
    entrada: string;
    salida: string;
    horas: number;
    estado: "aTiempo" | "retardo" | "retardoMayor";
  }[];
  inasistencias: {
    empleado: string;
    fecha: string;
  }[];
};

// --- Attendance JSON Builder ---
function buildAttendanceJson(
  records: AttendanceRecord[],
  config: Config,
  fileName: string,
  serverAbsences?: { employee: string; date: string }[] | null
): AttendanceDataJson {
  const classifyMins = (entry: string): "aTiempo" | "retardo" | "retardoMayor" => {
    const mins = entry.split(":").map(Number).reduce((h, m) => h * 60 + m, 0);
    const scheduled = config.entryTime.split(":").map(Number).reduce((h, m) => h * 60 + m, 0);
    const diff = mins - scheduled;
    if (diff <= config.toleranceMinutes) return "aTiempo";
    if (diff <= config.lateThresholdMinutes) return "retardo";
    return "retardoMayor";
  };

  const empMap: Record<string, AttendanceDataJson["porEmpleado"][0]> = {};
  const classifiedRecords: AttendanceDataJson["registros"] = [];

  for (const r of records) {
    const estado = classifyMins(r.entry);
    classifiedRecords.push({
      empleado: r.employee,
      fecha: r.date,
      entrada: r.entry,
      salida: r.exit || "",
      horas: r.hoursWorked,
      estado,
    });
    if (!empMap[r.employee]) {
      empMap[r.employee] = { nombre: r.employee, dias: 0, aTiempo: 0, retardos: 0, retardosMayores: 0, horasTotal: 0, horasPromedio: 0, puntualidadPct: 0, inasistencias: 0 };
    }
    empMap[r.employee].dias++;
    empMap[r.employee].horasTotal = Number((empMap[r.employee].horasTotal + r.hoursWorked).toFixed(2));
    if (estado === "aTiempo") empMap[r.employee].aTiempo++;
    else if (estado === "retardo") empMap[r.employee].retardos++;
    else empMap[r.employee].retardosMayores++;
  }

  const dates = [...new Set(records.map((r) => r.date))].sort();
  const meses = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort();

  const allEmployees = Object.keys(empMap);
  const presentSet = new Set(records.map((r) => `${r.employee}|${r.date}`));
  const inasistencias: AttendanceDataJson["inasistencias"] = [];
  const absenceByEmp: Record<string, number> = {};

  if (dates.length > 0) {
    if (serverAbsences != null) {
      const fromD = dates[0];
      const toD = dates[dates.length - 1];
      const empSet = new Set(allEmployees);
      for (const row of serverAbsences) {
        if (!empSet.has(row.employee)) continue;
        if (row.date < fromD || row.date > toD) continue;
        inasistencias.push({ empleado: row.employee, fecha: row.date });
        absenceByEmp[row.employee] = (absenceByEmp[row.employee] || 0) + 1;
      }
    } else {
      const workingDays = getWorkingDays(dates[0], dates[dates.length - 1]);
      for (const emp of allEmployees) {
        for (const day of workingDays) {
          if (!presentSet.has(`${emp}|${day}`)) {
            inasistencias.push({ empleado: emp, fecha: day });
            absenceByEmp[emp] = (absenceByEmp[emp] || 0) + 1;
          }
        }
      }
    }
  }

  const porEmpleado = Object.values(empMap).map((e) => ({
    ...e,
    horasTotal: Number(e.horasTotal.toFixed(1)),
    horasPromedio: Number((e.horasTotal / Math.max(e.dias, 1)).toFixed(2)),
    puntualidadPct: Math.round((e.aTiempo / Math.max(e.dias, 1)) * 100),
    inasistencias: absenceByEmp[e.nombre] ?? 0,
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const totalHoras = Number(porEmpleado.reduce((s, e) => s + e.horasTotal, 0).toFixed(1));

  return {
    generado: new Date().toISOString().slice(0, 10),
    archivo: fileName,
    configuracion: {
      horaEntrada: config.entryTime,
      horaSalida: config.exitTime,
      toleranciaMinutos: config.toleranceMinutes,
      umbralRetardoMayor: config.lateThresholdMinutes,
      jornadaHoras: config.workingHoursPerDay,
    },
    resumen: {
      totalRegistros: records.length,
      totalEmpleados: porEmpleado.length,
      periodoDesde: dates[0] ?? "",
      periodoHasta: dates[dates.length - 1] ?? "",
      meses,
      aTiempoTotal: porEmpleado.reduce((s, e) => s + e.aTiempo, 0),
      retardosTotal: porEmpleado.reduce((s, e) => s + e.retardos, 0),
      retardosMayoresTotal: porEmpleado.reduce((s, e) => s + e.retardosMayores, 0),
      horasTotales: totalHoras,
      horasPromedioRegistro: Number((totalHoras / Math.max(records.length, 1)).toFixed(2)),
      inasistenciasTotal: inasistencias.length,
    },
    porEmpleado,
    registros: classifiedRecords,
    inasistencias: inasistencias.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.empleado.localeCompare(b.empleado)),
  };
}

// --- Markdown renderer (inline, no dependencies) ---
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // H3
    if (line.startsWith("### ")) {
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 13, color: "var(--color-text)", marginTop: 10, marginBottom: 2 }}>
          {inlineMarkdown(line.slice(4))}
        </div>
      );
      i++;
      continue;
    }
    // H2
    if (line.startsWith("## ")) {
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)", marginTop: 12, marginBottom: 4, borderBottom: "1px solid var(--color-border)", paddingBottom: 4 }}>
          {inlineMarkdown(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }
    // H1
    if (line.startsWith("# ")) {
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text)", marginTop: 12, marginBottom: 6 }}>
          {inlineMarkdown(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }
    // Bullet list (- or *)
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: 18, margin: "6px 0", display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 13, color: "var(--color-text-soft)", lineHeight: 1.5 }}>
              {inlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }
    // Numbered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: "6px 0", display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 13, color: "var(--color-text-soft)", lineHeight: 1.5 }}>
              {inlineMarkdown(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />);
      i++;
      continue;
    }
    // Empty line → spacing
    if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 6 }} />);
      i++;
      continue;
    }
    // Normal paragraph
    elements.push(
      <div key={i} style={{ fontSize: 13, color: "var(--color-text-soft)", lineHeight: 1.65 }}>
        {inlineMarkdown(line)}
      </div>
    );
    i++;
  }

  return <>{elements}</>;
}

function inlineMarkdown(text: string): React.ReactNode {
  // Split by bold (**), italic (*), and inline code (`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ color: "var(--color-text)", fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i} style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} style={{
          background: "var(--color-markdown-code-bg)", color: "var(--color-link)",
          padding: "1px 6px", borderRadius: 4,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        }}>{part.slice(1, -1)}</code>
      );
    }
    return part;
  });
}

type PaginationControlsProps = {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
};

function PaginationControls({ page, totalItems, pageSize, onPageChange, itemLabel }: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
        {totalItems === 0 ? `Sin ${itemLabel}` : `Mostrando ${start}-${end} de ${totalItems} ${itemLabel}`}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn-ghost" onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>
          Anterior
        </button>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", minWidth: 72, textAlign: "center" }}>
          Página {safePage}/{totalPages}
        </span>
        <button className="btn-ghost" onClick={() => onPageChange(safePage + 1)} disabled={safePage >= totalPages}>
          Siguiente
        </button>
      </div>
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const triggerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = 240;
    const gap = 8;
    const margin = 8;
    const canOpenRight = rect.right + gap + tooltipWidth <= window.innerWidth - margin;
    setSide(canOpenRight ? "right" : "left");
  }, [open]);

  return (
    <span
      ref={triggerRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", zIndex: 40 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Ver explicación del cálculo"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "1px solid rgba(99,132,255,0.35)",
          background: "rgba(99,132,255,0.12)",
          color: "#818cf8",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "help",
          padding: 0,
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "50%",
            left: side === "right" ? "calc(100% + 8px)" : undefined,
            right: side === "left" ? "calc(100% + 8px)" : undefined,
            transform: "translateY(-50%)",
            width: 240,
            background: "var(--color-tooltip-bg)",
            color: "var(--color-tooltip-fg)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11,
            lineHeight: 1.45,
            zIndex: 9999,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            pointerEvents: "auto",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// --- Main App Component ---
export default function AttendancePlatform() {
  const { user, loading: authLoading, isAuthenticated, doLogout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [activeEmployees, setActiveEmployees] = useState<Array<{ id: number; name: string; isActive: boolean }>>([]);
  const [reportPeriod, setReportPeriod] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedEmployee, setSelectedEmployee] = useState("all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeTableFilter, setEmployeeTableFilter] = useState<EmployeeTableFilter>("withAttendance");
  const [lateAccumSearch, setLateAccumSearch] = useState("");
  const [lateAccumFilter, setLateAccumFilter] = useState<LateAccumulationFilter>("all");
  const [dashboardEmployeesPage, setDashboardEmployeesPage] = useState(1);
  const [dailyPage, setDailyPage] = useState(1);
  const [employeesPage, setEmployeesPage] = useState(1);
  const [incidentsPage, setIncidentsPage] = useState(1);
  const [absencesPage, setAbsencesPage] = useState(1);
  const [lateAccumPage, setLateAccumPage] = useState(1);
  const [config, setConfig] = useState<Config>({
    entryTime: "08:30",
    exitTime: "17:30",
    toleranceMinutes: 10,
    lateThresholdMinutes: 30,
    workingHoursPerDay: 8.5,
  });
  const [laborRules, setLaborRules] = useState<LaborRulesConfig>({
    lateToleranceMinutes: 15,
    lateFormalFromNthInMonth: 4,
    directLateAfterTolerance: true,
    formalLateActaAtNth: 5,
    actasForTerminationInYear: 3,
    absenceJustificationDeadlineHours: 48,
    absenceSuspensionDays1: 1,
    absenceSuspensionDays2: 2,
    absenceSuspensionDays3: 3,
    absenceTerminationFromCount: 4,
    repeatOffenseExtraSuspensionDays: 1,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const [lastSourceFile, setLastSourceFile] = useState("historial_db");

  const [periodAbsenceCache, setPeriodAbsenceCache] = useState<{
    from: string;
    to: string;
    employeeKey: string;
    absences: { employee: string; date: string }[];
  } | null>(null);

  const [jsonAbsenceCache, setJsonAbsenceCache] = useState<{
    from: string;
    to: string;
    absences: { employee: string; date: string }[];
  } | null>(null);

  // --- Chat state ---
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const userInitials = useMemo(() => {
    const localPart = (user?.email ?? "").split("@")[0]?.trim();
    if (!localPart) return "US";
    return localPart.slice(0, 2).toUpperCase();
  }, [user?.email]);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const widgetHelp = useMemo(
    () => ({
      onTime: "Conteo de registros cuya hora de entrada cae dentro de la tolerancia configurada. Porcentaje = A Tiempo / total de registros del periodo.",
      late: "Conteo de registros con entrada después de la tolerancia y antes o igual al umbral de retardo mayor.",
      veryLate: "Conteo de registros con entrada posterior al umbral de retardo mayor configurado.",
      avgHours: "Promedio simple de horas trabajadas por registro del periodo: horas totales / número de registros.",
      absences:
        "Con sesión iniciada se usa el motor del servidor (lun–vie, calendario de inhábiles, fechas de contrato si existen). Sin sesión: cálculo local por días hábiles sin registro. Tasa: inasistencias / (empleados activos base × días hábiles).",
      weekday: "Distribución de registros por día de semana (lunes a viernes) dentro del periodo y filtros activos.",
      incidents: "Composición de incidencias por registro (a tiempo, retardo, retardo mayor). El valor central cambia según el filtro diario/mensual/semanal.",
      employeeSummary: "Resumen agregado por empleado en el periodo: días con registro, incidencias, horas y puntualidad.",
    }),
    []
  );

  const PAGE_SIZE_DASHBOARD_EMPLOYEES = 15;
  const PAGE_SIZE_DAILY = 50;
  const PAGE_SIZE_EMPLOYEES = 12;
  const PAGE_SIZE_INCIDENTS = 50;
  const PAGE_SIZE_ABSENCES = 100;
  const PAGE_SIZE_LATE_ACCUMULATION = 15;

  const recordEmployees = useMemo(
    () => [...new Set(records.map((r) => r.employee))].sort((a, b) => a.localeCompare(b)),
    [records]
  );
  const employees = useMemo(() => {
    const activeNames = [...new Set(activeEmployees.filter((e) => e.isActive).map((e) => e.name.trim()).filter(Boolean))];
    if (activeNames.length > 0) {
      return activeNames.sort((a, b) => a.localeCompare(b));
    }
    return recordEmployees;
  }, [activeEmployees, recordEmployees]);

  const monthOptions = useMemo(() => {
    const unique = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort();
    return unique.map((value) => {
      const [year, month] = value.split("-").map(Number);
      const label = new Date(year, month - 1, 1).toLocaleDateString("es-MX", {
        month: "short",
        year: "numeric",
      });
      return { value, label };
    });
  }, [records]);

  const latestDate = useMemo(
    () => records.map((r) => r.date).sort().at(-1) ?? null,
    [records]
  );

  const dayOptions = useMemo(() => {
    if (!selectedMonth) return [];
    const unique = [
      ...new Set(records.filter((r) => r.date.startsWith(selectedMonth)).map((r) => r.date)),
    ].sort();
    return unique.map((value) => {
      const d = new Date(value + "T00:00:00");
      const label = d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
      return { value, label };
    });
  }, [records, selectedMonth]);

  const weekOptions = useMemo(() => {
    if (!selectedMonth) return [];
    const [year, month] = selectedMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const dayOfWeek = firstDay.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekCursor = new Date(firstDay);
    weekCursor.setDate(weekCursor.getDate() - daysToMonday);
    const weeks: { label: string; startDate: string; endDate: string }[] = [];
    while (weekCursor <= lastDay) {
      const start = new Date(weekCursor);
      const end = new Date(weekCursor);
      end.setDate(end.getDate() + 6);
      const startDate = toIsoDate(start);
      const endDate = toIsoDate(end);
      const startDay = start.getDate();
      const endDay = end.getDate();
      const startMonthStr = start.toLocaleDateString("es-MX", { month: "short" });
      const endMonthStr = end.toLocaleDateString("es-MX", { month: "short" });
      const label =
        start.getMonth() === end.getMonth()
          ? `${startDay}–${endDay} ${endMonthStr}`
          : `${startDay} ${startMonthStr} – ${endDay} ${endMonthStr}`;
      weeks.push({ label, startDate, endDate });
      weekCursor.setDate(weekCursor.getDate() + 7);
    }
    return weeks;
  }, [selectedMonth]);

  const attendanceJson = useMemo(() => {
    if (records.length === 0) return null;
    const sortedDates = [...new Set(records.map((r) => r.date))].sort();
    const from = sortedDates[0];
    const to = sortedDates[sortedDates.length - 1];
    const serverAbsences =
      jsonAbsenceCache && jsonAbsenceCache.from === from && jsonAbsenceCache.to === to
        ? jsonAbsenceCache.absences
        : null;
    return buildAttendanceJson(records, config, lastSourceFile, serverAbsences);
  }, [records, config, lastSourceFile, jsonAbsenceCache]);

  // Auto-select most recent month when months change
  useEffect(() => {
    if (monthOptions.length === 0) return;
    if (!monthOptions.some((m) => m.value === selectedMonth)) {
      setSelectedMonth(monthOptions[monthOptions.length - 1].value);
    }
  }, [monthOptions, selectedMonth]);

  // Auto-select first available day/week when month or period changes
  useEffect(() => {
    if (reportPeriod === "day" && dayOptions.length > 0) {
      if (!dayOptions.some((d) => d.value === selectedDay)) {
        setSelectedDay(dayOptions[dayOptions.length - 1].value);
      }
    }
  }, [reportPeriod, dayOptions, selectedDay]);

  useEffect(() => {
    if (reportPeriod === "week" && weekOptions.length > 0) {
      setSelectedWeek((prev) => (prev >= weekOptions.length ? 0 : prev));
    }
  }, [reportPeriod, weekOptions]);

  useEffect(() => {
    setDailyPage(1);
    setIncidentsPage(1);
    setAbsencesPage(1);
  }, [records, reportPeriod, selectedMonth, selectedWeek, selectedDay, selectedEmployee]);

  useEffect(() => {
    setDashboardEmployeesPage(1);
    setEmployeesPage(1);
  }, [employeeSearch, employeeTableFilter, records, reportPeriod, selectedMonth, selectedWeek, selectedDay, selectedEmployee]);

  useEffect(() => {
    setLateAccumPage(1);
  }, [lateAccumSearch, lateAccumFilter, records, reportPeriod, selectedMonth, selectedWeek, selectedDay, selectedEmployee, laborRules, config]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (showSettings) {
      setSettingsError(null);
    }
  }, [showSettings]);

  const loadPersistedRecords = useCallback(async () => {
    const { records: persisted } = await getRecords();
    setRecords(persisted);
    if (persisted.length > 0) {
      setLastSourceFile("historial_db");
    }
  }, []);

  const loadActiveEmployees = useCallback(async () => {
    const { employees: roster } = await getEmployees();
    setActiveEmployees(
      roster.map((e) => ({
        id: e.id,
        name: e.name,
        isActive: e.isActive,
      }))
    );
  }, []);

  const loadSettings = useCallback(async () => {
    const { schedule, laborRules: rules } = await getSettings();
    setConfig({
      entryTime: schedule.entryTime,
      exitTime: schedule.exitTime,
      toleranceMinutes: schedule.toleranceMinutes,
      lateThresholdMinutes: schedule.lateThresholdMinutes,
      workingHoursPerDay: schedule.workingHoursPerDay,
    });
    setLaborRules({
      lateToleranceMinutes: schedule.toleranceMinutes,
      lateFormalFromNthInMonth: rules.lateFormalFromNthInMonth,
      directLateAfterTolerance: rules.directLateAfterTolerance,
      formalLateActaAtNth: rules.formalLateActaAtNth,
      actasForTerminationInYear: rules.actasForTerminationInYear,
      absenceJustificationDeadlineHours: rules.absenceJustificationDeadlineHours,
      absenceSuspensionDays1: rules.absenceSuspensionDays1,
      absenceSuspensionDays2: rules.absenceSuspensionDays2,
      absenceSuspensionDays3: rules.absenceSuspensionDays3,
      absenceTerminationFromCount: rules.absenceTerminationFromCount,
      repeatOffenseExtraSuspensionDays: rules.repeatOffenseExtraSuspensionDays,
    });
  }, []);

  useEffect(() => {
    void loadPersistedRecords().catch(() => {
      // Keep empty state when API is not available.
    });
  }, [loadPersistedRecords]);

  useEffect(() => {
    void loadActiveEmployees().catch(() => {
      // Keep fallback to record-derived employees when roster endpoint is unavailable.
    });
  }, [loadActiveEmployees]);

  useEffect(() => {
    void loadSettings().catch(() => {
      // Keep local defaults when settings endpoint is unavailable.
    });
  }, [loadSettings]);

  const rawPeriodRange = useMemo((): { start: string; end: string } | null => {
    if (reportPeriod === "month" && selectedMonth) {
      const [year, month] = selectedMonth.split("-").map(Number);
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      return { start: toIsoDate(firstDay), end: toIsoDate(lastDay) };
    }
    if (reportPeriod === "week" && weekOptions[selectedWeek]) {
      return { start: weekOptions[selectedWeek].startDate, end: weekOptions[selectedWeek].endDate };
    }
    if (reportPeriod === "day" && selectedDay) {
      return { start: selectedDay, end: selectedDay };
    }
    return null;
  }, [reportPeriod, selectedMonth, selectedWeek, weekOptions, selectedDay]);

  const periodDateRange = useMemo((): { start: string; end: string } | null => {
    if (!rawPeriodRange) return null;
    const cappedEnd = rawPeriodRange.end > todayIso ? todayIso : rawPeriodRange.end;
    if (rawPeriodRange.start > cappedEnd) return null;
    return { start: rawPeriodRange.start, end: cappedEnd };
  }, [rawPeriodRange, todayIso]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !periodDateRange) {
      setPeriodAbsenceCache(null);
      return;
    }
    const employeeKey = selectedEmployee === "all" ? "all" : selectedEmployee;
    let cancelled = false;
    const { start, end } = periodDateRange;
    const req =
      selectedEmployee === "all"
        ? getAbsences({ from: start, to: end })
        : getAbsences({ from: start, to: end, employee: selectedEmployee });
    void req
      .then((res) => {
        if (cancelled) return;
        setPeriodAbsenceCache({ from: start, to: end, employeeKey, absences: res.absences });
      })
      .catch(() => {
        if (!cancelled) setPeriodAbsenceCache(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, periodDateRange, selectedEmployee]);

  useEffect(() => {
    if (!isAuthenticated || records.length === 0) {
      setJsonAbsenceCache(null);
      return;
    }
    const sortedDates = [...new Set(records.map((r) => r.date))].sort();
    const from = sortedDates[0];
    const to = sortedDates[sortedDates.length - 1];
    if (!from || !to) {
      setJsonAbsenceCache(null);
      return;
    }
    let cancelled = false;
    void getAbsences({ from, to })
      .then((res) => {
        if (cancelled) return;
        setJsonAbsenceCache({ from, to, absences: res.absences });
      })
      .catch(() => {
        if (!cancelled) setJsonAbsenceCache(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, records]);

  const filteredData = useMemo(() => {
    if (!periodDateRange) return [];
    let data = records.filter((r) => r.date >= periodDateRange.start && r.date <= periodDateRange.end);
    if (selectedEmployee !== "all") {
      data = data.filter((r) => r.employee === selectedEmployee);
    }
    return data;
  }, [records, selectedEmployee, periodDateRange]);

  const lateAccumulationRange = useMemo((): { start: string; end: string } | null => {
    if (!selectedMonth) return null;
    const [year, month] = selectedMonth.split("-").map(Number);
    const monthStart = toIsoDate(new Date(year, month - 1, 1));
    const monthEnd = toIsoDate(new Date(year, month, 0));
    const cappedEnd = monthEnd > todayIso ? todayIso : monthEnd;
    if (monthStart > cappedEnd) return null;
    return { start: monthStart, end: cappedEnd };
  }, [selectedMonth, todayIso]);

  const lateAccumulationSourceData = useMemo(() => {
    if (!lateAccumulationRange) return [];
    let data = records.filter((r) => r.date >= lateAccumulationRange.start && r.date <= lateAccumulationRange.end);
    if (selectedEmployee !== "all") {
      data = data.filter((r) => r.employee === selectedEmployee);
    }
    return data;
  }, [records, selectedEmployee, lateAccumulationRange]);

  const absenceBaseEmployees = useMemo(() => {
    if (selectedEmployee !== "all") {
      return employees.includes(selectedEmployee) ? [selectedEmployee] : [];
    }
    return employees;
  }, [employees, selectedEmployee]);

  const workingDaysInRange = useMemo(() => {
    if (!periodDateRange) return [];
    return getWorkingDays(periodDateRange.start, periodDateRange.end);
  }, [periodDateRange]);

  const absenceData = useMemo(() => {
    if (!periodDateRange || absenceBaseEmployees.length === 0) return [];

    const employeeKey = selectedEmployee === "all" ? "all" : selectedEmployee;
    if (
      periodAbsenceCache &&
      periodAbsenceCache.from === periodDateRange.start &&
      periodAbsenceCache.to === periodDateRange.end &&
      periodAbsenceCache.employeeKey === employeeKey
    ) {
      return periodAbsenceCache.absences
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee));
    }

    if (records.length === 0) return [];

    const presentSet = new Set(records.map((r) => `${r.employee}|${r.date}`));
    const absences: { employee: string; date: string }[] = [];
    for (const emp of absenceBaseEmployees) {
      for (const day of workingDaysInRange) {
        if (!presentSet.has(`${emp}|${day}`)) {
          absences.push({ employee: emp, date: day });
        }
      }
    }
    return absences.sort((a, b) => a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee));
  }, [records, periodDateRange, absenceBaseEmployees, workingDaysInRange, periodAbsenceCache, selectedEmployee]);

  const stats = useMemo(() => {
    let onTime = 0, late = 0, veryLate = 0;
    filteredData.forEach((r) => {
      const status = classifyEntry(r.entry, config);
      if (status === "ontime") onTime++;
      else if (status === "late") late++;
      else veryLate++;
    });
    const uniqueEmployees = new Set(filteredData.map((r) => r.employee)).size;
    const totalHours = filteredData.reduce((sum, r) => sum + r.hoursWorked, 0);
    const avgHours = filteredData.length > 0 ? totalHours / filteredData.length : 0;
    const absenceDenominator = Math.max(absenceBaseEmployees.length * workingDaysInRange.length, 0);
    const absenceRatePct = absenceDenominator > 0 ? (absenceData.length / absenceDenominator) * 100 : 0;
    return {
      onTime,
      late,
      veryLate,
      totalRecords: filteredData.length,
      uniqueEmployees,
      totalHours,
      avgHours,
      absences: absenceData.length,
      absenceRatePct,
      absenceBaseEmployees: absenceBaseEmployees.length,
      workingDays: workingDaysInRange.length,
    };
  }, [filteredData, config, absenceData, absenceBaseEmployees, workingDaysInRange]);

  const employeeReport = useMemo(() => {
    const map: Record<string, { name: string; onTime: number; late: number; veryLate: number; totalHours: number; days: number; absences: number }> = {};
    filteredData.forEach((r) => {
      if (!map[r.employee]) {
        map[r.employee] = { name: r.employee, onTime: 0, late: 0, veryLate: 0, totalHours: 0, days: 0, absences: 0 };
      }
      const status = classifyEntry(r.entry, config);
      if (status === "ontime") map[r.employee].onTime++;
      else if (status === "late") map[r.employee].late++;
      else map[r.employee].veryLate++;
      map[r.employee].totalHours += r.hoursWorked;
      map[r.employee].days++;
    });
    const absenceByEmp: Record<string, number> = {};
    absenceData.forEach((a) => {
      absenceByEmp[a.employee] = (absenceByEmp[a.employee] || 0) + 1;
    });
    // Include employees that may only have absences (no attendance in period)
    const empList = absenceBaseEmployees;
    for (const emp of empList) {
      if (!map[emp] && absenceByEmp[emp]) {
        map[emp] = { name: emp, onTime: 0, late: 0, veryLate: 0, totalHours: 0, days: 0, absences: 0 };
      }
      if (map[emp]) map[emp].absences = absenceByEmp[emp] ?? 0;
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredData, config, absenceData, absenceBaseEmployees]);

  const filteredEmployeeReport = useMemo(() => {
    const searchKey = normalizeKey(employeeSearch);
    return employeeReport.filter((emp) => {
      if (searchKey && !normalizeKey(emp.name).includes(searchKey)) {
        return false;
      }
      if (employeeTableFilter === "withAttendance" && emp.days === 0) {
        return false;
      }
      if (employeeTableFilter === "withAbsences" && emp.absences === 0) {
        return false;
      }
      if (employeeTableFilter === "withIncidents" && emp.late + emp.veryLate === 0) {
        return false;
      }
      return true;
    });
  }, [employeeReport, employeeSearch, employeeTableFilter]);

  const incidentsData = useMemo(
    () =>
      filteredData
        .filter((r) => classifyEntry(r.entry, config) !== "ontime")
        .sort((a, b) => {
          const aDiff = timeToMinutes(a.entry) - timeToMinutes(config.entryTime);
          const bDiff = timeToMinutes(b.entry) - timeToMinutes(config.entryTime);
          return bDiff - aDiff;
        }),
    [filteredData, config]
  );

  const lateAccumulationReport = useMemo(() => {
    const baseEmployees =
      selectedEmployee === "all"
        ? employees
        : employees.includes(selectedEmployee)
          ? [selectedEmployee]
          : [];
    const map: Record<string, { name: string; late: number; veryLate: number }> = {};

    baseEmployees.forEach((name) => {
      map[name] = { name, late: 0, veryLate: 0 };
    });

    lateAccumulationSourceData.forEach((record) => {
      if (!map[record.employee]) {
        map[record.employee] = { name: record.employee, late: 0, veryLate: 0 };
      }
      const status = classifyEntry(record.entry, config);
      if (status === "late") {
        map[record.employee].late += 1;
      } else if (status === "verylate") {
        map[record.employee].veryLate += 1;
      }
    });

    const formalFrom = Math.max(1, laborRules.lateFormalFromNthInMonth);
    const actaAt = Math.max(1, laborRules.formalLateActaAtNth);
    const terminationActas = Math.max(1, laborRules.actasForTerminationInYear);

    return Object.values(map)
      .map((row) => {
        const totalComputable = laborRules.directLateAfterTolerance
          ? row.late + row.veryLate
          : row.veryLate;
        const formalized = totalComputable >= formalFrom;
        const actas = Math.floor(totalComputable / actaAt);
        const equivalentAbsences = actas;
        const progressInCurrentBlock = totalComputable % actaAt;
        const progressPct = Math.round((progressInCurrentBlock / actaAt) * 100);
        const nextActaIn = progressInCurrentBlock === 0 ? actaAt : actaAt - progressInCurrentBlock;

        let sanctionLabel = "Sin sancion";
        if (equivalentAbsences > 0) {
          sanctionLabel = `${equivalentAbsences} falta(s) equivalente(s) + ${actas} acta(s)`;
        } else if (formalized) {
          sanctionLabel = "Retardo formal (sin falta equivalente aun)";
        }
        if (actas >= terminationActas) {
          sanctionLabel += " • Riesgo por acumulacion anual";
        }

        return {
          ...row,
          totalComputable,
          formalized,
          actas,
          equivalentAbsences,
          progressPct,
          nextActaIn,
          sanctionLabel,
        };
      })
      .sort((a, b) => {
        if (b.equivalentAbsences !== a.equivalentAbsences) return b.equivalentAbsences - a.equivalentAbsences;
        if (b.actas !== a.actas) return b.actas - a.actas;
        if (b.totalComputable !== a.totalComputable) return b.totalComputable - a.totalComputable;
        return a.name.localeCompare(b.name);
      });
  }, [employees, selectedEmployee, lateAccumulationSourceData, config, laborRules]);

  const filteredLateAccumulationReport = useMemo(() => {
    const searchKey = normalizeKey(lateAccumSearch);
    return lateAccumulationReport.filter((row) => {
      if (searchKey && !normalizeKey(row.name).includes(searchKey)) {
        return false;
      }
      if (lateAccumFilter === "withFormalization" && !row.formalized) {
        return false;
      }
      if (lateAccumFilter === "withActa" && row.actas === 0) {
        return false;
      }
      if (lateAccumFilter === "withEquivalentAbsence" && row.equivalentAbsences === 0) {
        return false;
      }
      return true;
    });
  }, [lateAccumSearch, lateAccumFilter, lateAccumulationReport]);

  const paginatedDashboardEmployees = useMemo(() => {
    const start = (dashboardEmployeesPage - 1) * PAGE_SIZE_DASHBOARD_EMPLOYEES;
    return filteredEmployeeReport.slice(start, start + PAGE_SIZE_DASHBOARD_EMPLOYEES);
  }, [filteredEmployeeReport, dashboardEmployeesPage]);

  const paginatedDailyData = useMemo(() => {
    const start = (dailyPage - 1) * PAGE_SIZE_DAILY;
    return filteredData.slice(start, start + PAGE_SIZE_DAILY);
  }, [filteredData, dailyPage]);

  const paginatedEmployeesCards = useMemo(() => {
    const start = (employeesPage - 1) * PAGE_SIZE_EMPLOYEES;
    return filteredEmployeeReport.slice(start, start + PAGE_SIZE_EMPLOYEES);
  }, [filteredEmployeeReport, employeesPage]);

  const paginatedIncidents = useMemo(() => {
    const start = (incidentsPage - 1) * PAGE_SIZE_INCIDENTS;
    return incidentsData.slice(start, start + PAGE_SIZE_INCIDENTS);
  }, [incidentsData, incidentsPage]);

  const paginatedAbsences = useMemo(() => {
    const start = (absencesPage - 1) * PAGE_SIZE_ABSENCES;
    return absenceData.slice(start, start + PAGE_SIZE_ABSENCES);
  }, [absenceData, absencesPage]);

  const paginatedLateAccumulation = useMemo(() => {
    const start = (lateAccumPage - 1) * PAGE_SIZE_LATE_ACCUMULATION;
    return filteredLateAccumulationReport.slice(start, start + PAGE_SIZE_LATE_ACCUMULATION);
  }, [lateAccumPage, filteredLateAccumulationReport]);

  const weekdayDistribution = useMemo(() => {
    const labels = ["Lun", "Mar", "Mié", "Jue", "Vie"];
    const counts = [0, 0, 0, 0, 0];
    filteredData.forEach((r) => {
      const dow = new Date(r.date + "T00:00:00").getDay();
      if (dow >= 1 && dow <= 5) counts[dow - 1]++;
    });
    const max = Math.max(...counts, 1);
    return labels.map((label, i) => ({
      label,
      count: counts[i],
      pct: Math.round((counts[i] / max) * 100),
    }));
  }, [filteredData]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatLoading]);

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isChatLoading || records.length === 0) return;

    const userMsg: ChatMessage = { role: "user", text };
    const updatedHistory = [...chatMessages, userMsg];
    setChatMessages(updatedHistory);
    setChatInput("");
    setIsChatLoading(true);
    setChatError(null);

    try {
      const response = await postChat({
        message: text,
        history: chatMessages,
        filters: {
          from: periodDateRange?.start,
          to: periodDateRange?.end,
          employee: selectedEmployee === "all" ? null : selectedEmployee,
        },
      });
      const reply = response.reply ?? "Sin respuesta.";
      setChatMessages((prev) => [...prev, { role: "model", text: reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Error al consultar el asistente.");
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatMessages, isChatLoading, periodDateRange, selectedEmployee, records.length]);

  const handlePickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await updateSettings({
        schedule: {
          entryTime: config.entryTime,
          exitTime: config.exitTime,
          toleranceMinutes: config.toleranceMinutes,
          lateThresholdMinutes: config.lateThresholdMinutes,
          workingHoursPerDay: config.workingHoursPerDay,
        },
        laborRules: {
          ...laborRules,
          lateToleranceMinutes: config.toleranceMinutes,
        },
      });
      setConfig(response.settings.schedule);
      setLaborRules(response.settings.laborRules);
      setShowSettings(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSettingsSaving(false);
    }
  }, [config, laborRules]);

  const periodLabel = useMemo(() => {
    if (reportPeriod === "month" && selectedMonth) {
      return monthOptions.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;
    }
    if (reportPeriod === "day" && selectedDay) {
      return new Date(selectedDay + "T00:00:00").toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    if (reportPeriod === "week" && weekOptions[selectedWeek]) {
      return `Semana ${weekOptions[selectedWeek].label}`;
    }
    return "Periodo seleccionado";
  }, [reportPeriod, selectedMonth, selectedDay, selectedWeek, weekOptions, monthOptions]);

  // --- Export utilities ---
  const buildPeriodLabel = useCallback(() => {
    if (reportPeriod === "month" && selectedMonth) return selectedMonth;
    if (reportPeriod === "week" && weekOptions[selectedWeek]) {
      return `semana-${weekOptions[selectedWeek].startDate}`;
    }
    if (reportPeriod === "day" && selectedDay) return selectedDay;
    return "periodo";
  }, [reportPeriod, selectedMonth, selectedDay, selectedWeek, weekOptions]);

  const exportDashboard = useCallback(() => {
    if (employeeReport.length === 0) return;
    const rows = employeeReport.map((emp) => ({
      Empleado: emp.name,
      Dias: emp.days,
      "A Tiempo": emp.onTime,
      Retardos: emp.late,
      "Retardo Mayor": emp.veryLate,
      "Hrs Total": Number(emp.totalHours.toFixed(1)),
      "Hrs Promedio": Number((emp.totalHours / Math.max(emp.days, 1)).toFixed(1)),
      "Puntualidad %": emp.days > 0 ? Math.round((emp.onTime / emp.days) * 100) : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen");
    XLSX.writeFile(wb, `resumen_empleados_${buildPeriodLabel()}.xlsx`);
  }, [employeeReport, buildPeriodLabel]);

  const exportDaily = useCallback(() => {
    if (filteredData.length === 0) return;
    const rows = filteredData.map((r) => {
      const status = classifyEntry(r.entry, config);
      const diffMins = timeToMinutes(r.entry) - timeToMinutes(config.entryTime);
      return {
        Empleado: r.employee,
        Fecha: r.date,
        Entrada: r.entry,
        Salida: r.exit || "",
        "Hrs Trabajadas": r.hoursWorked,
        Estado:
          status === "ontime" ? "A Tiempo" : status === "late" ? "Retardo" : "Retardo Mayor",
        "Diferencia (min)": diffMins,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte");
    XLSX.writeFile(wb, `reporte_diario_${buildPeriodLabel()}.xlsx`);
  }, [filteredData, config, buildPeriodLabel]);

  const exportEmployees = useCallback(() => {
    if (employeeReport.length === 0) return;
    const rows = employeeReport.map((emp) => ({
      Empleado: emp.name,
      Dias: emp.days,
      "A Tiempo": emp.onTime,
      Retardos: emp.late,
      "Retardo Mayor": emp.veryLate,
      "Hrs Total": Number(emp.totalHours.toFixed(1)),
      "Hrs Promedio dia": Number((emp.totalHours / Math.max(emp.days, 1)).toFixed(1)),
      "Puntualidad %": emp.days > 0 ? Math.round((emp.onTime / emp.days) * 100) : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Empleados");
    XLSX.writeFile(wb, `empleados_${buildPeriodLabel()}.xlsx`);
  }, [employeeReport, buildPeriodLabel]);

  const exportAbsences = useCallback(() => {
    if (absenceData.length === 0) return;
    const rows = absenceData.map((a) => {
      const d = new Date(a.date + "T00:00:00");
      const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
      return {
        Empleado: a.employee,
        Fecha: a.date,
        "Día de la Semana": dayNames[d.getDay()],
        Tipo: "Inasistencia",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inasistencias");
    XLSX.writeFile(wb, `inasistencias_${buildPeriodLabel()}.xlsx`);
  }, [absenceData, buildPeriodLabel]);

  const exportIncidents = useCallback(() => {
    const incidents = filteredData
      .filter((r) => classifyEntry(r.entry, config) !== "ontime")
      .sort((a, b) => {
        const aDiff = timeToMinutes(a.entry) - timeToMinutes(config.entryTime);
        const bDiff = timeToMinutes(b.entry) - timeToMinutes(config.entryTime);
        return bDiff - aDiff;
      });
    if (incidents.length === 0) return;
    const rows = incidents.map((r) => {
      const status = classifyEntry(r.entry, config);
      const diffMins = timeToMinutes(r.entry) - timeToMinutes(config.entryTime);
      return {
        Empleado: r.employee,
        Fecha: r.date,
        Entrada: r.entry,
        Tipo: status === "late" ? "Retardo" : "Retardo Mayor",
        "Minutos Tarde": diffMins,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Incidencias");
    XLSX.writeFile(wb, `incidencias_${buildPeriodLabel()}.xlsx`);
  }, [filteredData, config, buildPeriodLabel]);

  const exportLateAccumulation = useCallback(() => {
    if (filteredLateAccumulationReport.length === 0) return;
    const rows = filteredLateAccumulationReport.map((row) => ({
      Empleado: row.name,
      Retardos: row.late,
      "Retardo Mayor": row.veryLate,
      "Total Computable": row.totalComputable,
      Formalizacion: row.formalized ? "Si" : "No",
      Actas: row.actas,
      "Faltas Equivalentes": row.equivalentAbsences,
      "Progreso %": row.progressPct,
      "Siguiente Acta (retardos)": row.nextActaIn,
      "Estado / Sancion": row.sanctionLabel,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RetardosAcumulados");
    const periodSuffix = selectedMonth || buildPeriodLabel();
    XLSX.writeFile(wb, `retardos_acumulados_${periodSuffix}.xlsx`);
  }, [filteredLateAccumulationReport, selectedMonth, buildPeriodLabel]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const { records: parsed, summary } = await parseXlsx(file);
      if (parsed.length === 0) {
        setUploadError("Se procesó el archivo pero no se encontraron registros válidos.");
      } else {
        const result = await postImport({
          fileName: file.name,
          sourceType: file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
          config,
          summary: {
            totalRows: summary.totalRows,
            invalidRows: summary.invalidRows,
            duplicates: summary.duplicates,
          },
          records: parsed,
        });
        await loadPersistedRecords();
        setLastSourceFile(file.name);
        setUploadSummary({
          ...summary,
          validRows: result.stats.inserted,
          skippedExisting: result.stats.skippedExisting,
          duplicates: result.stats.duplicates,
          uploadedAt: new Date().toLocaleString("es-MX"),
        });
        setChatMessages([]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Error inesperado al procesar el archivo.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }, [config, loadPersistedRecords]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--color-bg)",
      color: "var(--color-text)",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: var(--color-scroll-track); }
        ::-webkit-scrollbar-thumb { background: var(--color-scroll-thumb); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--color-scroll-thumb-hover); }

        .glass-panel {
          background: var(--color-panel-bg);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          backdrop-filter: blur(20px);
        }
        .stat-card {
          position: relative;
          overflow: visible;
          z-index: 1;
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
        }
        .stat-card:hover {
          transform: translateY(-2px);
          z-index: 5;
          border-color: rgba(99,132,255,0.2);
          box-shadow: 0 8px 32px rgba(99,132,255,0.08);
        }
        .stat-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          border-radius: 16px 16px 0 0;
        }
        .stat-card.green::before { background: linear-gradient(90deg, #10b981, #34d399); }
        .stat-card.amber::before { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
        .stat-card.red::before { background: linear-gradient(90deg, #ef4444, #f87171); }
        .stat-card.blue::before { background: linear-gradient(90deg, #6384ff, #818cf8); }
        .stat-card.purple::before { background: linear-gradient(90deg, #a855f7, #c084fc); }

        .nav-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 16px; border-radius: 10px;
          border: none; cursor: pointer;
          font-size: 13px; font-weight: 500;
          font-family: inherit;
          color: var(--color-text-muted); background: transparent;
          transition: all 0.2s;
        }
        .nav-btn:hover { color: var(--color-text-soft); background: rgba(99,132,255,0.06); }
        .nav-btn.active {
          color: var(--color-text); background: rgba(99,132,255,0.12);
          box-shadow: 0 0 0 1px rgba(99,132,255,0.2);
        }

        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.3px;
          font-family: 'JetBrains Mono', monospace;
          border: 1px solid transparent;
        }
        .badge-green { background: rgba(16,185,129,0.12); color: #34d399; }
        .badge-amber { background: rgba(245,158,11,0.12); color: #fbbf24; }
        .badge-red { background: rgba(239,68,68,0.12); color: #f87171; }
        .badge-purple { background: rgba(168,85,247,0.12); color: #c084fc; }
        .badge-blue { background: rgba(99,132,255,0.12); color: #818cf8; }

        html[data-theme="light"] .badge-green {
          background: rgba(4, 120, 87, 0.2);
          color: #047857;
          border: 1px solid rgba(4, 120, 87, 0.45);
          font-weight: 700;
        }
        html[data-theme="light"] .badge-amber {
          background: rgba(180, 83, 9, 0.22);
          color: #9a3412;
          border: 1px solid rgba(180, 83, 9, 0.45);
          font-weight: 700;
        }
        html[data-theme="light"] .badge-red {
          background: rgba(185, 28, 28, 0.18);
          color: #b91c1c;
          border: 1px solid rgba(185, 28, 28, 0.42);
          font-weight: 700;
        }
        html[data-theme="light"] .badge-purple {
          background: rgba(107, 33, 168, 0.18);
          color: #6b21a8;
          border: 1px solid rgba(107, 33, 168, 0.4);
          font-weight: 700;
        }
        html[data-theme="light"] .badge-blue {
          background: rgba(37, 99, 235, 0.18);
          color: #1d4ed8;
          border: 1px solid rgba(37, 99, 235, 0.4);
          font-weight: 700;
        }

        .emp-stat-tile {
          text-align: center;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid transparent;
        }
        .emp-stat-tile--green { background: rgba(16,185,129,0.06); }
        .emp-stat-tile--amber { background: rgba(245,158,11,0.06); }
        .emp-stat-tile--red { background: rgba(239,68,68,0.06); }
        .emp-stat-tile--purple { background: rgba(168,85,247,0.06); }
        .emp-stat-tile__value {
          font-size: 18px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }
        .emp-stat-tile__value--green { color: #34d399; }
        .emp-stat-tile__value--amber { color: #f59e0b; }
        .emp-stat-tile__value--red { color: #ef4444; }
        .emp-stat-tile__value--purple { color: #9333ea; }
        .emp-stat-tile__label { font-size: 10px; color: var(--color-text-muted); font-weight: 600; }
        html[data-theme="light"] .emp-stat-tile--green {
          background: rgba(4, 120, 87, 0.14);
          border-color: rgba(4, 120, 87, 0.35);
        }
        html[data-theme="light"] .emp-stat-tile--amber {
          background: rgba(180, 83, 9, 0.14);
          border-color: rgba(180, 83, 9, 0.38);
        }
        html[data-theme="light"] .emp-stat-tile--red {
          background: rgba(185, 28, 28, 0.12);
          border-color: rgba(185, 28, 28, 0.38);
        }
        html[data-theme="light"] .emp-stat-tile--purple {
          background: rgba(107, 33, 168, 0.12);
          border-color: rgba(107, 33, 168, 0.38);
        }
        html[data-theme="light"] .emp-stat-tile__value--green { color: #047857; }
        html[data-theme="light"] .emp-stat-tile__value--amber { color: #b45309; }
        html[data-theme="light"] .emp-stat-tile__value--red { color: #b91c1c; }
        html[data-theme="light"] .emp-stat-tile__value--purple { color: #6b21a8; }
        html[data-theme="light"] .emp-stat-tile__label { color: var(--color-text-soft); font-weight: 700; }

        .emp-pct-good { color: #34d399; }
        .emp-pct-warn { color: #f59e0b; }
        .emp-pct-bad { color: #ef4444; }
        html[data-theme="light"] .emp-pct-good { color: #047857; }
        html[data-theme="light"] .emp-pct-warn { color: #b45309; }
        html[data-theme="light"] .emp-pct-bad { color: #b91c1c; }

        .input-field {
          background: var(--color-input-bg);
          border: 1px solid var(--color-border);
          border-radius: 10px;
          padding: 10px 14px;
          color: var(--color-text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s;
          width: 100%;
        }
        .input-field:focus { border-color: rgba(99,132,255,0.4); }

        select.input-field { cursor: pointer; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238892a8' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 32px;
        }
        html[data-theme="light"] select.input-field {
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%235e6b85' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
        }

        .btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 20px; border-radius: 10px;
          border: none; cursor: pointer;
          font-size: 13px; font-weight: 600;
          font-family: inherit;
          background: linear-gradient(135deg, #6384ff, #5a6fff);
          color: var(--color-text-on-primary);
          transition: all 0.2s;
          box-shadow: 0 2px 12px rgba(99,132,255,0.25);
        }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(99,132,255,0.35); }

        .btn-ghost {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 10px;
          border: 1px solid var(--color-border); cursor: pointer;
          font-size: 12px; font-weight: 500;
          font-family: inherit;
          background: transparent; color: var(--color-text-muted);
          transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: var(--color-border-strong); color: var(--color-text-soft); background: rgba(99,132,255,0.05); }

        .table-container { overflow-x: auto; }
        table {
          width: 100%; border-collapse: separate; border-spacing: 0;
          font-size: 13px;
        }
        th {
          text-align: left; padding: 12px 16px;
          font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.8px;
          color: var(--color-text-muted); border-bottom: 1px solid var(--color-border);
          position: sticky; top: 0;
          background: var(--color-table-head-bg);
        }
        td {
          padding: 12px 16px; border-bottom: 1px solid var(--color-table-cell-border);
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: var(--color-text-soft);
        }
        tr:hover td { background: var(--color-table-row-hover); }

        .modal-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: var(--color-modal-overlay); backdrop-filter: blur(8px);
          display: flex; align-items: flex-start; justify-content: center;
          overflow-y: auto; padding: 24px 0;
          animation: fadeIn 0.2s ease;
        }
        .modal-content {
          background: var(--color-modal-bg);
          border: 1px solid var(--color-border);
          border-radius: 20px; padding: 32px;
          max-width: 520px; width: 90%;
          max-height: calc(100vh - 48px); overflow-y: auto;
          box-shadow: 0 24px 80px rgba(0,0,0,0.5);
          animation: slideUp 0.3s ease;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .bar-chart-bar {
          transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
          border-radius: 4px 4px 0 0;
        }
        .bar-chart-bar:hover { filter: brightness(1.2); }

        .upload-zone {
          border: 2px dashed rgba(99,132,255,0.2);
          border-radius: 16px; padding: 40px;
          text-align: center; cursor: pointer;
          transition: all 0.3s;
        }
        .upload-zone:hover {
          border-color: rgba(99,132,255,0.4);
          background: rgba(99,132,255,0.03);
        }

        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .chat-fab {
          position: fixed; bottom: 28px; right: 28px; z-index: 200;
          width: 52px; height: 52px; border-radius: 50%;
          background: linear-gradient(135deg, #6384ff, #5a6fff);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 20px rgba(99,132,255,0.4);
          transition: all 0.2s;
        }
        .chat-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(99,132,255,0.55); }

        .chat-panel {
          position: fixed; bottom: 92px; right: 28px; z-index: 200;
          width: 380px; height: 560px;
          background: var(--color-modal-bg);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.35);
          display: flex; flex-direction: column;
          animation: slideUp 0.25s ease;
          overflow: hidden;
        }

        .chat-msg-user {
          align-self: flex-end;
          background: linear-gradient(135deg, #6384ff, #5a6fff);
          color: var(--color-text-on-primary);
          padding: 10px 14px; border-radius: 16px 16px 4px 16px;
          max-width: 80%; font-size: 13px; line-height: 1.5;
          word-break: break-word;
        }
        .chat-msg-model {
          align-self: flex-start;
          background: var(--color-chat-bubble-model-bg);
          border: 1px solid var(--color-chat-bubble-model-border);
          color: var(--color-text-soft);
          padding: 10px 14px; border-radius: 16px 16px 16px 4px;
          max-width: 88%; font-size: 13px; line-height: 1.6;
          word-break: break-word;
        }
        .chat-input-row {
          display: flex; gap: 8px; padding: 12px 16px;
          border-top: 1px solid var(--color-border);
          background: var(--color-input-bg);
        }
        .chat-input {
          flex: 1;
          background: var(--color-input-bg);
          border: 1px solid var(--color-border-strong);
          border-radius: 10px; padding: 9px 13px;
          color: var(--color-text); font-size: 13px; font-family: inherit;
          outline: none; resize: none;
          transition: border-color 0.2s;
        }
        .chat-input::placeholder {
          color: var(--color-text-muted);
          opacity: 1;
        }
        .chat-input:focus { border-color: rgba(99,132,255,0.45); }
        .chat-send-btn {
          width: 38px; height: 38px; border-radius: 10px;
          background: linear-gradient(135deg, #6384ff, #5a6fff);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; flex-shrink: 0;
          align-self: flex-end;
        }
        .chat-send-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,132,255,0.35); }
        .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

        .typing-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #6384ff; display: inline-block;
          animation: typingBounce 1.2s infinite ease-in-out;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>

      {/* --- HEADER --- */}
      <header style={{
        padding: "16px 32px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--color-header-bg)", backdropFilter: "blur(20px)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #6384ff, #5a6fff)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "var(--color-text)",
            boxShadow: "0 2px 12px rgba(99,132,255,0.3)",
          }}>A</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.3px" }}>
              ControlAsistencias
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              Sistema de Control de Asistencia
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn-ghost" onClick={toggleTheme} aria-label="Cambiar tema">
            {theme === "dark" ? "Modo light" : "Modo dark"}
          </button>
          <button className="btn-ghost" onClick={() => setShowUpload(true)}>
            <Icons.Upload /> Subir Archivo
          </button>
          <div ref={userMenuRef} style={{ position: "relative", marginLeft: 8 }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              aria-label="Abrir menú de usuario"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              style={{
                width: 34, height: 34, borderRadius: 10,
                background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: "var(--color-text)",
                border: "none", cursor: "pointer",
              }}
            >
              {userInitials}
            </button>
            {isUserMenuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  minWidth: 220,
                  background: "var(--color-menu-bg)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: 12,
                  boxShadow: "0 10px 26px rgba(0,0,0,0.4)",
                  padding: 8,
                }}
              >
                <div style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--color-border)",
                  marginBottom: 6,
                }}>
                  {user?.email} ({user?.role})
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="btn-ghost"
                  onClick={() => {
                    setShowSettings(true);
                    setIsUserMenuOpen(false);
                  }}
                  style={{ width: "100%", justifyContent: "flex-start" }}
                >
                  <Icons.Settings /> Configuración
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="btn-ghost"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    void doLogout();
                  }}
                  style={{ width: "100%", justifyContent: "flex-start", marginTop: 4 }}
                >
                  Salir
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 69px)" }}>
        {/* --- SIDEBAR --- */}
        <nav style={{
          width: 220, padding: "20px 12px",
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-sidebar-bg)",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "1.2px", padding: "8px 16px 12px" }}>
            Navegación
          </div>
          {[
            { id: "dashboard", icon: <Icons.Chart />, label: "Dashboard" },
            { id: "daily", icon: <Icons.Calendar />, label: "Reporte Diario" },
            { id: "employees", icon: <Icons.Users />, label: "Por Empleado" },
            { id: "lateAccumulation", icon: <Icons.Clock />, label: "Retardos Acumulados" },
            { id: "incidents", icon: <Icons.Alert />, label: "Incidencias" },
            { id: "absences", icon: <Icons.UserX />, label: "Inasistencias" },
          ].map(item => (
            <button
              key={item.id}
              className={`nav-btn ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon} {item.label}
            </button>
          ))}

          <div style={{ marginTop: "auto", padding: "16px", borderTop: "1px solid rgba(99,132,255,0.06)" }}>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <Icons.Database /> Fuente: XLSX
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              {records.length.toLocaleString("es-MX")} registros
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
              {employees.length} empleados • {monthOptions.length} meses
            </div>
          </div>
        </nav>

        {/* --- MAIN CONTENT --- */}
        <main style={{ flex: 1, padding: 28, overflowY: "auto", maxHeight: "calc(100vh - 69px)" }}>

          {/* Empty state */}
          {records.length === 0 && (
            <div className="glass-panel" style={{ padding: 28, marginBottom: 24, border: "1px solid rgba(99,132,255,0.15)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
                Sin datos cargados
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
                Sube un archivo .xlsx de Odoo (hr.attendance) para calcular indicadores en tiempo real.
              </div>
              <button className="btn-primary" onClick={() => setShowUpload(true)}>
                <Icons.Upload /> Cargar archivo
              </button>
            </div>
          )}

          {/* Filter Bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", gap: 4, background: "var(--color-pill-track)", borderRadius: 12, padding: 4, border: "1px solid var(--color-pill-border)" }}>
              {[
                { id: "day", label: "Día" },
                { id: "week", label: "Semana" },
                { id: "month", label: "Mes" },
              ].map(p => (
                <button key={p.id} onClick={() => setReportPeriod(p.id)} style={{
                  padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                  background: reportPeriod === p.id ? "var(--color-pill-active-bg)" : "transparent",
                  color: reportPeriod === p.id ? "var(--color-text)" : "var(--color-text-muted)",
                  transition: "all 0.2s",
                }}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Selector de mes compartido para los tres modos */}
            {(reportPeriod === "month" || reportPeriod === "day" || reportPeriod === "week") && (
              <select
                className="input-field"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                style={{ width: 150 }}
                disabled={monthOptions.length === 0}
              >
                {monthOptions.length === 0
                  ? <option value="">Sin meses</option>
                  : monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)
                }
              </select>
            )}

            {/* Selector de día específico */}
            {reportPeriod === "day" && (
              <select
                className="input-field"
                value={selectedDay}
                onChange={e => setSelectedDay(e.target.value)}
                style={{ width: 180 }}
                disabled={dayOptions.length === 0}
              >
                {dayOptions.length === 0
                  ? <option value="">Sin días</option>
                  : dayOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)
                }
              </select>
            )}

            {/* Selector de semana dentro del mes */}
            {reportPeriod === "week" && (
              <select
                className="input-field"
                value={selectedWeek}
                onChange={e => setSelectedWeek(Number(e.target.value))}
                style={{ width: 210 }}
                disabled={weekOptions.length === 0}
              >
                {weekOptions.length === 0
                  ? <option value={0}>Sin semanas</option>
                  : weekOptions.map((w, i) => <option key={w.startDate} value={i}>{w.label}</option>)
                }
              </select>
            )}

            <select
              className="input-field"
              value={selectedEmployee}
              onChange={e => setSelectedEmployee(e.target.value)}
              style={{ width: 200 }}
            >
              <option value="all">Todos los empleados</option>
              {employees.map(e => <option key={e} value={e}>{e}</option>)}
            </select>

          </div>

          {/* DASHBOARD VIEW */}
          {activeTab === "dashboard" && (
            <>
              {/* Period indicator */}
              {records.length > 0 && (
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "rgba(99,132,255,0.10)", border: "1px solid rgba(99,132,255,0.18)",
                    borderRadius: 8, padding: "4px 12px",
                  }}>
                    <Icons.Calendar />
                    <span style={{ fontSize: 12, color: "#818cf8", fontWeight: 600 }}>{periodLabel}</span>
                  </div>
                  {periodDateRange && (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      Datos hasta hoy • Rango efectivo: {formatDate(periodDateRange.start)} - {formatDate(periodDateRange.end)}
                    </div>
                  )}
                </div>
              )}
              {/* Stats Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
                <div className="glass-panel stat-card green" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    A Tiempo <HelpTip text={widgetHelp.onTime} />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#34d399", fontFamily: "'JetBrains Mono', monospace" }}>{stats.onTime}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {stats.totalRecords > 0 ? Math.round(stats.onTime / stats.totalRecords * 100) : 0}% de registros
                  </div>
                </div>
                <div className="glass-panel stat-card amber" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    Retardos <HelpTip text={widgetHelp.late} />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#fbbf24", fontFamily: "'JetBrains Mono', monospace" }}>{stats.late}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {stats.totalRecords > 0 ? Math.round(stats.late / stats.totalRecords * 100) : 0}% de registros
                  </div>
                </div>
                <div className="glass-panel stat-card red" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    Retardo Mayor <HelpTip text={widgetHelp.veryLate} />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#f87171", fontFamily: "'JetBrains Mono', monospace" }}>{stats.veryLate}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {">"}{config.lateThresholdMinutes} min después
                  </div>
                </div>
                <div className="glass-panel stat-card blue" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    Hrs. Promedio <HelpTip text={widgetHelp.avgHours} />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#818cf8", fontFamily: "'JetBrains Mono', monospace" }}>{stats.avgHours.toFixed(1)}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    hrs/día por persona
                  </div>
                </div>
                <div className="glass-panel stat-card purple" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    Inasistencias <HelpTip text={widgetHelp.absences} />
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#c084fc", fontFamily: "'JetBrains Mono', monospace" }}>{stats.absences}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {stats.absenceRatePct.toFixed(1)}% sobre {stats.absenceBaseEmployees} empleados activos
                  </div>
                </div>
              </div>

              {/* Charts Row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
                {/* Bar Chart - Attendance by day of week */}
                <div className="glass-panel" style={{ padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    Asistencia por día de la semana <HelpTip text={widgetHelp.weekday} />
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 160, paddingBottom: 24, position: "relative" }}>
                    {weekdayDistribution.map((day, i) => (
                      <div key={day.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 11, color: "#818cf8", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                          {day.count}
                        </div>
                        <div className="bar-chart-bar" style={{
                          width: "100%", height: `${Math.max(day.pct, 4)}%`,
                          background: `linear-gradient(180deg, rgba(99,132,255,${0.6 + i * 0.08}), rgba(99,132,255,0.15))`,
                        }} />
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>{day.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Donut-like summary */}
                <div className="glass-panel" style={{ padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    Distribución de Incidencias <HelpTip text={widgetHelp.incidents} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
                    <div style={{ position: "relative", width: 120, height: 120 }}>
                      <svg viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
                        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(99,132,255,0.06)" strokeWidth="12" />
                        <circle cx="60" cy="60" r="50" fill="none" stroke="#34d399" strokeWidth="12"
                          strokeDasharray={`${(stats.onTime / Math.max(stats.totalRecords, 1)) * 314} 314`}
                          strokeLinecap="round" />
                        <circle cx="60" cy="60" r="50" fill="none" stroke="#fbbf24" strokeWidth="12"
                          strokeDasharray={`${(stats.late / Math.max(stats.totalRecords, 1)) * 314} 314`}
                          strokeDashoffset={`-${(stats.onTime / Math.max(stats.totalRecords, 1)) * 314}`}
                          strokeLinecap="round" />
                        <circle cx="60" cy="60" r="50" fill="none" stroke="#f87171" strokeWidth="12"
                          strokeDasharray={`${(stats.veryLate / Math.max(stats.totalRecords, 1)) * 314} 314`}
                          strokeDashoffset={`-${((stats.onTime + stats.late) / Math.max(stats.totalRecords, 1)) * 314}`}
                          strokeLinecap="round" />
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", fontFamily: "'JetBrains Mono', monospace" }}>
                          {reportPeriod === "day" ? stats.uniqueEmployees : stats.totalRecords}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                          {reportPeriod === "day" ? "personas con asistencia" : "registros"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[
                        { label: "A tiempo", color: "#34d399", value: stats.onTime },
                        { label: "Retardo", color: "#fbbf24", value: stats.late },
                        { label: "Retardo mayor", color: "#f87171", value: stats.veryLate },
                      ].map(item => (
                        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: item.color }} />
                          <span style={{ fontSize: 12, color: "var(--color-text-muted)", minWidth: 90 }}>{item.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
                        </div>
                      ))}
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                        {stats.totalRecords} registros · {stats.uniqueEmployees} personas con asistencia
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Incidents Table */}
              <div className="glass-panel" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", display: "flex", alignItems: "center", gap: 8 }}>
                    Resumen por Empleado <HelpTip text={widgetHelp.employeeSummary} />
                  </div>
                  <button className="btn-ghost" onClick={exportDashboard} disabled={employeeReport.length === 0}><Icons.Download /> Exportar</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 10, marginBottom: 12 }}>
                  <input
                    type="text"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Buscar empleado..."
                    aria-label="Buscar en resumen por empleado"
                    style={{
                      background: "var(--color-input-bg)",
                      border: "1px solid rgba(99,132,255,0.16)",
                      borderRadius: 10,
                      color: "var(--color-text)",
                      padding: "10px 12px",
                      fontSize: 12,
                    }}
                  />
                  <select
                    value={employeeTableFilter}
                    onChange={(e) => setEmployeeTableFilter(e.target.value as EmployeeTableFilter)}
                    aria-label="Filtro rápido de empleados"
                    style={{
                      background: "var(--color-input-bg)",
                      border: "1px solid rgba(99,132,255,0.16)",
                      borderRadius: 10,
                      color: "var(--color-text)",
                      padding: "10px 12px",
                      fontSize: 12,
                    }}
                  >
                    <option value="all">Todos</option>
                    <option value="withAttendance">Con asistencia</option>
                    <option value="withAbsences">Con inasistencias</option>
                    <option value="withIncidents">Con incidencias</option>
                  </select>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 12 }}>
                  {filteredEmployeeReport.length} empleados filtrados ({employeeReport.length} totales)
                </div>
                <div className="table-container" style={{ maxHeight: 400, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        <th>Días</th>
                        <th>A Tiempo</th>
                        <th>Retardos</th>
                        <th>Ret. Mayor</th>
                        <th>Inasistencias</th>
                        <th>Hrs. Total</th>
                        <th>Hrs. Prom.</th>
                        <th>Puntualidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDashboardEmployees.map(emp => {
                        const pct = emp.days > 0 ? Math.round(emp.onTime / emp.days * 100) : 0;
                        return (
                          <tr key={emp.name}>
                            <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{emp.name}</td>
                            <td>{emp.days}</td>
                            <td><span className="badge badge-green">{emp.onTime}</span></td>
                            <td><span className="badge badge-amber">{emp.late}</span></td>
                            <td><span className="badge badge-red">{emp.veryLate}</span></td>
                            <td><span className={`badge ${emp.absences > 0 ? "badge-purple" : "badge-green"}`}>{emp.absences}</span></td>
                            <td>{emp.totalHours.toFixed(1)}</td>
                            <td>{(emp.totalHours / Math.max(emp.days, 1)).toFixed(1)}</td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(99,132,255,0.08)", minWidth: 60 }}>
                                  <div style={{
                                    height: "100%", borderRadius: 4, width: `${pct}%`,
                                    background: pct >= 80 ? "#34d399" : pct >= 60 ? "#fbbf24" : "#f87171",
                                  }} />
                                </div>
                                <span style={{ fontSize: 11, minWidth: 32 }}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredEmployeeReport.length === 0 && (
                        <tr>
                          <td colSpan={9} style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 20 }}>
                            Sin resultados para los filtros seleccionados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={dashboardEmployeesPage}
                  totalItems={filteredEmployeeReport.length}
                  pageSize={PAGE_SIZE_DASHBOARD_EMPLOYEES}
                  onPageChange={setDashboardEmployeesPage}
                  itemLabel="empleados"
                />
              </div>
            </>
          )}

          {/* DAILY REPORT VIEW */}
          {activeTab === "daily" && (
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>Reporte Detallado de Asistencia</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {filteredData.length} registros · {stats.uniqueEmployees} personas con asistencia · {periodLabel}
                  </div>
                </div>
                <button className="btn-primary" onClick={exportDaily} disabled={filteredData.length === 0}><Icons.Download /> Exportar a Excel</button>
              </div>
              <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Fecha</th>
                      <th>Entrada</th>
                      <th>Salida</th>
                      <th>Hrs. Trabajadas</th>
                      <th>Estado</th>
                      <th>Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDailyData.map(r => {
                      const status = classifyEntry(r.entry, config);
                      const diffMins = timeToMinutes(r.entry) - timeToMinutes(config.entryTime);
                      return (
                        <tr key={r.id}>
                          <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{r.employee}</td>
                          <td>{formatDate(r.date)}</td>
                          <td>{r.entry}</td>
                          <td>{r.exit || "--:--"}</td>
                          <td>{r.hoursWorked.toFixed(2)}</td>
                          <td>
                            <span className={`badge ${status === "ontime" ? "badge-green" : status === "late" ? "badge-amber" : "badge-red"}`}>
                              {status === "ontime" ? "✓ A Tiempo" : status === "late" ? "⏱ Retardo" : "⚠ Ret. Mayor"}
                            </span>
                          </td>
                          <td style={{ color: diffMins > 0 ? "#f87171" : "#34d399" }}>
                            {diffMins > 0 ? `+${diffMins}` : diffMins} min
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={dailyPage}
                totalItems={filteredData.length}
                pageSize={PAGE_SIZE_DAILY}
                onPageChange={setDailyPage}
                itemLabel="registros"
              />
            </div>
          )}

          {/* EMPLOYEES VIEW */}
          {activeTab === "employees" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>Por Empleado</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>{filteredEmployeeReport.length} empleados filtrados ({employeeReport.length} totales) · {periodLabel}</div>
                </div>
                <button className="btn-ghost" onClick={exportEmployees} disabled={employeeReport.length === 0}><Icons.Download /> Exportar</button>
              </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 10, marginBottom: 12 }}>
              <input
                type="text"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder="Buscar empleado..."
                aria-label="Buscar en cards por empleado"
                style={{
                  background: "var(--color-input-bg)",
                  border: "1px solid rgba(99,132,255,0.16)",
                  borderRadius: 10,
                  color: "var(--color-text)",
                  padding: "10px 12px",
                  fontSize: 12,
                }}
              />
              <select
                value={employeeTableFilter}
                onChange={(e) => setEmployeeTableFilter(e.target.value as EmployeeTableFilter)}
                aria-label="Filtro rápido de cards de empleado"
                style={{
                  background: "var(--color-input-bg)",
                  border: "1px solid rgba(99,132,255,0.16)",
                  borderRadius: 10,
                  color: "var(--color-text)",
                  padding: "10px 12px",
                  fontSize: 12,
                }}
              >
                <option value="all">Todos</option>
                <option value="withAttendance">Con asistencia</option>
                <option value="withAbsences">Con inasistencias</option>
                <option value="withIncidents">Con incidencias</option>
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
              {paginatedEmployeesCards.map(emp => {
                const pct = emp.days > 0 ? Math.round(emp.onTime / emp.days * 100) : 0;
                return (
                  <div key={emp.name} className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>{emp.name}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>{emp.days} días registrados</div>
                      </div>
                      <div
                        className={pct >= 80 ? "emp-pct-good" : pct >= 60 ? "emp-pct-warn" : "emp-pct-bad"}
                        style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}
                      >{pct}%</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                      <div className="emp-stat-tile emp-stat-tile--green">
                        <div className="emp-stat-tile__value emp-stat-tile__value--green">{emp.onTime}</div>
                        <div className="emp-stat-tile__label">A Tiempo</div>
                      </div>
                      <div className="emp-stat-tile emp-stat-tile--amber">
                        <div className="emp-stat-tile__value emp-stat-tile__value--amber">{emp.late}</div>
                        <div className="emp-stat-tile__label">Retardos</div>
                      </div>
                      <div className="emp-stat-tile emp-stat-tile--red">
                        <div className="emp-stat-tile__value emp-stat-tile__value--red">{emp.veryLate}</div>
                        <div className="emp-stat-tile__label">Ret. Mayor</div>
                      </div>
                      <div className="emp-stat-tile emp-stat-tile--purple">
                        <div className="emp-stat-tile__value emp-stat-tile__value--purple">{emp.absences}</div>
                        <div className="emp-stat-tile__label">Faltas</div>
                      </div>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: "rgba(99,132,255,0.08)" }}>
                      <div style={{
                        height: "100%", borderRadius: 4, width: `${pct}%`,
                        background: pct >= 80 ? "linear-gradient(90deg, #10b981, #34d399)" : pct >= 60 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #ef4444, #f87171)",
                        transition: "width 0.5s ease",
                      }} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                      <span>Hrs. total: {emp.totalHours.toFixed(1)}</span>
                      <span>Prom: {(emp.totalHours / Math.max(emp.days, 1)).toFixed(1)} hrs/día</span>
                    </div>
                  </div>
                );
              })}
              {filteredEmployeeReport.length === 0 && (
                <div className="glass-panel" style={{ padding: 20, color: "var(--color-text-muted)", fontSize: 12 }}>
                  Sin resultados para los filtros seleccionados.
                </div>
              )}
            </div>
            <PaginationControls
              page={employeesPage}
              totalItems={filteredEmployeeReport.length}
              pageSize={PAGE_SIZE_EMPLOYEES}
              onPageChange={setEmployeesPage}
              itemLabel="empleados"
            />
            </>
          )}

          {/* INCIDENTS VIEW */}
          {activeTab === "lateAccumulation" && (
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
                    Acumulacion de Retardos por Empleado
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    Periodo mensual: {selectedMonth || "sin mes"} • Regla activa: {laborRules.directLateAfterTolerance ? "Retardo + Retardo Mayor computan" : "Solo Retardo Mayor computa"}
                  </div>
                </div>
                <button className="btn-ghost" onClick={exportLateAccumulation} disabled={filteredLateAccumulationReport.length === 0}>
                  <Icons.Download /> Exportar
                </button>
              </div>
              {lateAccumulationRange && (
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
                  Rango efectivo: {formatDate(lateAccumulationRange.start)} - {formatDate(lateAccumulationRange.end)} (cortado a hoy)
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 16 }}>
                Umbral formal: desde retardo #{laborRules.lateFormalFromNthInMonth} •
                Acta cada {laborRules.formalLateActaAtNth} acumulados •
                Riesgo anual: {laborRules.actasForTerminationInYear} actas
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 10, marginBottom: 12 }}>
                <input
                  type="text"
                  value={lateAccumSearch}
                  onChange={(e) => setLateAccumSearch(e.target.value)}
                  placeholder="Buscar empleado..."
                  aria-label="Buscar en acumulacion de retardos"
                  style={{
                    background: "var(--color-input-bg)",
                    border: "1px solid rgba(99,132,255,0.16)",
                    borderRadius: 10,
                    color: "var(--color-text)",
                    padding: "10px 12px",
                    fontSize: 12,
                  }}
                />
                <select
                  value={lateAccumFilter}
                  onChange={(e) => setLateAccumFilter(e.target.value as LateAccumulationFilter)}
                  aria-label="Filtro de acumulacion de retardos"
                  style={{
                    background: "var(--color-input-bg)",
                    border: "1px solid rgba(99,132,255,0.16)",
                    borderRadius: 10,
                    color: "var(--color-text)",
                    padding: "10px 12px",
                    fontSize: 12,
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="withFormalization">Con retardo formal</option>
                  <option value="withActa">Con acta</option>
                  <option value="withEquivalentAbsence">Con falta equivalente</option>
                </select>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 12 }}>
                {filteredLateAccumulationReport.length} empleados filtrados ({lateAccumulationReport.length} totales)
              </div>
              <div className="table-container" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Retardos</th>
                      <th>Ret. Mayor</th>
                      <th>Total computable</th>
                      <th>Formalizacion</th>
                      <th>Actas</th>
                      <th>Faltas equivalentes</th>
                      <th>Progreso</th>
                      <th>Siguiente acta</th>
                      <th>Estado / Sancion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLateAccumulation.map((row) => (
                      <tr key={row.name}>
                        <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{row.name}</td>
                        <td><span className="badge badge-amber">{row.late}</span></td>
                        <td><span className="badge badge-red">{row.veryLate}</span></td>
                        <td><span className="badge badge-blue">{row.totalComputable}</span></td>
                        <td>
                          <span className={`badge ${row.formalized ? "badge-amber" : "badge-green"}`}>
                            {row.formalized ? "Si" : "No"}
                          </span>
                        </td>
                        <td><span className={`badge ${row.actas > 0 ? "badge-red" : "badge-green"}`}>{row.actas}</span></td>
                        <td><span className={`badge ${row.equivalentAbsences > 0 ? "badge-purple" : "badge-green"}`}>{row.equivalentAbsences}</span></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(99,132,255,0.08)", minWidth: 70 }}>
                              <div
                                style={{
                                  height: "100%",
                                  borderRadius: 4,
                                  width: `${row.progressPct}%`,
                                  background: row.equivalentAbsences > 0 ? "linear-gradient(90deg, #a855f7, #c084fc)" : "linear-gradient(90deg, #f59e0b, #fbbf24)",
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 11, minWidth: 34 }}>{row.progressPct}%</span>
                          </div>
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {row.nextActaIn} retardo(s)
                        </td>
                        <td style={{ color: "var(--color-text-soft)", fontSize: 12 }}>{row.sanctionLabel}</td>
                      </tr>
                    ))}
                    {filteredLateAccumulationReport.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 20 }}>
                          Sin resultados para los filtros seleccionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={lateAccumPage}
                totalItems={filteredLateAccumulationReport.length}
                pageSize={PAGE_SIZE_LATE_ACCUMULATION}
                onPageChange={setLateAccumPage}
                itemLabel="empleados"
              />
            </div>
          )}

          {/* INCIDENTS VIEW */}
          {activeTab === "incidents" && (
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
                  Registro de Incidencias
                </div>
                <button className="btn-ghost" onClick={exportIncidents} disabled={incidentsData.length === 0}><Icons.Download /> Exportar</button>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 20 }}>
                Solo retardos y retardos mayores • Configuración: Entrada {config.entryTime}, Tolerancia {config.toleranceMinutes} min, Retardo mayor {">"}{config.lateThresholdMinutes} min
              </div>
              <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Fecha</th>
                      <th>Entrada</th>
                      <th>Tipo</th>
                      <th>Minutos Tarde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIncidents.map(r => {
                        const status = classifyEntry(r.entry, config);
                        const diffMins = timeToMinutes(r.entry) - timeToMinutes(config.entryTime);
                        return (
                          <tr key={r.id}>
                            <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{r.employee}</td>
                            <td>{formatDate(r.date)}</td>
                            <td>{r.entry}</td>
                            <td>
                              <span className={`badge ${status === "late" ? "badge-amber" : "badge-red"}`}>
                                {status === "late" ? "Retardo" : "Retardo Mayor"}
                              </span>
                            </td>
                            <td style={{ color: "#f87171", fontWeight: 600 }}>+{diffMins} min</td>
                          </tr>
                        );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={incidentsPage}
                totalItems={incidentsData.length}
                pageSize={PAGE_SIZE_INCIDENTS}
                onPageChange={setIncidentsPage}
                itemLabel="incidencias"
              />
            </div>
          )}

          {/* ABSENCES VIEW */}
          {activeTab === "absences" && (
            <>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
                <div className="glass-panel stat-card purple" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>Total Inasistencias</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#c084fc", fontFamily: "'JetBrains Mono', monospace" }}>{absenceData.length}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {stats.absenceRatePct.toFixed(1)}% de ausentismo · {periodLabel}
                  </div>
                </div>
                <div className="glass-panel stat-card blue" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>Días Hábiles del Período</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#818cf8", fontFamily: "'JetBrains Mono', monospace" }}>
                    {stats.workingDays}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>Lunes a Viernes</div>
                </div>
                <div className="glass-panel stat-card red" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>Empleados con Faltas</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#f87171", fontFamily: "'JetBrains Mono', monospace" }}>
                    {new Set(absenceData.map((a) => a.employee)).size}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>con al menos 1 inasistencia</div>
                </div>
              </div>

              {/* Detail table */}
              <div className="glass-panel" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>Detalle de Inasistencias</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                      Días hábiles (Lun–Vie) sin ningún registro de entrada · Horario: {config.entryTime} – {config.exitTime}
                    </div>
                  </div>
                  <button className="btn-ghost" onClick={exportAbsences} disabled={absenceData.length === 0}>
                    <Icons.Download /> Exportar
                  </button>
                </div>

                {absenceData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-muted)", fontSize: 14 }}>
                    {records.length === 0
                      ? "Sin datos cargados — sube un archivo para calcular inasistencias."
                      : "No se detectaron inasistencias en el período seleccionado. ¡Asistencia perfecta!"}
                  </div>
                ) : (
                  <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Empleado</th>
                          <th>Fecha</th>
                          <th>Día</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedAbsences.map((a, i) => {
                          const d = new Date(a.date + "T00:00:00");
                          const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
                          return (
                            <tr key={i}>
                              <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{a.employee}</td>
                              <td>{formatDate(a.date)}</td>
                              <td style={{ color: "var(--color-text-muted)" }}>{dayNames[d.getDay()]}</td>
                              <td><span className="badge badge-purple">✕ Inasistencia</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {absenceData.length > 0 && (
                  <PaginationControls
                    page={absencesPage}
                    totalItems={absenceData.length}
                    pageSize={PAGE_SIZE_ABSENCES}
                    onPageChange={setAbsencesPage}
                    itemLabel="inasistencias"
                  />
                )}
              </div>

              {/* Per-employee absence summary */}
              {absenceData.length > 0 && (
                <div className="glass-panel" style={{ padding: 24, marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 16 }}>Resumen por Empleado</div>
                  <div className="table-container" style={{ maxHeight: 360, overflowY: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Empleado</th>
                          <th>Inasistencias</th>
                          <th>Días Hábiles Período</th>
                          <th>% Ausentismo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const totalWD = stats.workingDays;
                          const byEmp: Record<string, number> = {};
                          absenceData.forEach((a) => { byEmp[a.employee] = (byEmp[a.employee] || 0) + 1; });
                          return Object.entries(byEmp)
                            .sort((a, b) => b[1] - a[1])
                            .map(([emp, count]) => {
                              const pct = totalWD > 0 ? Math.round((count / totalWD) * 100) : 0;
                              return (
                                <tr key={emp}>
                                  <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{emp}</td>
                                  <td><span className="badge badge-purple">{count}</span></td>
                                  <td style={{ color: "var(--color-text-muted)" }}>{totalWD}</td>
                                  <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(99,132,255,0.08)", minWidth: 60 }}>
                                        <div style={{
                                          height: "100%", borderRadius: 4, width: `${pct}%`,
                                          background: pct >= 30 ? "linear-gradient(90deg, #ef4444, #f87171)" : pct >= 15 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #a855f7, #c084fc)",
                                        }} />
                                      </div>
                                      <span style={{ fontSize: 11, minWidth: 32 }}>{pct}%</span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* DATABASE VIEW */}
          {activeTab === "database" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
                <div className="glass-panel" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" }}>Registros Cargados</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#818cf8", fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>
                    {records.length.toLocaleString("es-MX")}
                  </div>
                </div>
                <div className="glass-panel" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" }}>Empleados Detectados</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#34d399", fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>{employees.length}</div>
                </div>
                <div className="glass-panel" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" }}>Última Fecha en Datos</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)", fontFamily: "'JetBrains Mono', monospace", marginTop: 12 }}>
                    {latestDate ? formatDate(latestDate) : "--"}
                  </div>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 16 }}>Historial de Importaciones</div>
                <table>
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Fecha de Carga</th>
                      <th>Registros Nuevos</th>
                      <th>Omitidos</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadSummary ? (
                      <tr>
                        <td style={{ color: "var(--color-text)", fontFamily: "'DM Sans', sans-serif" }}>{uploadSummary.fileName}</td>
                        <td>{uploadSummary.uploadedAt}</td>
                        <td><span className="badge badge-green">{uploadSummary.validRows}</span></td>
                        <td><span className="badge badge-amber">{uploadSummary.duplicates}</span></td>
                        <td><span className="badge badge-green"><Icons.Check /> Procesado</span></td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ color: "var(--color-text-muted)", textAlign: "center", padding: 24 }}>
                          Sin importaciones — sube un archivo para comenzar
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: "rgba(99,132,255,0.04)", border: "1px solid rgba(99,132,255,0.08)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", marginBottom: 8 }}>Columnas esperadas (Odoo hr.attendance)</div>
                  <pre style={{
                    fontSize: 11, color: "var(--color-text-muted)", fontFamily: "'JetBrains Mono', monospace",
                    lineHeight: 1.6, whiteSpace: "pre-wrap",
                  }}>{`Columna "Employee" o "Empleado"    → nombre del trabajador
Columna "Check In" o "Entrada"     → fecha y hora de entrada
Columna "Check Out" o "Salida"     → fecha y hora de salida
Columna "Worked Hours" (opcional)  → horas trabajadas

Los encabezados se detectan automáticamente
sin importar mayúsculas o tildes.`}</pre>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* --- SETTINGS MODAL --- */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ width: "75vw", maxWidth: "1200px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}>Configuración de Horarios</div>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 4 }}>
                <Icons.X />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6, fontWeight: 500 }}>
                      <Icons.Clock /> Hora de Entrada Programada
                    </label>
                    <input type="time" className="input-field" value={config.entryTime}
                      onChange={e => setConfig({ ...config, entryTime: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6, fontWeight: 500 }}>
                      <Icons.Clock /> Hora de Salida Programada
                    </label>
                    <input type="time" className="input-field" value={config.exitTime}
                      onChange={e => setConfig({ ...config, exitTime: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6, fontWeight: 500 }}>
                      Minutos de Tolerancia (aún cuenta como "a tiempo")
                    </label>
                    <input type="number" className="input-field" value={config.toleranceMinutes}
                      onChange={e => setConfig({ ...config, toleranceMinutes: Number(e.target.value) })} />
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                      Entrada hasta las {(() => {
                        const [h, m] = config.entryTime.split(":").map(Number);
                        const total = h * 60 + m + config.toleranceMinutes;
                        return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
                      })()} se considera a tiempo
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6, fontWeight: 500 }}>
                      Umbral de Retardo Mayor (minutos después de la entrada)
                    </label>
                    <input type="number" className="input-field" value={config.lateThresholdMinutes}
                      onChange={e => setConfig({ ...config, lateThresholdMinutes: Number(e.target.value) })} />
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                      Después de {config.lateThresholdMinutes} min se clasifica como retardo mayor
                    </div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6, fontWeight: 500 }}>
                      Horas de Trabajo por Día (jornada estándar)
                    </label>
                    <input type="number" step="0.5" className="input-field" value={config.workingHoursPerDay}
                      onChange={e => setConfig({ ...config, workingHoursPerDay: Number(e.target.value) })} />
                  </div>
                </div>

                <div style={{
                  padding: 16, borderRadius: 12,
                  background: "rgba(99,132,255,0.04)", border: "1px solid rgba(99,132,255,0.08)",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", marginBottom: 8 }}>Resumen de Clasificación</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.8 }}>
                    <span className="badge badge-green" style={{ marginRight: 8 }}>A Tiempo</span> Entrada ≤ {config.entryTime} + {config.toleranceMinutes} min<br />
                    <span className="badge badge-amber" style={{ marginRight: 8 }}>Retardo</span> Entrada entre +{config.toleranceMinutes} y +{config.lateThresholdMinutes} min<br />
                    <span className="badge badge-red" style={{ marginRight: 8 }}>Ret. Mayor</span> Entrada {">"} +{config.lateThresholdMinutes} min
                  </div>
                </div>
              </div>

              <div style={{
                padding: 16, borderRadius: 12,
                background: "rgba(99,132,255,0.03)", border: "1px solid rgba(99,132,255,0.08)",
              }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", marginBottom: 12 }}>
                Reglas Laborales (Reglamento)
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10 }}>
                La tolerancia de llegada se toma desde “Configuración de Horarios” para evitar duplicidad.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ border: "1px solid rgba(99,132,255,0.08)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-soft)", marginBottom: 8 }}>Reglas de retardos</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>¿Desde qué llegada tarde cuenta retardo formal?</label>
                      <input type="number" className="input-field" value={laborRules.lateFormalFromNthInMonth}
                        onChange={e => setLaborRules({ ...laborRules, lateFormalFromNthInMonth: Number(e.target.value) })} />
                      <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 3 }}>Ejemplo: 4 = la 4ta llegada tarde ya cuenta formal.</div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>¿Desde qué número de retardos se levanta acta?</label>
                      <input type="number" className="input-field" value={laborRules.formalLateActaAtNth}
                        onChange={e => setLaborRules({ ...laborRules, formalLateActaAtNth: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>¿Cuántas actas en un año causan rescisión?</label>
                      <input type="number" className="input-field" value={laborRules.actasForTerminationInYear}
                        onChange={e => setLaborRules({ ...laborRules, actasForTerminationInYear: Number(e.target.value) })} />
                    </div>
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--color-text-muted)", marginTop: 10 }}>
                    <input
                      type="checkbox"
                      checked={laborRules.directLateAfterTolerance}
                      onChange={e => setLaborRules({ ...laborRules, directLateAfterTolerance: e.target.checked })}
                    />
                    Contar como retardo directo cuando se rebasa la tolerancia
                  </label>
                </div>

                <div style={{ border: "1px solid rgba(99,132,255,0.08)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-soft)", marginBottom: 8 }}>Reglas de faltas</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Horas máximas para justificar una falta</label>
                      <input type="number" className="input-field" value={laborRules.absenceJustificationDeadlineHours}
                        onChange={e => setLaborRules({ ...laborRules, absenceJustificationDeadlineHours: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Rescisión por faltas injustificadas desde #</label>
                      <input type="number" className="input-field" value={laborRules.absenceTerminationFromCount}
                        onChange={e => setLaborRules({ ...laborRules, absenceTerminationFromCount: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Días de suspensión por 1 falta</label>
                      <input type="number" className="input-field" value={laborRules.absenceSuspensionDays1}
                        onChange={e => setLaborRules({ ...laborRules, absenceSuspensionDays1: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Días de suspensión por 2 faltas</label>
                      <input type="number" className="input-field" value={laborRules.absenceSuspensionDays2}
                        onChange={e => setLaborRules({ ...laborRules, absenceSuspensionDays2: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Días de suspensión por 3 faltas</label>
                      <input type="number" className="input-field" value={laborRules.absenceSuspensionDays3}
                        onChange={e => setLaborRules({ ...laborRules, absenceSuspensionDays3: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Días extra por reincidencia</label>
                      <input type="number" className="input-field" value={laborRules.repeatOffenseExtraSuspensionDays}
                        onChange={e => setLaborRules({ ...laborRules, repeatOffenseExtraSuspensionDays: Number(e.target.value) })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>

            {settingsError && (
              <div style={{
                marginTop: 14,
                fontSize: 12,
                color: "#fda4af",
                background: "rgba(127,29,29,0.25)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                {settingsError}
              </div>
            )}

            <button className="btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "center" }}
              onClick={() => void handleSaveSettings()}
              disabled={settingsSaving}>
              {settingsSaving ? "Guardando..." : "Guardar Configuración"}
            </button>
          </div>
        </div>
      )}

      {/* --- CHAT FAB --- */}
      <button
        className="chat-fab"
        onClick={() => setShowChat((v) => !v)}
        title="Asistente IA"
      >
        {showChat ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
      </button>

      {/* --- CHAT PANEL --- */}
      {showChat && (
        <div className="chat-panel">
          {/* Header */}
          <div style={{
            padding: "16px 20px", borderBottom: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #6384ff, #5a6fff)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>Asistente IA</div>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "var(--color-text-muted)" }}>chat + BBDD</span>
                {attendanceJson ? (
                  <span style={{ color: "#34d399" }}>· JSON listo ✓</span>
                ) : (
                  <span style={{ color: "#f59e0b" }}>· sin datos</span>
                )}
              </div>
            </div>
            {attendanceJson && (
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(attendanceJson, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `asistencias_${attendanceJson.generado}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  background: "var(--color-pill-active-bg)", border: "1px solid var(--color-border-strong)",
                  borderRadius: 7, padding: "4px 8px", color: "var(--color-link)",
                  cursor: "pointer", fontSize: 10, fontFamily: "inherit",
                }}
                title="Descargar JSON"
              >
                ↓ JSON
              </button>
            )}
            {chatMessages.length > 0 && (
              <button
                onClick={() => { setChatMessages([]); setChatError(null); }}
                style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 4, fontSize: 11 }}
                title="Limpiar chat"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Mensajes */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "16px 16px 8px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            {/* Estado vacío */}
            {chatMessages.length === 0 && (
              <div style={{ textAlign: "center", margin: "auto", padding: "0 16px" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>
                  {records.length === 0
                    ? "Carga datos primero"
                    : "¿En qué puedo ayudarte?"}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                  {records.length === 0
                    ? "Sube un archivo .xlsx para poder analizar asistencias."
                    : "Pregúntame sobre puntualidad, retardos, horas trabajadas o cualquier análisis del historial guardado en la base de datos."}
                </div>
                {records.length > 0 && (
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                    {[
                      "¿Quién tuvo más retardos?",
                      "Dame un resumen ejecutivo",
                      "¿Cuál es el promedio de horas trabajadas?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setChatInput(q); }}
                        style={{
                          background: "rgba(99,132,255,0.08)",
                          border: "1px solid rgba(99,132,255,0.15)",
                          borderRadius: 8, padding: "7px 12px",
                          color: "#818cf8", fontSize: 12, cursor: "pointer",
                          textAlign: "left", fontFamily: "inherit",
                          transition: "all 0.2s",
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Burbujas */}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={msg.role === "user" ? "chat-msg-user" : "chat-msg-model"}
              >
                {msg.role === "user" ? msg.text : renderMarkdown(msg.text)}
              </div>
            ))}

            {/* Indicador de carga */}
            {isChatLoading && (
              <div className="chat-msg-model" style={{ display: "flex", gap: 5, alignItems: "center", padding: "12px 14px" }}>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}

            {/* Error */}
            {chatError && (
              <div style={{
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f87171",
              }}>
                {chatError}
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Input */}
          <div className="chat-input-row">
            <textarea
              className="chat-input"
              rows={1}
              placeholder={records.length === 0 ? "Carga datos para comenzar..." : "Escribe tu pregunta..."}
              value={chatInput}
              disabled={records.length === 0 || isChatLoading}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              style={{ height: 38, lineHeight: "1.4" }}
            />
            <button
              className="chat-send-btn"
              onClick={sendChatMessage}
              disabled={!chatInput.trim() || isChatLoading || records.length === 0}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* --- UPLOAD MODAL --- */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => { if (!isUploading) setShowUpload(false); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}>Importar Archivo de Odoo</div>
              <button onClick={() => { if (!isUploading) setShowUpload(false); }}
                style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", padding: 4 }}>
                <Icons.X />
              </button>
            </div>

            {/* Hidden real file input */}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            <div className="upload-zone" onClick={handlePickFile} style={{ opacity: isUploading ? 0.6 : 1, pointerEvents: isUploading ? "none" : "auto" }}>
              <div style={{ color: "#6384ff", marginBottom: 12 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
                {isUploading ? "Procesando..." : "Haz clic para seleccionar tu archivo .xlsx"}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {isUploading ? <span className="pulse">Leyendo y normalizando datos...</span> : "o arrastra aquí"}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 12 }}>
                Formato esperado: Reporte de Asistencia de Odoo (hr.attendance)
              </div>
            </div>

            {/* Upload result / instructions */}
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: uploadError ? "rgba(239,68,68,0.06)" : uploadSummary ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)", border: `1px solid ${uploadError ? "rgba(239,68,68,0.15)" : uploadSummary ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.12)"}` }}>
              {uploadError ? (
                <>
                  <div style={{ fontSize: 12, color: "#f87171", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Alert /> Error de importación
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{uploadError}</div>
                </>
              ) : uploadSummary ? (
                <>
                  <div style={{ fontSize: 12, color: "#34d399", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Check /> Importación completada
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#34d399" }}>
                      <Icons.Check /> Archivo: {uploadSummary.fileName}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#34d399" }}>
                      <Icons.Check /> Total filas leídas: {uploadSummary.totalRows}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#34d399" }}>
                      <Icons.Check /> Registros válidos: {uploadSummary.validRows}
                    </div>
                    {uploadSummary.invalidRows > 0 && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#fbbf24" }}>
                        <Icons.Alert /> Filas inválidas omitidas: {uploadSummary.invalidRows}
                      </div>
                    )}
                    {uploadSummary.duplicates > 0 && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#fbbf24" }}>
                        <Icons.Alert /> Duplicados omitidos: {uploadSummary.duplicates}
                      </div>
                    )}
                    {(uploadSummary.skippedExisting ?? 0) > 0 && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#fbbf24" }}>
                        <Icons.Alert /> Ya existentes en BD omitidos: {uploadSummary.skippedExisting}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#34d399" }}>
                      <Icons.Check /> {uploadSummary.employeesDetected} empleados identificados
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Alert /> Proceso de Importación
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                    1. Se leerán las filas con datos (ignorando subtotales y encabezados)<br />
                    2. Se limpiarán nombres y se normalizarán fechas/horas<br />
                    3. Se detectarán duplicados (empleado + fecha + hora de entrada)<br />
                    4. Los KPIs se recalcularán en tiempo real
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
