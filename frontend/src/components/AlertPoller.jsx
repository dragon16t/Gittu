import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const PATH = { user: "/alerts/poll", verifier: "/verifier/alerts/poll" };

export const AlertPoller = () => {
  const { user, portal } = useSession();
  useEffect(() => {
    if (!user || !PATH[portal]) return;
    const tick = () => api.get(PATH[portal]).then(({ data }) => data.forEach((n) => toast(n.title, { description: n.body }))).catch(() => {});
    tick();
    const t = setInterval(tick, 6000);
    return () => clearInterval(t);
  }, [user, portal]);
  return null;
};
