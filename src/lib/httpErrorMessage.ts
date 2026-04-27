/**
 * Convierte el cuerpo textual de una respuesta HTTP de error en un mensaje legible.
 * Evita mostrar JSON crudo o el literal `""` cuando el backend devuelve cadenas vacías codificadas en JSON.
 */
export function formatHttpErrorResponse(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (
    trimmed === "" ||
    trimmed === '""' ||
    trimmed === "''" ||
    trimmed === "null" ||
    trimmed === "undefined"
  ) {
    return status === 0
      ? "No hubo respuesta del servidor (revisa la conexión y VITE_API_BASE_URL)."
      : `Error HTTP ${status} sin mensaje del servidor.`;
  }

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    return `El servidor respondió con HTML (HTTP ${status}). Comprueba que VITE_API_BASE_URL apunte al backend (por ejemplo http://localhost:8080).`;
  }

  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;

    const err = j.error;
    if (typeof err === "string" && err.trim() && !/^\d+$/.test(err)) {
      return err.trim();
    }

    const msg = j.message;
    if (typeof msg === "string" && msg.trim()) {
      return msg.trim();
    }

    const messages = j.messages;
    if (typeof messages === "string" && messages.trim()) {
      return messages.trim();
    }
    if (Array.isArray(messages)) {
      const parts = messages
        .map((m) => (typeof m === "string" ? m.trim() : String(m)))
        .filter((s) => s.length > 0);
      if (parts.length) return parts.join(" ");
    }
    if (messages && typeof messages === "object" && !Array.isArray(messages)) {
      const parts: string[] = [];
      for (const v of Object.values(messages as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) {
          parts.push(v.trim());
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === "string" && item.trim()) parts.push(item.trim());
          }
        }
      }
      if (parts.length) return parts.join(" ");
    }

    return `Error HTTP ${status}.`;
  } catch {
    if (trimmed.length > 0 && trimmed.length <= 240) {
      return trimmed;
    }
    return `Error HTTP ${status}.`;
  }
}
