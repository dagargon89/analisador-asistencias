import { useEffect, useState } from "react";
import { getAbsenceTypes, type AbsenceType } from "../../api";

let cache: AbsenceType[] | null = null;

export function useAbsenceTypes() {
  const [types, setTypes] = useState<AbsenceType[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    getAbsenceTypes()
      .then((t) => {
        if (cancelled) return;
        cache = t;
        setTypes(t);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Error cargando tipos de ausencia");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { types, loading, error };
}

export function invalidateAbsenceTypesCache(): void {
  cache = null;
}
