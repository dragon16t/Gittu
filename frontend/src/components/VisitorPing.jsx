import { useEffect } from "react";
import { api, newKey } from "@/lib/api";

const sid = () => {
  let v = localStorage.getItem("oe_vid");
  if (!v || v.length < 16) { v = `${newKey()}${newKey()}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 48); localStorage.setItem("oe_vid", v); }
  return v;
};

export const VisitorPing = () => {
  useEffect(() => {
    const ping = () => !document.hidden && api.post("/presence/ping", { sid: sid() }).catch(() => {});
    ping();
    const t = setInterval(ping, 20000);
    document.addEventListener("visibilitychange", ping);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", ping); };
  }, []);
  return null;
};
