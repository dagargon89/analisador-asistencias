import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createEmployeeAbsence, getLeaveBalance, type LeaveBalance } from "../../api";
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
  onClose: () => void;
  onCreated: (id: number) => void;
  employees: Employee[];
};

type FormState = { ok: boolean; error: string | null };

const INITIAL_STATE: FormState = { ok: false, error: null };

export function AbsenceFormDialog({ open, onClose, onCreated, employees }: Props) {
  const { types, loading: typesLoading, error: typesError } = useAbsenceTypes();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [state, submitAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const parsed = absenceFormSchema.safeParse({
        employeeId: formData.get("employeeId"),
        absenceTypeId: formData.get("absenceTypeId"),
        startDate: formData.get("startDate"),
        endDate: formData.get("endDate"),
        reason: String(formData.get("reason") ?? "").trim() || undefined,
        notes: String(formData.get("notes") ?? "").trim() || undefined,
      });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
      }
      try {
        const res = await createEmployeeAbsence(parsed.data);
        onCreated(res.id);
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Error al guardar" };
      }
    },
    INITIAL_STATE,
  );

  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

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

  useEffect(() => {
    if (open && state.ok) {
      onClose();
    }
  }, [open, state.ok, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="abs-dialog-title" className={styles["abs-modal"]} ref={dialogRef}>
      <div className={styles["abs-modal__backdrop"]} onClick={onClose} />
      <div className={styles["abs-modal__content"]}>
        <h2 id="abs-dialog-title">Nueva ausencia</h2>

        {typesError && <div className={styles["abs-error"]}>{typesError}</div>}

        <form action={submitAction} className={styles["abs-modal__form"]}>
          <label className={styles["abs-modal__field"]}>
            Empleado
            <select
              name="employeeId"
              required
              defaultValue=""
              onChange={(e) => setSelectedEmployee(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="" disabled>Seleccionar...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>

          <label className={styles["abs-modal__field"]}>
            Tipo de ausencia
            <select
              name="absenceTypeId"
              required
              disabled={typesLoading}
              defaultValue=""
              onChange={(e) => setSelectedType(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="" disabled>
                {typesLoading ? "Cargando..." : "Seleccionar..."}
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          {balance && selectedTypeInfo?.affectsLeaveBalance && (
            <div className={styles["abs-balance-hint"]}>
              Saldo disponible: <b>{balance.availableDays.toFixed(2)} días</b> (de {balance.entitledDays} otorgados, {balance.usedDays} usados).
            </div>
          )}

          <div className={styles["abs-modal__row"]}>
            <label className={styles["abs-modal__field"]}>
              Fecha inicio
              <input type="date" name="startDate" required onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className={styles["abs-modal__field"]}>
              Fecha fin
              <input type="date" name="endDate" required />
            </label>
          </div>

          <label className={styles["abs-modal__field"]}>
            Motivo
            <textarea name="reason" maxLength={500} rows={2} placeholder="Opcional" />
          </label>

          <label className={styles["abs-modal__field"]}>
            Notas internas
            <textarea name="notes" rows={2} placeholder="Opcional" />
          </label>

          {state.error && <div role="alert" className={styles["abs-error"]}>{state.error}</div>}

          <div className={styles["abs-modal__actions"]}>
            <button type="button" onClick={onClose} className={`${styles["abs-btn"]} ${styles["abs-btn--ghost"]}`}>
              Cancelar
            </button>
            <button type="submit" disabled={pending} className={`${styles["abs-btn"]} ${styles["abs-btn--primary"]}`}>
              {pending ? "Guardando..." : "Solicitar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
