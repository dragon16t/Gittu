import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { Section, DataTable, Input, Btn, Modal } from "./ui";

const LOGIC_INFO = {
  low: "Low multiplier", medium: "Medium multiplier", high: "High multiplier", rare: "Rare high multiplier",
};

const Toggle = ({ on, onChange, testid, label }) => (
  <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testid}
    className="flex items-center gap-3 text-sm">
    <span className={`relative h-7 w-14 shrink-0 rounded-full border transition-colors ${on ? "bg-emerald-500/80 border-emerald-300" : "bg-neutral-800 border-white/20"}`}>
      <span className={`absolute left-0 top-[3px] h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-8" : "translate-x-1"}`} />
    </span>
    <span className="text-left">{label}</span>
  </button>
);

const Stat = ({ label, value, testid, tone = "" }) => (
  <div className="panel !rounded-2xl px-4 py-3 min-w-0" data-testid={testid}>
    <div className="text-[11px] text-neutral-500 uppercase tracking-wider">{label}</div>
    <div className={`mt-1 text-lg font-bold truncate ${tone}`}>{value}</div>
  </div>
);

const Card = ({ title, sub, children, onSave, testid, saving }) => (
  <div className="panel !rounded-2xl p-5 space-y-4" data-testid={testid}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><div className="font-semibold text-white">{title}</div>{sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}</div>
      {onSave && <Btn primary onClick={onSave} disabled={saving} data-testid={`${testid}-save`}>{saving ? "Saving…" : "Save section"}</Btn>}
    </div>
    {children}
  </div>
);

const Live = ({ d, onTopup }) => {
  const l = d.live || {};
  return (
    <Section title="Live round & arena wallet" testid="arena-live" actions={<Btn primary onClick={onTopup} data-testid="arena-topup-open">Top up arena wallet</Btn>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Arena wallet" value={inr(d.wallet.balance)} testid="arena-wallet-balance" tone="text-emerald-300" />
        <Stat label="Round" value={`#${l.number ?? "—"} · ${(l.status || "—").toUpperCase()}${l.simulated ? " · SIM" : ""}`} testid="arena-round-status" />
        <Stat label="Accepted stakes" value={`${inr(l.stakes)} · ${l.bets_count ?? 0} bets`} testid="arena-stakes" />
        <Stat label="Participants / active" value={`${l.players ?? 0} / ${l.active_bets ?? 0}`} testid="arena-participants" />
        <Stat label="Effective budget" value={l.budget == null ? "—" : inr(l.budget)} testid="arena-budget" />
        <Stat label="Paid payouts" value={inr(l.paid)} testid="arena-paid" />
        <Stat label="Remaining budget" value={l.remaining == null ? "—" : inr(l.remaining)} testid="arena-remaining" tone={l.cap_hit ? "text-red-400" : ""} />
        <Stat label="Collect requests" value={`${l.collect_requests ?? 0} · ${l.collected ?? 0} paid`} testid="arena-collects" />
        <Stat label="Live stakes" value={inr(l.live_stakes)} testid="arena-live-stakes" />
        <Stat label="Cap crash point" value={l.cap_point ? `${l.cap_point.toFixed(2)}×` : "—"} testid="arena-cap-point" tone={l.cap_point ? "text-amber-300" : ""} />
      </div>
      <div className="text-xs text-neutral-400 space-x-3" data-testid="arena-live-notes">
        <span>Eligible: {l.eligible == null ? "—" : inr(l.eligible)}</span>
        <span>Circle 1 allocation: {l.allocation == null ? "off" : inr(l.allocation)}{l.carry_in ? ` + carry ${inr(l.carry_in)}` : ""}</span>
        <span>Circle 2 cap: {l.fixed_cap == null ? "off" : inr(l.fixed_cap)}</span>
        <span>Logic: {LOGIC_INFO[l.logic] || "—"}</span>
        {l.cap_hit && <span className="text-red-400 font-semibold">Payout cap reached — round ended</span>}
        {l.na_applied && <span className="text-amber-300">No-active-player phase</span>}
      </div>
    </Section>
  );
};

const General = ({ cfg, save }) => {
  const [f, setF] = useState({ enabled: cfg.enabled, betting_seconds: cfg.betting_seconds, min_bet: cfg.min_bet / 100, max_bet: cfg.max_bet / 100, max_multiplier: cfg.max_multiplier });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="General settings" sub="Game on/off, countdown and limits" testid="arena-general"
      onSave={() => save("general", { ...f, betting_seconds: +f.betting_seconds, min_bet: toPaise(f.min_bet), max_bet: toPaise(f.max_bet), max_multiplier: +f.max_multiplier })}>
      <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} testid="arena-enabled-toggle" label={f.enabled ? "PULSE Arena is running" : "PULSE Arena is paused (no new rounds)"} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Input label="Betting countdown (seconds)" type="number" value={f.betting_seconds} onChange={set("betting_seconds")} testid="arena-betting-seconds" />
        <Input label="Minimum bet (₹)" type="number" value={f.min_bet} onChange={set("min_bet")} testid="arena-min-bet" />
        <Input label="Maximum bet (₹)" type="number" value={f.max_bet} onChange={set("max_bet")} testid="arena-max-bet" />
        <Input label="Maximum multiplier (×)" type="number" value={f.max_multiplier} onChange={set("max_multiplier")} testid="arena-max-multiplier" />
      </div>
    </Card>
  );
};

const Logic1 = ({ cfg, dist, save }) => {
  const [logic, setLogic] = useState(cfg.logic);
  const [lg, setLg] = useState(cfg.logics);
  const set = (name, k) => (e) => setLg({ ...lg, [name]: { ...lg[name], [k]: e.target.value } });
  const obs = dist.rounds ? Math.round((dist.below_2x / dist.rounds) * 100) : null;
  return (
    <Card title="Logic 1 · Random multiplier distribution" testid="arena-logic1"
      sub="One logic is active at a time. Endpoint is chosen by server RNG before the round (sha256 seed commitment) and never changed by stakes or balances."
      onSave={() => save("logic", { logic, logics: lg })}>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {Object.keys(LOGIC_INFO).map((name) => {
          const on = logic === name, v = lg[name];
          return (
            <div key={name} className={`rounded-2xl border p-4 space-y-3 transition-colors ${on ? "border-emerald-400/70 bg-emerald-500/5" : "border-white/10"}`} data-testid={`arena-logic-${name}`}>
              <button type="button" onClick={() => setLogic(name)} className="flex items-center gap-2 text-sm font-semibold" data-testid={`arena-logic-${name}-select`}>
                <span className={`h-4 w-4 rounded-full border-2 ${on ? "border-emerald-400 bg-emerald-400" : "border-white/40"}`} />{LOGIC_INFO[name]}{on && <span className="text-[10px] text-emerald-300">ACTIVE</span>}
              </button>
              <div className="text-xs text-neutral-400">{v.below_pct}% of rounds below 2×, {100 - v.below_pct}% between {v.lo}× and {v.hi}×</div>
              <div className="grid grid-cols-3 gap-2">
                <Input label="% below 2×" type="number" value={v.below_pct} onChange={set(name, "below_pct")} testid={`arena-logic-${name}-pct`} />
                <Input label="Rest from ×" type="number" value={v.lo} onChange={set(name, "lo")} testid={`arena-logic-${name}-lo`} />
                <Input label="Rest to ×" type="number" value={v.hi} onChange={set(name, "hi")} testid={`arena-logic-${name}-hi`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-neutral-400" data-testid="arena-observed-distribution">
        Observed (last {dist.rounds} staked rounds): {obs == null ? "—" : `${obs}% below 2×`}. Targets are long-run probabilities, not guarantees for small groups of rounds.
      </div>
    </Card>
  );
};

const Logic2 = ({ cfg, save }) => {
  const [f, setF] = useState({ pct_enabled: cfg.pct_enabled, wallet_pct: cfg.wallet_pct, cap_enabled: cfg.cap_enabled, fixed_cap: cfg.fixed_cap / 100, carry_forward: cfg.carry_forward });
  return (
    <Card title="Logic 2 · Payout controls" testid="arena-logic2"
      sub="Budget = lowest of: Circle 1 (% of arena wallet, + carry-forward), Circle 2 fixed cap, available funds. The round crashes automatically at the multiplier where paid wins + live stakes × multiplier would exceed the budget. Players never see these rules."
      onSave={() => save("payout", { ...f, fixed_cap: toPaise(f.fixed_cap) })}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 p-4 space-y-3" data-testid="arena-circle1">
          <Toggle on={f.pct_enabled} onChange={(v) => setF({ ...f, pct_enabled: v })} testid="arena-circle1-toggle" label="Circle 1 · Arena wallet percentage" />
          <div className="flex gap-2">
            {[10, 20, 30, 50].map((p) => (
              <button key={p} type="button" onClick={() => setF({ ...f, wallet_pct: p })} data-testid={`arena-pct-${p}`}
                className={`h-10 w-16 rounded-full text-sm font-bold border ${f.wallet_pct === p ? "silver-btn text-black border-transparent" : "border-white/15 text-neutral-300"}`}>{p}%</button>
            ))}
          </div>
          <Toggle on={f.carry_forward} onChange={(v) => setF({ ...f, carry_forward: v })} testid="arena-carry-toggle" label="Carry unused allocation into the next round" />
        </div>
        <div className="rounded-2xl border border-white/10 p-4 space-y-3" data-testid="arena-circle2">
          <Toggle on={f.cap_enabled} onChange={(v) => setF({ ...f, cap_enabled: v })} testid="arena-circle2-toggle" label="Circle 2 · Fixed payout cap per round" />
          <Input label="Cap amount (₹)" type="number" value={f.fixed_cap} onChange={(e) => setF({ ...f, fixed_cap: e.target.value })} testid="arena-fixed-cap" />
        </div>
      </div>
    </Card>
  );
};

const Phases = ({ cfg, save }) => {
  const [f, setF] = useState({ empty_below_pct: cfg.empty_below_pct, empty_split: cfg.empty_split, empty_max: cfg.empty_max, no_active_enabled: cfg.no_active_enabled, na_min: cfg.na_min, na_max: cfg.na_max });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Empty & no-active-player rounds" testid="arena-phases"
      sub={`No stakes → random end: ${f.empty_below_pct}% under ${f.empty_split}×, rest up to ${f.empty_max}×. Everyone collected → continues to a pre-committed endpoint in the no-active range.`}
      onSave={() => save("phases", { ...f, empty_below_pct: +f.empty_below_pct, empty_split: +f.empty_split, empty_max: +f.empty_max, na_min: +f.na_min, na_max: +f.na_max })}>
      <div className="grid sm:grid-cols-3 gap-3">
        <Input label="Empty round: % under split" type="number" value={f.empty_below_pct} onChange={set("empty_below_pct")} testid="arena-empty-pct" />
        <Input label="Empty round: split (×)" type="number" value={f.empty_split} onChange={set("empty_split")} testid="arena-empty-split" />
        <Input label="Empty round: max (×)" type="number" value={f.empty_max} onChange={set("empty_max")} testid="arena-empty-max" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="No-active from (×)" type="number" value={f.na_min} onChange={set("na_min")} testid="arena-na-min" />
        <Input label="No-active to (×)" type="number" value={f.na_max} onChange={set("na_max")} testid="arena-na-max" />
      </div>
      <Toggle on={f.no_active_enabled} onChange={(v) => setF({ ...f, no_active_enabled: v })} testid="arena-na-toggle" label="Use the no-active-player phase" />
    </Card>
  );
};

const Records = ({ d }) => (
  <>
    <Section title="Recent rounds & settlements" testid="arena-rounds">
      <DataTable testid="arena-rounds-table" rows={d.rounds} cols={[
        ["Round", (r) => `#${r.number}${r.simulated ? " · SIM" : ""}`], ["Result", (r) => `${r.result.toFixed(2)}×`], ["Logic", (r) => r.logic],
        ["Bets", (r) => r.bets_count], ["Stakes", (r) => inr(r.stakes)], ["Paid", (r) => inr(r.paid)], ["Budget", (r) => inr(r.budget)],
        ["Wallet open → close", (r) => `${inr(r.opening_balance)} → ${inr(r.closing_balance)}`],
        ["Flags", (r) => [r.cap_hit && "CAP", r.na_applied && "NO-ACTIVE"].filter(Boolean).join(" ") || "—"],
        ["Seed", (r) => <span className="mono text-[10px]" title={r.seed_hash}>{r.seed?.slice(0, 12)}…</span>], ["Ended", (r) => dt(r.crashed_at)],
      ].map(([label, render]) => ({ label, render }))} />
    </Section>
    <Section title="3-round reconciliation cycles" testid="arena-cycles">
      <DataTable testid="arena-cycles-table" minW={600} rows={d.cycles} cols={[
        ["Cycle", (c) => `#${c.cycle} (${c.rounds.join(", ")})`], ["Opening", (c) => inr(c.opening_balance)], ["Closing", (c) => inr(c.closing_balance)],
        ["Stakes", (c) => inr(c.stakes)], ["Payouts", (c) => inr(c.payouts)], ["Carry fwd", (c) => inr(c.carry_forward)],
        ["Ledger check", (c) => <span className={c.reconciled ? "text-emerald-300" : "text-red-400"}>{c.reconciled ? "OK" : "MISMATCH"}</span>],
      ].map(([label, render]) => ({ label, render }))} />
    </Section>
    <Section title="Payout cap events" testid="arena-cap-events">
      <DataTable testid="arena-cap-table" minW={520} empty="No cap events" rows={d.cap_events} cols={[
        ["Round", (c) => `#${c.round_number}`], ["Crashed at", (c) => `${c.multiplier.toFixed(2)}×`], ["RNG end", (c) => (c.rng_endpoint ? `${c.rng_endpoint.toFixed(2)}×` : "—")],
        ["Live stakes", (c) => inr(c.live_stakes ?? c.requested)],
        ["Budget", (c) => inr(c.budget)], ["Paid before", (c) => inr(c.paid)], ["Time", (c) => dt(c.at)],
      ].map(([label, render]) => ({ label, render }))} />
    </Section>
    <Section title="Arena admin audit log" testid="arena-audit">
      <DataTable testid="arena-audit-table" minW={520} empty="No changes yet" rows={d.audit} cols={[
        ["Action", (a) => a.action], ["By", (a) => a.actor], ["Details", (a) => <span className="mono text-[10px] break-all">{JSON.stringify(a.details).slice(0, 160)}</span>], ["Time", (a) => dt(a.created_at)],
      ].map(([label, render]) => ({ label, render }))} />
    </Section>
  </>
);

const Topup = ({ open, onClose, done }) => {
  const [f, setF] = useState({ amount: "", note: "", password: "", code: "" });
  const submit = async () => {
    try {
      await api.post("/admin/pulse/topup", { ...f, amount: toPaise(f.amount) });
      toast.success("Arena wallet topped up");
      setF({ amount: "", note: "", password: "", code: "" });
      onClose(); done();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Top up arena wallet" testid="arena-topup-modal">
      <div className="space-y-3">
        <Input label="Amount (₹)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} testid="arena-topup-amount" />
        <Input label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} testid="arena-topup-note" />
        <Input label="Admin password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} testid="arena-topup-password" />
        <Input label="Authenticator code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} testid="arena-topup-code" />
        <Btn primary onClick={submit} data-testid="arena-topup-submit">Confirm top-up</Btn>
      </div>
    </Modal>
  );
};

export default function GameArenaTab() {
  const [d, setD] = useState(null);
  const [topup, setTopup] = useState(false);
  const [ver, setVer] = useState(0);
  const load = useCallback(() => api.get("/admin/pulse").then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);
  const save = async (section, body) => {
    try {
      await api.put(`/admin/pulse/config/${section}`, body);
      toast.success("Section saved");
      await load(); setVer((v) => v + 1);
    } catch (e) { toast.error(errMsg(e)); }
  };
  if (!d) return <div className="text-neutral-500 text-sm" data-testid="arena-loading">Loading…</div>;
  return (
    <div className="space-y-6" data-testid="admin-game-arena">
      <Live d={d} onTopup={() => setTopup(true)} />
      <Section title="Game Arena configuration (PULSE)" testid="arena-config">
        <div className="space-y-4" key={ver}>
          <General cfg={d.config} save={save} />
          <Logic1 cfg={d.config} dist={d.distribution} save={save} />
          <Logic2 cfg={d.config} save={save} />
          <Phases cfg={d.config} save={save} />
        </div>
      </Section>
      <Records d={d} />
      <Topup open={topup} onClose={() => setTopup(false)} done={load} />
    </div>
  );
}
