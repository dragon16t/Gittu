import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { Stat } from "@/components/common";
import { DataTable, Section, Input, Select, Btn } from "./ui";

const MODES = {
  random: "Mode 1 — Standard: result drawn on the server after betting closes.",
  minority: "Mode 2 — Minority Wins: the side with the smaller total stake wins the round (equal stakes fall back to a standard draw).",
  fair: "Mode 3 — Fair Proof: results for the next 10 rounds are pre-generated and their SHA-256 hashes are published to players in advance. After each round the dice + salt are revealed so anyone can verify.",
  nowin: "Mode 4 — No-Win: if only one side has bets, the opposite side wins. If both sides have bets, every bet loses. No bets: standard draw.",
  risk: "Mode · Financial Risk: enforces exposure limits, pauses rounds when liabilities exceed reserve and disables promotions when the promo reserve is empty.",
};

const AutoMode = ({ cfg, f, set, current, onToggle }) => {
  const std = cfg.auto_standard, mino = cfg.auto_minority, total = std + mino || 1;
  const pos = (Math.max(0, (cfg.auto_pos || 0) - 1)) % total;
  const inStd = pos < std;
  const now = inStd ? `Standard ${pos + 1}/${std}` : `Minority Wins ${pos - std + 1}/${mino}`;
  const nextPos = (pos + 1) % total;
  const next = nextPos < std ? "Standard" : "Minority Wins";
  return (
    <div className="panel !rounded-2xl p-5 flex flex-col gap-4" data-testid="auto-mode-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white">Auto Mode</div>
          <div className="text-xs text-neutral-400">Repeats Standard rounds then Minority Wins rounds until switched off. Mode is hidden from players.</div>
        </div>
        <button type="button" role="switch" aria-checked={!!cfg.auto_mode} onClick={onToggle} data-testid="auto-mode-toggle"
          className={`relative shrink-0 h-8 w-16 rounded-full border transition-colors ${cfg.auto_mode ? "bg-emerald-500/80 border-emerald-300" : "bg-neutral-800 border-white/20"}`}>
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-transform ${cfg.auto_mode ? "translate-x-8" : "translate-x-1"} left-0`} />
          <span className="sr-only">Toggle auto mode</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Standard rounds" type="number" value={f.auto_standard} onChange={set("auto_standard")} testid="auto-standard-input" />
        <Input label="Minority Wins rounds" type="number" value={f.auto_minority} onChange={set("auto_minority")} testid="auto-minority-input" />
      </div>
      <div className="text-sm" data-testid="auto-mode-status">
        {cfg.auto_mode
          ? <span className="text-emerald-300">{current?.auto ? `ON · Round #${current.number}: ${now} · Next: ${next}` : "ON · Starts next round: Standard 1/" + std}</span>
          : <span className="text-neutral-500">OFF · using "{cfg.mode}" mode. Save the round counts, then turn on.</span>}
      </div>
    </div>
  );
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
      referral_bonus: data.config.referral_bonus / 100, friend_bonus: data.config.friend_bonus / 100,
      auto_standard: data.config.auto_standard, auto_minority: data.config.auto_minority,
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
        commission_basis: f.commission_basis, promo_reserve: toPaise(f.promo_reserve),
        referral_bonus: toPaise(f.referral_bonus), friend_bonus: toPaise(f.friend_bonus),
        auto_standard: parseInt(f.auto_standard, 10) || 0, auto_minority: parseInt(f.auto_minority, 10) || 0, ...extra,
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
          <Stat label="Active mode" value={cfg.auto_mode ? `AUTO · ${(c?.mode || "random").toUpperCase()}` : cfg.mode.toUpperCase()} sub={cfg.paused ? "PAUSED" : "running"} testid="monitor-mode" />
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
        <AutoMode cfg={cfg} f={f} set={set} current={c} onToggle={() => save({ auto_mode: !cfg.auto_mode })} />
        <div className="panel !rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select label={cfg.auto_mode ? "Game mode (used when Auto is OFF)" : "Eligible game mode"} value={f.mode} onChange={set("mode")} options={[["random", "Mode 1 · Standard"], ["minority", "Mode 2 · Minority Wins"], ["fair", "Mode 3 · Fair Proof"], ["nowin", "Mode 4 · No-Win"], ["risk", "Financial Risk"]]} testid="config-mode-select" />
          <Input label="Min stake (₹)" type="number" value={f.min_stake} onChange={set("min_stake")} testid="config-min-stake" />
          <Input label="Max stake (₹)" type="number" value={f.max_stake} onChange={set("max_stake")} testid="config-max-stake" />
          <Input label="Max round exposure (₹)" type="number" value={f.max_round_exposure} onChange={set("max_round_exposure")} testid="config-max-exposure" />
          <Input label="Company reserve (₹)" type="number" value={f.company_reserve} onChange={set("company_reserve")} testid="config-reserve" />
          <Input label="Promo reserve (₹)" type="number" value={f.promo_reserve} onChange={set("promo_reserve")} testid="config-promo-reserve" />
          <Input label="Referrer bonus (₹)" type="number" value={f.referral_bonus} onChange={set("referral_bonus")} testid="config-referral-bonus" />
          <Input label="Friend welcome bonus (₹)" type="number" value={f.friend_bonus} onChange={set("friend_bonus")} testid="config-friend-bonus" />
          <Input label="Default verifier commission (%)" type="number" value={f.commission_bps} onChange={set("commission_bps")} testid="config-commission" />
          <Select label="Commission basis (agreement)" value={f.commission_basis} onChange={set("commission_basis")} testid="config-commission-basis"
            options={[["deposits", "Verified deposits"], ["withdrawals", "Completed withdrawals"], ["both", "Both"]]} />
          <div className="flex items-center gap-3 text-sm">
            <Btn onClick={() => save({ promotions_enabled: !cfg.promotions_enabled })} data-testid="toggle-promotions-button">Promotions: {cfg.promotions_enabled ? "ON" : "OFF"}</Btn>
          </div>
        </div>
        <div className="panel !rounded-2xl p-5 text-sm text-neutral-300 space-y-2" data-testid="mode-rules">
          <div>{MODES.random}</div><div className="text-amber-200">{MODES.minority}</div><div className="text-emerald-200">{MODES.fair}</div><div className="text-red-200">{MODES.nowin}</div><div>{MODES.risk}</div>
          <div className="text-neutral-500">Payout: winning stake × {cfg.multiplier_bps / 100} total return. Round 30s + 3s reveal.</div>
        </div>
      </Section>
      {cfg.mode === "fair" && (
        <Section title="Mode 3 · Next 10 results (admin only)" testid="admin-fair-upcoming">
          <DataTable rows={g.fair_upcoming || []} cols={[
            { label: "Round", render: (r) => <span data-testid={`admin-fair-round-${r.number}`}>#{r.number}{c?.number === r.number ? " (current)" : ""}</span> },
            { label: "Result", render: (r) => <b className={r.result === "ODD" ? "text-emerald-300" : "text-red-300"} data-testid={`admin-fair-result-${r.number}`}>{r.result}</b> },
            { label: "Dice", key: "dice" },
            { label: "Published hash", render: (r) => <span className="mono text-[11px] text-neutral-400 break-all">{r.hash}</span> },
          ]} />
        </Section>
      )}
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
