import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

const ME = { user: "/auth/me", verifier: "/verifier/auth/me", admin: "/admin/auth/me", partner: "/partner/auth/me" };
const SessionCtx = createContext(null);

export function SessionProvider({ portal, children }) {
  const [user, setUser] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(ME[portal]);
      setUser(data);
    } catch {
      setUser(false);
    }
  }, [portal]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return <SessionCtx.Provider value={{ user, setUser, refresh, portal }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
