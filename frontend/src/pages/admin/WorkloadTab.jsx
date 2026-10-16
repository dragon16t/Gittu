import { useEffect, useState } from "react";
import { api, inr } from "@/lib/api";
import { Stat } from "@/components/common";
import { DataTable, Section } from "./ui";

const Load = ({ n, warn = 3 }) => (
  <span className={`mono font-bold ${n >= warn ? "text-red-400" : n > 0 ? "text-amber-200" : "text-neutral-500"}`}>{n}</span>
);

export default function WorkloadTab() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api.get("/admin/workload").then(({ data }) => setD(data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="text-neutral-500">Loading…</div>;
  const agents = [...d.agents].sort((a, b) => (b.online - a.online) || (a.open_tickets + a.pending_deposits + a.open_withdrawals) - (b.open_tickets + b.pending_deposits + b.open_withdrawals));
  return (
    <Section title="Agent workload · live" testid="admin-workload" actions={<span className="text-xs text-neutral-500">Refreshes every 5s · least busy online agents first</span>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Agents online" value={`${d.agents.filter((a) => a.online).length} / ${d.agents.length}`} testid="workload-online" />
        <Stat label="Unassigned tickets" value={d.unassigned_tickets} testid="workload-unassigned-tickets" />
        <Stat label="Unassigned withdrawals" value={d.unassigned_withdrawals} testid="workload-unassigned-withdrawals" />
        <Stat label="Open tickets (agents)" value={d.agents.reduce((s, a) => s + a.open_tickets, 0)} testid="workload-open-tickets" />
      </div>
      <DataTable rows={agents} minW={960} cols={[
        { label: "Agent", render: (r) => <><div className="font-semibold flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${r.online ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-neutral-600"}`} />{r.display_name}</div><div className="mono text-[11px] text-neutral-500">{r.username} · {r.status}</div></> },
        { label: "Open tickets", render: (r) => <span data-testid={`workload-tickets-${r.username}`}><Load n={r.open_tickets} /> <span className="text-[11px] text-neutral-500">+{r.actioned_tickets} to review</span></span> },
        { label: "Pending deposits", render: (r) => <><Load n={r.pending_deposits} warn={r.deposit_capacity || 5} /> <span className="text-[11px] text-neutral-500">{inr(r.pending_deposit_amount)} · cap {r.deposit_capacity}</span></> },
        { label: "Open withdrawals", render: (r) => <><Load n={r.open_withdrawals} /> <span className="text-[11px] text-neutral-500">{inr(r.open_withdrawal_amount)}</span></> },
        { label: "Free processing funds", render: (r) => <span className="mono">{inr(r.free_funds)}</span> },
        { label: "Load", render: (r) => {
          const total = r.open_tickets + r.pending_deposits + r.open_withdrawals;
          return <div className="w-28 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-white" style={{ width: `${Math.min(100, total * 10)}%` }} /></div>;
        } },
      ]} />
    </Section>
  );
}
