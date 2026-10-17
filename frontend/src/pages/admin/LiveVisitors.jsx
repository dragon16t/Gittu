import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api } from "@/lib/api";
import { Section } from "./ui";

const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

const Live = ({ label, value, testid }) => (
  <div className="panel !rounded-2xl p-4 flex items-center gap-3" data-testid={testid}>
    <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" /></span>
    <div><div className="text-xs text-neutral-400">{label}</div><div className="text-2xl font-black">{value ?? "—"}</div></div>
  </div>
);

export default function LiveVisitors() {
  const [live, setLive] = useState(null);
  const [hist, setHist] = useState([]);
  useEffect(() => {
    const l = () => api.get("/admin/live").then(({ data }) => setLive(data)).catch(() => {});
    const h = () => api.get("/admin/visitors/history").then(({ data }) => setHist(data.map((r) => ({ ...r, t: hhmm(r.at) })))).catch(() => {});
    l(); h();
    const a = setInterval(l, 10000), b = setInterval(h, 60000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  return (
    <Section title="Live visitors" testid="admin-live-visitors" actions={<span className="text-xs text-neutral-500">refreshes every 10s</span>}>
      <div className="grid grid-cols-2 gap-3">
        <Live label="Visitors online now" value={live?.visitors} testid="live-visitors-count" />
        <Live label="Logged-in players now" value={live?.players} testid="live-players-count" />
      </div>
      <div className="panel !rounded-2xl p-4 h-64" data-testid="visitor-graph">
        <div className="text-xs text-neutral-400 mb-2">Last 24 hours (5-minute samples)</div>
        {hist.length < 2 ? <div className="text-neutral-500 text-sm py-16 text-center">Collecting data… the graph fills in every 5 minutes.</div> : (
          <ResponsiveContainer width="100%" height="88%">
            <AreaChart data={hist} margin={{ left: -20, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffffff" stopOpacity={0.35} /><stop offset="100%" stopColor="#ffffff" stopOpacity={0} /></linearGradient>
                <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.35} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="t" tick={{ fill: "#737373", fontSize: 10 }} minTickGap={30} />
              <YAxis allowDecimals={false} tick={{ fill: "#737373", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12, fontSize: 12 }} />
              <Area type="monotone" dataKey="visitors" name="Visitors" stroke="#e5e5e5" fill="url(#gv)" strokeWidth={2} />
              <Area type="monotone" dataKey="players" name="Players" stroke="#34d399" fill="url(#gp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Section>
  );
}
