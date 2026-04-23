import type { AbsenceStatus } from "../../api";
import styles from "./absences.module.css";

const LABELS: Record<AbsenceStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  superseded: "Reemplazada",
};

const STATUS_CLASSES: Record<AbsenceStatus, string> = {
  pending: styles["abs-status--pending"],
  approved: styles["abs-status--approved"],
  rejected: styles["abs-status--rejected"],
  cancelled: styles["abs-status--cancelled"],
  superseded: styles["abs-status--superseded"],
};

type Props = { status: AbsenceStatus };

export function AbsenceStatusBadge({ status }: Props) {
  return (
    <span className={`${styles["abs-status"]} ${STATUS_CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
