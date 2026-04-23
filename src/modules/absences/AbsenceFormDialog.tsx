import { useActionState, useEffect, useRef } from "react";
import { createEmployeeAbsence } from "../../api";
import { useAbsenceTypes } from "./useAbsenceTypes";
import styles from "./absences.module.css";

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
      const employeeIdRaw = formData.get("employeeId");
      const absenceTypeIdRaw = formData.get("absenceTypeId");
      const startDate = String(formData.get("startDate") ?? "");
      const endDate = String(formData.get("endDate") ?? "");
      const reason = String(formData.get("reason") ?? "").trim();
      const notes = String(formData.get("notes") ?? "").trim();

      if (!employeeIdRaw || !absenceTypeIdRaw || !startDate || !endDate) {
        return { ok: false, error: "Todos los campos obligatorios deben llenarse." };
      }
      if (startDate > endDate) {
        return { ok: false, error: "La fecha de inicio no puede ser mayor que la de fin." };
      }

      try {
        const res = await createEmployeeAbsence({
          employeeId: Number(employeeIdRaw),
          absenceTypeId: Number(absenceTypeIdRaw),
          startDate,
          endDate,
          reason: reason || undefined,
          notes: notes || undefined,
        });
        onCreated(res.id);
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Error al guardar" };
      }
    },
    INITIAL_STATE,
  );

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
            <select name="employeeId" required defaultValue="">
              <option value="" disabled>Seleccionar...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>

          <label className={styles["abs-modal__field"]}>
            Tipo de ausencia
            <select name="absenceTypeId" required disabled={typesLoading} defaultValue="">
              <option value="" disabled>
                {typesLoading ? "Cargando..." : "Seleccionar..."}
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          <div className={styles["abs-modal__row"]}>
            <label className={styles["abs-modal__field"]}>
              Fecha inicio
              <input type="date" name="startDate" required />
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
