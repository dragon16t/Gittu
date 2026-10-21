import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { api, errMsg, newKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useMusic } from "@/components/game/hooks";
import { playBetSound, playWinSound } from "@/lib/sfx";
import { AppHeader } from "@/components/lobby/AppHeader";
import { PulseTicker, Arena, TimerBar, BetCard, RecentRounds } from "@/components/pulse/PulseParts";

const NONE = [];

const multAt = (r, t) => {
  if (!r) return 1;
  if (r.status === "crashed") return r.result;
  if (r.status !== "running" || !r.anchor_at) return 1;
  const m = r.anchor_m * Math.exp(r.k * Math.max(0, (t - new Date(r.anchor_at).getTime()) / 1000));
  return Math.floor(m * 100) / 100;
};

export default function Pulse() {
  const { user } = useSession();
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [amounts, setAmounts] = useState({ 1: 10000, 2: 20000 });
  const [busy, setBusy] = useState({});
  const [flash, setFlash] = useState({});
  const showFlash = (slot, text) => { setFlash((f) => ({ ...f, [slot]: text })); setTimeout(() => setFlash((f) => ({ ...f, [slot]: null })), 1500); };
  const offset = useRef(0);
  const ref = useRef(null);
  const [music, toggleMusic] = useMusic();

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const { data } = await api.get("/pulse/state");
      offset.current = new Date(data.server_time).getTime() - (t0 + Date.now()) / 2;
      ref.current = data;
      setState(data);
    } catch { /* retry on next poll */ }
  }, []);

  useEffect(() => {
    let alive = true, timer;
    const loop = async () => {
      await load();
      if (alive) timer = setTimeout(loop, ref.current?.round?.status === "running" ? 150 : 500);
    };
    loop();
    const tick = setInterval(() => setNow(Date.now()), 50);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, [load]);

  const r = state?.round;
  const t = now + offset.current;
  const m = multAt(r, t);
  const secs = r?.status === "betting" ? Math.max(0, (new Date(r.closes_at).getTime() - t) / 1000) : 0;
  const bets = state?.my_bets || NONE;
  const totalWin = bets.reduce((t, b) => t + (b.status === "collected" ? b.payout : b.status === "active" && r?.status === "running" ? Math.floor(b.stake * Math.round(m * 100) / 100) : 0), 0);

  const act = async (slot) => {
    if (!user) return nav("/login");
    const bet = bets.find((b) => b.slot === slot);
    setBusy((b) => ({ ...b, [slot]: true }));
    try {
      if (!bet && r?.status === "betting") {
        await api.post("/pulse/bet", { slot, amount: amounts[slot], client_key: newKey() });
        playBetSound();
      } else if (bet?.status === "active" && r?.status === "running") {
        await api.post("/pulse/collect", { round_id: r.id, slot });
        playWinSound();
      }
      await load();
    } catch (e) {
      const msg = errMsg(e).toLowerCase();
      if (!bet) showFlash(slot, msg.includes("balance") ? "LOW BALANCE" : msg.includes("between") ? "CHECK AMOUNT" : "BETTING CLOSED");
      load();
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  };

  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-[100dvh] bg-[#050606] flex flex-col pb-3" data-testid="pulse-page">
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
          <span className="h-8 px-2.5 rounded-full border border-white/10 bg-[#0b0e0e] text-[12px] whitespace-nowrap flex items-center gap-1.5" data-testid="pulse-players">
            <Users size={15} />{state?.players ?? 0} Players</span>
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
