/**
 * Punto único para la configuración global del frontend.
 * Mantén esta constante como única fuente de verdad para `API_BASE`
 * y reutilízala desde clientes HTTP, vistas, kiosko, etc.
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8080";
