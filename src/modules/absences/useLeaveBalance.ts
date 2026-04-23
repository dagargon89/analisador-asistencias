import { useCallback, useEffect, useState } from "react";
import { getLeaveBalance, type LeaveBalance } from "../../api";

export function useLeaveBalance(employeeId: number | null, asOf?: string) {
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!employeeId) {
      setBalance(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const b = await getLeaveBalance({ employeeId, asOf });
      setBalance(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar saldo");
    } finally {
      setLoading(false);
    }
  }, [employeeId, asOf]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balance, loading, error, refresh };
}
