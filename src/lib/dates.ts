/**
 * Utilidades de fechas compartidas por la SPA.
 * Mantener una sola fuente de verdad para evitar divergencias
 * en cálculos de calendario laboral.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Devuelve los días `YYYY-MM-DD` de lunes a viernes en el rango [from, to] inclusive.
 * Equivalente al cálculo en backend (`WorkingCalendarService::listWeekdays`).
 */
export function listWeekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) {
      out.push(toIsoDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
