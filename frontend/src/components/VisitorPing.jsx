import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api, newKey } from "@/lib/api";

const sid = () => {
  let v = localStorage.getItem("oe_vid");
  if (!v || v.length < 16) { v = `${newKey()}${newKey()}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 48); localStorage.setItem("oe_vid", v); }
  return v;
};

const pageOf = (p) => (p.startsWith("/pulse") ? "pulse" : p.startsWith("/oddy-nacho") ? "oddeven" : "other");

export const VisitorPing = () => {
  const { pathname } = useLocation();
  const page = pageOf(pathname);
  useEffect(() => {
    const ping = () => !document.hidden && api.post("/presence/ping", { sid: sid(), page }).catch(() => {});
    ping();
    const t = setInterval(ping, 20000);
    document.addEventListener("visibilitychange", ping);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", ping); };
  }, [page]);
  return null;
};
