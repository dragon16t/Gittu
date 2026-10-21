import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errMsg, newKey, inr } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useMusic } from "@/components/game/hooks";
import { playBetSound, playWinSound } from "@/lib/sfx";
import { AppHeader } from "@/components/lobby/AppHeader";
import { MoneyFlyers, makeFlyer } from "@/components/pulse/MoneyFlyers";
import { PulseTicker, Arena, TimerBar, BetCard, RecentRounds } from "@/components/pulse/PulseParts";

const NONE = [];

const LAG_MS = 200;
const STALE_MS = 1200;

const multAt = (r, t, max) => {
  if (!r) return 1;
  if (r.status === "crashed") return Math.min(r.result, max);
  if (r.status !== "running" || !r.anchor_at) return 1;
  const m = r.anchor_m * Math.exp(r.k * Math.max(0, (t - new Date(r.anchor_at).getTime()) / 1000));
  return Math.min(max, Math.max(1, Math.floor(m * 100) / 100));
};

const payoutAt = (stake, m) => Math.floor((stake * Math.round(m * 100)) / 100);

export default function Pulse() {
  const { user } = useSession();
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [amounts, setAmounts] = useState({ 1: 10000, 2: 20000 });
  const [busy, setBusy] = useState({});
  const [flash, setFlash] = useState({});
  const [flyers, setFlyers] = useState([]);
  const fly = useCallback((slot, text, win) => { const f = makeFlyer(slot, text, win); if (f) setFlyers((x) => [...x, f]); }, []);
  const showFlash = (slot, text) => { setFlash((f) => ({ ...f, [slot]: text })); setTimeout(() => setFlash((f) => ({ ...f, [slot]: null })), 1500); };
  const offset = useRef(0);
  const lastOk = useRef(0);
  const ref = useRef(null);
  const pending = useRef({});
  const [music, toggleMusic] = useMusic();

  const merge = useCallback((data) => {
    let balance = data.balance;
    let bets = data.my_bets;
    Object.entries(pending.current).forEach(([slot, p]) => {
      const srv = bets.find((b) => b.slot === +slot);
      const done = p.kind === "bet" ? !!srv : srv && srv.status !== "active";
      if (done || data.round?.id !== p.round_id) { delete pending.current[slot]; return; }
      bets = [...bets.filter((b) => b.slot !== +slot), p.bet];
      if (balance != null) balance += p.delta;
    });
    return { ...data, balance, my_bets: bets };
  }, []);

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const { data } = await api.get("/pulse/state", { timeout: 4000 });
      offset.current = new Date(data.server_time).getTime() - (t0 + Date.now()) / 2;
      lastOk.current = Date.now();
      const prev = ref.current;
      if (prev?.round?.id && prev.round.id === data.round?.id) {
        data.my_bets.forEach((b) => {
          const old = prev.my_bets.find((o) => o.slot === b.slot);
          if (old?.status === "active" && b.status === "lost") fly(b.slot, `-${inr(b.stake)}`, false);
        });
      }
      const merged = merge(data);
      ref.current = merged;
      setState(merged);
    } catch { /* retry on next poll */ }
  }, [fly, merge]);

  useEffect(() => {
    let alive = true, timer;
    const loop = async () => {
      await load();
      if (alive) timer = setTimeout(loop, 150);
    };
    loop();
    const tick = setInterval(() => setNow(Date.now()), 50);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, [load]);

  const max = state?.config.max_multiplier || 3000;
  const t = Math.min(now - LAG_MS, (lastOk.current || now) + STALE_MS) + offset.current;
  const raw = state?.round;
  const r = raw && (raw.status === "betting" || raw.status === "starting") && t >= new Date(raw.closes_at).getTime()
    ? { ...raw, status: "running", anchor_m: 1, anchor_at: raw.closes_at, k: state.config.k || 0.1 } : raw;
  const m = multAt(r, t, max);
  const secs = r?.status === "betting" ? Math.max(0, (new Date(r.closes_at).getTime() - (now + offset.current)) / 1000) : 0;
  const bets = state?.my_bets || NONE;
  const totalWin = bets.reduce((acc, b) => acc + (b.status === "collected" ? b.payout : b.status === "active" && r?.status === "running" ? payoutAt(b.stake, m) : 0), 0);

  const act = async (slot) => {
    if (!user) return nav("/login");
    if (busy[slot]) return;
    const bet = bets.find((b) => b.slot === slot);
    const placeable = !bet && r?.status === "betting";
    const collectable = bet?.status === "active" && r?.status === "running";
    if (!placeable && !collectable) return;
    setBusy((b) => ({ ...b, [slot]: true }));
    const base = ref.current;
    try {
      if (placeable) {
        const stake = amounts[slot];
        pending.current[slot] = { kind: "bet", round_id: r.id, delta: -stake, bet: { slot, stake, status: "active", round_id: r.id } };
        setState((st) => (ref.current = { ...st, balance: st.balance - stake, my_bets: [...st.my_bets.filter((b) => b.slot !== slot), pending.current[slot].bet] }));
        playBetSound();
        const { data } = await api.post("/pulse/bet", { slot, amount: stake, client_key: newKey() });
        delete pending.current[slot];
        setState((st) => (ref.current = { ...st, balance: data.balance, my_bets: [...st.my_bets.filter((b) => b.slot !== slot), data.bet] }));
      } else {
        const payout = payoutAt(bet.stake, m);
        pending.current[slot] = { kind: "collect", round_id: r.id, delta: payout, bet: { ...bet, status: "collected", payout, multiplier: m } };
        setState((st) => (ref.current = { ...st, balance: st.balance + payout, my_bets: st.my_bets.map((b) => (b.slot === slot ? pending.current[slot].bet : b)) }));
        playWinSound();
        fly(slot, `+${inr(payout)}`, true);
        const { data } = await api.post("/pulse/collect", { round_id: r.id, slot, m });
        delete pending.current[slot];
        setState((st) => (ref.current = { ...st, balance: data.balance, my_bets: st.my_bets.map((b) => (b.slot === slot ? { ...b, ...data.bet } : b)) }));
      }
    } catch (e) {
      delete pending.current[slot];
      setState((ref.current = base));
      if (placeable) {
        const msg = errMsg(e).toLowerCase();
        showFlash(slot, msg.includes("balance") ? "LOW BALANCE" : msg.includes("between") ? "CHECK AMOUNT" : "BETTING CLOSED");
      }
      load();
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  };

  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-[100dvh] bg-[#050606] flex flex-col pb-3" data-testid="pulse-page">
      <MoneyFlyers items={flyers} onDone={(id) => setFlyers((x) => x.filter((f) => f.id !== id))} />
      <AppHeader balance={state?.balance} music={music} onToggleMusic={toggleMusic} />
      <PulseTicker winners={state?.winners || NONE} />
      <div className="px-4 pt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-full border-[3px] border-[#00F58A] shadow-[0_0_14px_rgba(0,245,138,0.6)] flex items-center justify-center"><span className="h-5 w-5 rounded-full border-2 border-[#00F58A]/80" /></span>
          <span className="text-[21px] font-extrabold tracking-tight">PULSE</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-8 px-2.5 rounded-full border border-white/10 bg-[#0b0e0e] text-[12px] whitespace-nowrap flex items-center gap-1.5" data-testid="pulse-round-number">
            <span className="h-2 w-2 rounded-full bg-[#00F58A]" />Round #{r?.number ?? "—"}</span>
        </div>
      </div>
      <main className="flex-1 px-4 flex flex-col justify-evenly gap-2 pt-1">
        <div>
          <Arena m={m} status={r?.status} />
          <TimerBar status={r?.status} secs={secs} total={state?.config.betting_seconds || 7} totalWin={totalWin} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[1, 2].map((slot) => (
            <BetCard key={slot} slot={slot} amount={amounts[slot]} setAmount={(v) => setAmounts((a) => ({ ...a, [slot]: v }))}
              bet={bets.find((b) => b.slot === slot)} status={r?.status} m={m} busy={!!busy[slot]} flash={flash[slot]} onAction={() => act(slot)} />
          ))}
        </div>
        <RecentRounds rounds={state?.recent || NONE} />
      </main>
    </div>
  );
}
