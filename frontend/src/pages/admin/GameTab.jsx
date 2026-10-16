import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { Stat } from "@/components/common";
import { DataTable, Section, Input, Select, Btn } from "./ui";

const MODES = {
  random: "Mode 1 — Random: secure server-side RNG after betting closes; outcome independent of stakes.",
  risk: "Mode 2 — Company Financial Risk: same secure RNG; enforces exposure limits, pauses rounds when liabilities exceed reserve, disables promotions when promo reserve is empty. Never alters outcomes.",
};

export default function GameTab() {
  const [g, setG] = useState(null);
  const [f, setF] = useState(null);
  const [hist, setHist] = useState([]);
  const load = () => api.get("/admin/game").then(({ data }) => {
    setG(data);
    setF((cur) => cur || {
      mode: data.config.mode, min_stake: data.config.min_stake / 100, max_stake: data.config.max_stake / 100,
      max_round_exposure: data.config.max_round_exposure / 100, company_reserve: data.config.company_reserve / 100,
      commission_bps: data.config.commission_bps / 100, commission_basis: data.config.commission_basis,
      promo_reserve: data.config.promo_reserve / 100,
    });
  });
  useEffect(() => {
    load();
    api.get("/admin/config/history").then(({ data }) => setHist(data));
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !f) return <div className="text-neutral-500">Loading…</div>;
  const save = async (extra = {}) => {
    try {
      await api.put("/admin/config", {
        mode: f.mode, min_stake: toPaise(f.min_stake), max_stake: toPaise(f.max_stake), max_round_exposure: toPaise(f.max_round_exposure),
        company_reserve: toPaise(f.company_reserve), commission_bps: Math.round(parseFloat(f.commission_bps) * 100),
        commission_basis: f.commission_basis, promo_reserve: toPaise(f.promo_reserve), ...extra,
      });
      toast.success("Configuration saved");
      api.get("/admin/config/history").then(({ data }) => setHist(data));
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const c = g.current, e = g.exposure, cfg = g.config;
  const left = c?.status === "betting" ? Math.max(0, Math.ceil((new Date(c.closes_at) - new Date()) / 1000)) : 0;
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  return (
    <>
      <Section title="Game monitoring" testid="admin-game-monitor"
        actions={<Btn primary onClick={() => save({ paused: !cfg.paused })} data-testid="toggle-pause-button">{cfg.paused ? "Resume rounds" : "Pause new rounds"}</Btn>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Current round" value={c ? `#${c.number}` : "—"} sub={c?.status} testid="monitor-round" />
          <Stat label="Countdown" value={`${left}s`} testid="monitor-countdown" />
          <Stat label="Active mode" value={cfg.mode.toUpperCase()} sub={cfg.paused ? "PAUSED" : "running"} testid="monitor-mode" />
          <Stat label="Max exposure" value={inr(e?.max_exposure)} testid="monitor-exposure" />
          <Stat label="ODD stake" value={inr(e?.odd_stake)} sub={`${e?.odd_count || 0} bets`} testid="monitor-odd" />
          <Stat label="EVEN stake" value={inr(e?.even_stake)} sub={`${e?.even_count || 0} bets`} testid="monitor-even" />
          <Stat label="Payout if ODD" value={inr(e?.potential_payout_odd)} sub={`net ${inr(e?.net_if_odd)}`} testid="monitor-pay-odd" />
          <Stat label="Payout if EVEN" value={inr(e?.potential_payout_even)} sub={`net ${inr(e?.net_if_even)}`} testid="monitor-pay-even" />
          <Stat label="Company reserve" value={inr(g.risk.company_reserve)} testid="monitor-reserve" />
          <Stat label="Wallet liabilities" value={inr(g.risk.total)} testid="monitor-liabilities" />
          <Stat label="Pending withdrawals" value={inr(g.risk.pending_withdrawals)} testid="monitor-pending-w" />
          <Stat label="Realized P&L" value={inr(g.risk.realized_pnl)} testid="monitor-pnl" />
        </div>
      </Section>
      <Section title="Game configuration" testid="admin-game-config" actions={<Btn primary onClick={() => save()} data-testid="save-config-button">Save configuration</Btn>}>
        <div className="panel !rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select label="Eligible game mode" value={f.mode} onChange={set("mode")} options={[["random", "Mode 1 · Random"], ["risk", "Mode 2 · Financial Risk"]]} testid="config-mode-select" />
          <Input label="Min stake (₹)" type="number" value={f.min_stake} onChange={set("min_stake")} testid="config-min-stake" />
          <Input label="Max stake (₹)" type="number" value={f.max_stake} onChange={set("max_stake")} testid="config-max-stake" />
          <Input label="Max round exposure (₹)" type="number" value={f.max_round_exposure} onChange={set("max_round_exposure")} testid="config-max-exposure" />
          <Input label="Company reserve (₹)" type="number" value={f.company_reserve} onChange={set("company_reserve")} testid="config-reserve" />
          <Input label="Promo reserve (₹)" type="number" value={f.promo_reserve} onChange={set("promo_reserve")} testid="config-promo-reserve" />
          <Input label="Default verifier commission (%)" type="number" value={f.commission_bps} onChange={set("commission_bps")} testid="config-commission" />
          <Select label="Commission basis (agreement)" value={f.commission_basis} onChange={set("commission_basis")} testid="config-commission-basis"
            options={[["deposits", "Verified deposits"], ["withdrawals", "Completed withdrawals"], ["both", "Both"]]} />
          <div className="flex items-center gap-3 text-sm">
            <Btn onClick={() => save({ promotions_enabled: !cfg.promotions_enabled })} data-testid="toggle-promotions-button">Promotions: {cfg.promotions_enabled ? "ON" : "OFF"}</Btn>
          </div>
        </div>
        <div className="panel !rounded-2xl p-5 text-sm text-neutral-300 space-y-2" data-testid="mode-rules">
          <div>{MODES.random}</div><div>{MODES.risk}</div>
          <div className="text-neutral-500">Payout: winning stake × {cfg.multiplier_bps / 100} total return. Round 30s + 3s reveal.</div>
        </div>
      </Section>
      <Section title="Previous rounds" testid="admin-rounds">
        <DataTable rows={g.rounds} cols={[
          { label: "#", key: "number" }, { label: "Status", key: "status" }, { label: "Mode", key: "mode" },
          { label: "Result", render: (r) => r.result ? `${r.result} (${r.dice})` : "—" },
          { label: "ODD / EVEN stake", render: (r) => `${inr(r.totals?.odd_stake)} / ${inr(r.totals?.even_stake)}` },
          { label: "Payout", render: (r) => inr(r.total_payout) }, { label: "GGR", render: (r) => inr(r.ggr) },
          { label: "Settled", render: (r) => dt(r.settled_at) },
        ]} />
      </Section>
      <Section title="Configuration audit history" testid="admin-config-history">
        <DataTable rows={hist} cols={[
          { label: "When", render: (r) => dt(r.created_at) }, { label: "By", key: "by" },
          { label: "Changes", render: (r) => <span className="mono text-xs">{JSON.stringify(r.changes)}</span> },
        ]} />
      </Section>
    </>
  );
}
