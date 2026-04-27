import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import {
  createEmployeeAbsence,
  getLeaveBalance,
  updateEmployeeAbsence,
  type EmployeeAbsence,
  type LeaveBalance,
} from "../../api";
import { useAbsenceTypes } from "./useAbsenceTypes";
import styles from "./absences.module.css";

const absenceFormSchema = z
  .object({
    employeeId: z.coerce.number().int().positive("Empleado obligatorio"),
    absenceTypeId: z.coerce.number().int().positive("Tipo de ausencia obligatorio"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Fecha inválida"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Fecha inválida"),
    reason: z.string().max(500, "Máximo 500 caracteres").optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "La fecha de inicio no puede ser mayor que la de fin.",
    path: ["endDate"],
  });

type Employee = { id: number; name: string };

type Props = {
  open: boolean;
  /** Si viene definido, el diálogo actúa en modo edición (PUT). */
  editRecord: EmployeeAbsence | null;
  onClose: () => void;
  onSuccess: () => void;
  employees: Employee[];
};

export function AbsenceFormDialog({ open, editRecord, onClose, onSuccess, employees }: Props) {
  const { types, loading: typesLoading, error: typesError } = useAbsenceTypes();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [forceClosed, setForceClosed] = useState(false);

  const isEdit = editRecord !== null;

  useEffect(() => {
    if (!open) {
      setFormError(null);
      setPending(false);
      setForceClosed(false);
      return;
    }
    if (editRecord) {
      setSelectedEmployee(editRecord.employeeId);
      setSelectedType(editRecord.absenceTypeId);
      setStartDate(editRecord.startDate);
    } else {
      setSelectedEmployee(null);
      setSelectedType(null);
      setStartDate("");
    }
  }, [open, editRecord]);

  const selectedTypeInfo = useMemo(
    () => types.find((t) => t.id === selectedType) ?? null,
    [types, selectedType],
  );

  useEffect(() => {
    if (!open || !selectedEmployee || !selectedTypeInfo?.affectsLeaveBalance) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const b = await getLeaveBalance({ employeeId: selectedEmployee, asOf: startDate || undefined });
        if (active) setBalance(b);
      } catch {
        if (active) setBalance(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, selectedEmployee, selectedTypeInfo, startDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = absenceFormSchema.safeParse({
      employeeId: fd.get("employeeId"),
      absenceTypeId: fd.get("absenceTypeId"),
      startDate: fd.get("startDate"),
      endDate: fd.get("endDate"),
      reason: String(fd.get("reason") ?? "").trim() || undefined,
      notes: String(fd.get("notes") ?? "").trim() || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Datos inválidos");
      return;
    }

    setPending(true);
    try {
      if (editRecord) {
        await updateEmployeeAbsence(editRecord.id, {
          employeeId: parsed.data.employeeId,
          absenceTypeId: parsed.data.absenceTypeId,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          reason: parsed.data.reason,
          notes: parsed.data.notes,
          forceClosedPeriod: forceClosed || undefined,
        });
      } else {
        await createEmployeeAbsence({
          employeeId: parsed.data.employeeId,
          absenceTypeId: parsed.data.absenceTypeId,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          reason: parsed.data.reason,
          notes: parsed.data.notes,
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Error al guardar";
      setFormError(raw);
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;

  const formKey = editRecord ? `edit-${editRecord.id}` : "create";

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="abs-dialog-title" className={styles["abs-modal"]} ref={dialogRef}>
      <div className={styles["abs-modal__backdrop"]} onClick={onClose} />
      <div className={styles["abs-modal__content"]}>
        <h2 id="abs-dialog-title">{isEdit ? "Corregir solicitud" : "Nueva ausencia"}</h2>
        {isEdit && (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 8px 0" }}>
            Estado actual: <strong>{editRecord.status}</strong>
            {editRecord.status === "approved"
              ? " — los cambios se reflejan en saldos LFT y reportes."
              : null}
          </p>
        )}

        {typesError && <div className={styles["abs-error"]}>{typesError}</div>}

        <form key={formKey} onSubmit={(ev) => void handleSubmit(ev)} className={styles["abs-modal__form"]}>
          <label className={styles["abs-modal__field"]}>
            Empleado
            <select
              name="employeeId"
              required
              value={selectedEmployee ?? ""}
              onChange={(e) => setSelectedEmployee(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="" disabled>
                Seleccionar...
              </option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles["abs-modal__field"]}>
            Tipo de ausencia
            <select
              name="absenceTypeId"
              required
              disabled={typesLoading}
              value={selectedType ?? ""}
              onChange={(e) => setSelectedType(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="" disabled>
                {typesLoading ? "Cargando..." : "Seleccionar..."}
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {balance && selectedTypeInfo?.affectsLeaveBalance && (
            <div className={styles["abs-balance-hint"]}>
              Saldo disponible: <b>{balance.availableDays.toFixed(2)} días</b> (de {balance.entitledDays} otorgados,{" "}
              {balance.usedDays} usados).
            </div>
          )}

          <div className={styles["abs-modal__row"]}>
            <label className={styles["abs-modal__field"]}>
              Fecha inicio
              <input
                type="date"
                name="startDate"
                required
                defaultValue={editRecord?.startDate ?? ""}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className={styles["abs-modal__field"]}>
              Fecha fin
              <input type="date" name="endDate" required defaultValue={editRecord?.endDate ?? ""} />
            </label>
          </div>

          <label className={styles["abs-modal__field"]}>
            Motivo
            <textarea
              name="reason"
              maxLength={500}
              rows={2}
              placeholder="Opcional"
              defaultValue={editRecord?.reason ?? ""}
            />
          </label>

          <label className={styles["abs-modal__field"]}>
            Notas internas
            <textarea name="notes" rows={2} placeholder="Opcional" defaultValue={editRecord?.notes ?? ""} />
          </label>

          {isEdit && (
            <label className={styles["abs-modal__field"]} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={forceClosed} onChange={(e) => setForceClosed(e.target.checked)} />
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Forzar si cruza quincena cerrada (solo administrador; el servidor validará el rol).
              </span>
            </label>
          )}

          {formError && (
            <div role="alert" className={styles["abs-error"]}>
              {formError}
            </div>
          )}

          <div className={styles["abs-modal__actions"]}>
            <button type="button" onClick={onClose} className={`${styles["abs-btn"]} ${styles["abs-btn--ghost"]}`}>
              Cerrar
            </button>
            <button type="submit" disabled={pending} className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}>
              {pending ? "Guardando..." : isEdit ? "Guardar cambios" : "Solicitar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
