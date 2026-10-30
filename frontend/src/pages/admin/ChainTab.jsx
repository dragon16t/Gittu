import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { Section, DataTable, Input, Btn } from "./ui";

const Config = ({ cfg, onSaved }) => {
  const [f, setF] = useState({ ...cfg, min_withdraw: cfg.min_withdraw / 100 });
  const save = async () => {
    try { await api.put("/admin/chain/config", { enabled: f.enabled, pct: +f.pct, min_withdraw: Math.round(+f.min_withdraw * 100), min_members: +f.min_members }); toast.success("Saved"); onSaved(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="grid sm:grid-cols-5 gap-3 items-end" data-testid="chain-config">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} data-testid="chain-enabled" />Enabled</label>
      <Input label="Share of pool deposits (%)" type="number" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} testid="chain-pct" />
      <Input label="Min withdrawal (₹)" type="number" value={f.min_withdraw} onChange={(e) => setF({ ...f, min_withdraw: e.target.value })} testid="chain-min-withdraw" />
      <Input label="Min pool members" type="number" value={f.min_members} onChange={(e) => setF({ ...f, min_members: e.target.value })} testid="chain-min-members" />
      <Btn primary onClick={save} data-testid="chain-config-save">Save</Btn>
    </div>
  );
};

export default function ChainTab() {
  const [d, setD] = useState(null);
  const [day, setDay] = useState("");
  const load = () => api.get("/admin/chain").then(({ data }) => setD(data));
  useEffect(() => { load(); }, []);
  const run = async () => {
    if (!day || !window.confirm(`Distribute chain pool for ${day}? Already-paid pools are skipped.`)) return;
    try { const { data } = await api.post(`/admin/chain/run/${day}`); toast.success(`Paid ${inr(data.paid)} to ${data.pools_paid} pools`); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!d) return null;
  const t = d.totals;
  return (
    <div className="space-y-6">
      <Section title="Chain pool · settings" testid="admin-chain">
        <div className="grid sm:grid-cols-4 gap-3 mb-4 text-sm">
          {[["Active pools", t.pools], ["Pool deposits today", inr(t.today_deposits)], ["Total paid to users", inr(t.earned)], ["Unwithdrawn chain balance", inr(t.outstanding)]].map(([l, v]) => (
            <div key={l} className="panel !rounded-xl p-3"><div className="text-[10px] uppercase text-neutral-500">{l}</div><div className="font-bold mono" data-testid={`chain-total-${l.split(" ")[0].toLowerCase()}`}>{v}</div></div>))}
        </div>
        <Config cfg={d.config} onSaved={load} />
        <div className="mt-4 flex flex-wrap items-end gap-2 text-xs text-neutral-400">
          <span>Last automatic run: {d.state.last_day || "—"} {d.state.ran_at ? `(${dt(d.state.ran_at)})` : ""}</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-9 rounded-lg bg-black border border-white/15 px-2" data-testid="chain-run-day" />
          <Btn onClick={run} data-testid="chain-run-button">Run payout for day</Btn>
        </div>
      </Section>
      <Section title="Pools (top 50 by size)" testid="admin-chain-pools">
        <DataTable rows={d.pools} testid="chain-pools-table" cols={[
          { label: "Top referrer", render: (p) => p.root }, { label: "Members", render: (p) => p.members }, { label: "Deposits today", render: (p) => inr(p.today_deposits) },
          { label: "Tonight's pot", render: (p) => inr(p.today_pot) }, { label: "Lifetime paid", render: (p) => inr(p.lifetime_paid) }]} />
      </Section>
      <Section title="Daily payouts" testid="admin-chain-payouts">
        <DataTable rows={d.payouts} testid="chain-payouts-table" cols={[
          { label: "Day", render: (p) => p.day }, { label: "Pool", render: (p) => p.root }, { label: "Deposits", render: (p) => inr(p.pool_deposits) }, { label: "Members", render: (p) => p.members },
          { label: "Eligible", render: (p) => p.eligible }, { label: "Each got", render: (p) => inr(p.share) }, { label: "Total paid", render: (p) => inr(p.paid) }, { label: "By", render: (p) => p.by }]} />
      </Section>
    </div>
  );
}
