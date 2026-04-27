import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type EmployeeProfile,
  type EmployeeProfileUpdate,
  type Organization,
  getEmployeeProfile,
  getOrganizations,
  setEmployeeCredential,
  updateEmployeeProfile,
} from "../../api";
import styles from "./employees.module.css";

type Props = {
  employeeId: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (employee: EmployeeProfile) => void;
};

type FormState = {
  name: string;
  employeeCode: string;
  email: string;
  phone: string;
  position: string;
  birthdate: string;
  hireDate: string;
  terminationDate: string;
  organizationId: string;
  isActive: boolean;
  notes: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    employeeCode: "",
    email: "",
    phone: "",
    position: "",
    birthdate: "",
    hireDate: "",
    terminationDate: "",
    organizationId: "",
    isActive: true,
    notes: "",
  };
}

function profileToForm(p: EmployeeProfile): FormState {
  return {
    name: p.name ?? "",
    employeeCode: p.employeeCode ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    position: p.position ?? "",
    birthdate: p.birthdate ?? "",
    hireDate: p.hireDate ?? "",
    terminationDate: p.terminationDate ?? "",
    organizationId: p.organizationId !== null && p.organizationId !== undefined ? String(p.organizationId) : "",
    isActive: p.isActive,
    notes: p.notes ?? "",
  };
}

function diffForm(original: FormState, current: FormState): EmployeeProfileUpdate {
  const out: EmployeeProfileUpdate = {};
  if (original.name !== current.name) out.name = current.name;
  if (original.employeeCode !== current.employeeCode) out.employeeCode = current.employeeCode;
  if (original.email !== current.email) out.email = current.email;
  if (original.phone !== current.phone) out.phone = current.phone;
  if (original.position !== current.position) out.position = current.position;
  if (original.birthdate !== current.birthdate) out.birthdate = current.birthdate;
  if (original.hireDate !== current.hireDate) out.hireDate = current.hireDate;
  if (original.terminationDate !== current.terminationDate) out.terminationDate = current.terminationDate;
  if (original.organizationId !== current.organizationId) {
    out.organizationId = current.organizationId === "" ? null : Number(current.organizationId);
  }
  if (original.isActive !== current.isActive) out.isActive = current.isActive;
  if (original.notes !== current.notes) out.notes = current.notes;
  return out;
}

function calcSeniorityYears(hireDate: string | null, ref?: Date): number | null {
  if (!hireDate) return null;
  const start = new Date(hireDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = ref ?? new Date();
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  const years = ms / (365.25 * 24 * 60 * 60 * 1000);
  return Math.round(years * 100) / 100;
}

export function EmployeeProfileDrawer({ employeeId, open, onClose, onSaved }: Props) {
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [original, setOriginal] = useState<FormState>(emptyForm());
  const [form, setForm] = useState<FormState>(emptyForm());
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pinCode, setPinCode] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinFeedback, setPinFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reset = useCallback(() => {
    setProfile(null);
    setOriginal(emptyForm());
    setForm(emptyForm());
    setError(null);
    setSuccess(null);
    setPinCode("");
    setPinValue("");
    setPinFeedback(null);
  }, []);

  const load = useCallback(async () => {
    if (employeeId === null) return;
    setLoading(true);
    setError(null);
    try {
      const [p, orgList] = await Promise.all([
        getEmployeeProfile(employeeId),
        getOrganizations().catch(() => [] as Organization[]),
      ]);
      const fs = profileToForm(p);
      setProfile(p);
      setOriginal(fs);
      setForm(fs);
      setOrgs(orgList);
      setPinCode(p.employeeCode ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el perfil.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (open && employeeId !== null) {
      void load();
    } else if (!open) {
      reset();
    }
  }, [open, employeeId, load, reset]);

  const dirty = useMemo(() => Object.keys(diffForm(original, form)).length > 0, [original, form]);

  const seniority = useMemo(() => calcSeniorityYears(form.hireDate || null), [form.hireDate]);

  const handleField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSuccess(null);
  };

  const handleSave = async () => {
    if (employeeId === null) return;
    const payload = diffForm(original, form);
    if (Object.keys(payload).length === 0) {
      setSuccess("Sin cambios.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateEmployeeProfile(employeeId, payload);
      const fs = profileToForm(updated);
      setProfile(updated);
      setOriginal(fs);
      setForm(fs);
      setSuccess("Perfil actualizado correctamente.");
      onSaved?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePin = async () => {
    if (employeeId === null) return;
    if (!pinCode.trim() || !pinValue.trim() || pinValue.trim().length < 4) {
      setPinFeedback({ kind: "err", text: "Código y PIN (mínimo 4 dígitos) son obligatorios." });
      return;
    }
    setPinSaving(true);
    setPinFeedback(null);
    try {
      const res = await setEmployeeCredential(employeeId, {
        employeeCode: pinCode.trim(),
        pin: pinValue.trim(),
      });
      setPinFeedback({ kind: "ok", text: `PIN guardado para ${res.employeeCode}.` });
      setPinValue("");
      if (profile) {
        const updated: EmployeeProfile = {
          ...profile,
          employeeCode: res.employeeCode,
          hasCredential: true,
        };
        setProfile(updated);
        const fs = profileToForm(updated);
        setOriginal(fs);
        setForm(fs);
      }
    } catch (e) {
      setPinFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : "No se pudo guardar el PIN.",
      });
    } finally {
      setPinSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className={styles["epd-overlay"]}
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div className={styles["epd-backdrop"]} />
      <aside
        className={styles["epd-panel"]}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles["epd-header"]}>
          <div>
            <h3 className={styles["epd-title"]}>
              {loading ? "Cargando…" : (profile?.name ?? "Empleado")}
            </h3>
            <div className={styles["epd-subtitle"]}>
              {profile?.position ? profile.position + " · " : ""}
              {profile?.organizationName ?? "Sin organización"}
            </div>
          </div>
          <button
            type="button"
            className={styles["epd-close"]}
            onClick={onClose}
            aria-label="Cerrar"
            disabled={saving}
          >
            ×
          </button>
        </header>

        {error && <div className={styles["epd-error"]}>{error}</div>}
        {success && <div className={styles["epd-success"]}>{success}</div>}

        <section className={styles["epd-section"]}>
          <h4 className={styles["epd-section-title"]}>Datos generales</h4>
          <div className={styles["epd-grid"]}>
            <Field label="Nombre completo">
              <input
                value={form.name}
                onChange={(e) => handleField("name", e.target.value)}
                placeholder="Nombre"
              />
            </Field>
            <Field label="Código de empleado">
              <input
                value={form.employeeCode}
                onChange={(e) => handleField("employeeCode", e.target.value.toUpperCase())}
                placeholder="EMP001"
              />
            </Field>
            <Field label="Puesto / Cargo">
              <input
                value={form.position}
                onChange={(e) => handleField("position", e.target.value)}
                placeholder="Recepcionista, Auxiliar, etc."
              />
            </Field>
            <Field label="Organización">
              <select
                value={form.organizationId}
                onChange={(e) => handleField("organizationId", e.target.value)}
              >
                <option value="">Sin asignar</option>
                {orgs.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleField("email", e.target.value)}
                placeholder="empleado@empresa.com"
              />
            </Field>
            <Field label="Teléfono">
              <input
                value={form.phone}
                onChange={(e) => handleField("phone", e.target.value)}
                placeholder="555 555 5555"
              />
            </Field>
          </div>
        </section>

        <section className={styles["epd-section"]}>
          <h4 className={styles["epd-section-title"]}>
            Datos para cálculos (LFT, antigüedad, saldos)
          </h4>
          <div className={styles["epd-grid"]}>
            <Field label="Fecha de contratación (hire_date)" hint="Base para antigüedad y saldos LFT">
              <input
                type="date"
                value={form.hireDate}
                onChange={(e) => handleField("hireDate", e.target.value)}
              />
            </Field>
            <Field label="Fecha de término (termination_date)" hint="Vacío si sigue activo">
              <input
                type="date"
                value={form.terminationDate}
                onChange={(e) => handleField("terminationDate", e.target.value)}
              />
            </Field>
            <Field label="Fecha de nacimiento">
              <input
                type="date"
                value={form.birthdate}
                onChange={(e) => handleField("birthdate", e.target.value)}
              />
            </Field>
            <Field label="Estado">
              <label className={styles["epd-toggle"]}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => handleField("isActive", e.target.checked)}
                />
                <span>{form.isActive ? "Activo" : "Inactivo"}</span>
              </label>
            </Field>
          </div>
          {seniority !== null && (
            <div className={styles["epd-hint"]}>
              Antigüedad calculada: <strong>{seniority} años</strong> (a hoy)
            </div>
          )}
        </section>

        <section className={styles["epd-section"]}>
          <h4 className={styles["epd-section-title"]}>Notas internas</h4>
          <textarea
            className={styles["epd-textarea"]}
            value={form.notes}
            onChange={(e) => handleField("notes", e.target.value)}
            rows={4}
            placeholder="Información adicional, observaciones, acuerdos especiales…"
          />
        </section>

        <section className={styles["epd-section"]}>
          <h4 className={styles["epd-section-title"]}>
            Credencial Kiosko (PIN){" "}
            {profile?.hasCredential && (
              <span className={styles["epd-badge-ok"]}>configurado</span>
            )}
          </h4>
          <div className={styles["epd-grid"]}>
            <Field label="Código del empleado para Kiosko">
              <input
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.toUpperCase())}
                placeholder="EMP001"
              />
            </Field>
            <Field label="Nuevo PIN (mín. 4 dígitos)">
              <input
                type="password"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                placeholder="••••"
                maxLength={12}
              />
            </Field>
          </div>
          <div className={styles["epd-actions-inline"]}>
            <button
              type="button"
              className={styles["epd-btn-secondary"]}
              onClick={handleSavePin}
              disabled={pinSaving}
            >
              {pinSaving ? "Guardando…" : profile?.hasCredential ? "Actualizar PIN" : "Asignar PIN"}
            </button>
            {pinFeedback && (
              <span
                className={
                  pinFeedback.kind === "ok"
                    ? styles["epd-feedback-ok"]
                    : styles["epd-feedback-err"]
                }
              >
                {pinFeedback.text}
              </span>
            )}
          </div>
        </section>

        <footer className={styles["epd-footer"]}>
          <button
            type="button"
            className={styles["epd-btn-ghost"]}
            onClick={onClose}
            disabled={saving}
          >
            Cerrar
          </button>
          <button
            type="button"
            className={styles["epd-btn-primary"]}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles["epd-field"]}>
      <span className={styles["epd-field-label"]}>{label}</span>
      {children}
      {hint && <span className={styles["epd-field-hint"]}>{hint}</span>}
    </label>
  );
}
