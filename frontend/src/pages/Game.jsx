import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Mail, Gift, Wallet as WalletIcon, Headset, Trophy, Lock } from "lucide-react";
import { useSession } from "@/lib/session";
import { api, errMsg, inr, inr0, newKey, toPaise } from "@/lib/api";
import { TopBar, CountdownRing, SideCircle, StakePicker, ResultStage, RecentResults } from "@/components/game/GameParts";
import { useMusic, useRevealAnimation } from "@/components/game/hooks";
import { Confetti } from "@/components/game/Confetti";
import { OutcomeCard } from "@/components/game/OutcomeCard";
import { playBetSound, playWinSound, playTickSound, unlockAudio } from "@/lib/sfx";

const WinTicker = memo(function WinTicker({ winners }) {
  if (!winners.length) return <div className="h-[22px] shrink-0" />;
  const items = [...winners, ...winners];
  return (
    <div className="ticker shrink-0 h-[22px] overflow-hidden border-b border-white/5 bg-white/[0.03] flex items-center text-[11px]" data-testid="live-win-feed">
      <div className="ticker-track px-2">
        {items.map((w, i) => (
          <span key={i} className="text-neutral-300"><Trophy size={11} className="inline -mt-0.5 mr-1 text-amber-200" />
            {w.name} won <b className="text-emerald-400">{inr(w.payout)}</b> on {w.side} · #{w.round_number}</span>
        ))}
      </div>
    </div>
  );
});

const NONE = [];
const fmtTime = (s) => `00:${String(Math.max(0, Math.ceil(s))).padStart(2, "0")}`;

const IconLink = ({ to, icon: Icon, label, testid, badge }) => (
  <Link to={to} data-testid={testid} aria-label={label} title={label}
    className="relative h-7 w-7 rounded-full ghost-chip flex items-center justify-center text-neutral-300">
    <Icon size={13} />
    {badge > 0 && <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-white text-black text-[9px] font-bold flex items-center justify-center">{badge}</span>}
  </Link>
);

export default function Game() {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [side, setSide] = useState(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [coupons, setCoupons] = useState(0);
  const [burst, setBurst] = useState(0);
  const [referBonus, setReferBonus] = useState(30000);
  const [outcome, setOutcome] = useState(null);
  const offset = useRef(0);
  const { user } = useSession();
  const guestRef = useRef(true);
  guestRef.current = !user;
  const nav = useNavigate();
  const pickOdd = useCallback(() => setSide("ODD"), []);
  const pickEven = useCallback(() => setSide("EVEN"), []);
  const stateRef = useRef(null);
  const animated = useRef(null);
  const toasted = useRef(null);
  const [music, toggleMusic] = useMusic();
  const reveal = useRevealAnimation();

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const { data } = await api.get(guestRef.current ? "/game/public-state" : "/game/state");
      const t1 = Date.now();
      const off = new Date(data.server_time).getTime() - (t0 + t1) / 2;
      offset.current = offset.current === 0 || t1 - t0 < 400 ? off : offset.current;
      stateRef.current = data;
      setState(data);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    let alive = true, timer;
    const loop = async () => {
      if (!document.hidden) await load();
      if (!alive) return;
      const r = stateRef.current?.round;
      const left = r?.status === "betting" ? new Date(r.closes_at).getTime() - (Date.now() + offset.current) : 0;
      timer = setTimeout(loop, left > 6000 ? 2000 : 900);
    };
    timer = setTimeout(loop, 1000);
    const t = setInterval(() => setNow(Date.now()), 250);
    const vis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", vis);
    if (user) api.get("/coupons").then(({ data }) => setCoupons(data.filter((c) => c.status === "available").length)).catch(() => {});
    api.get("/promo/rules").then(({ data }) => setReferBonus(data.bonus)).catch(() => {});
    return () => { alive = false; clearTimeout(timer); clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load, user]);

  const round = state?.round;
  const last = state?.last_round;

  useEffect(() => {
    if (!state) return;
    const showing = round?.status === "revealing" ? round : null;
    if (animated.current === null) {
      animated.current = showing?.id || last?.id || "init";
      reveal.setLabel(last?.result || null);
      reveal.setFinal(!!last);
      if (showing) reveal.run(showing.result);
      return;
    }
    if (showing && animated.current !== showing.id) {
      animated.current = showing.id;
      reveal.run(showing.result);
    } else if (!showing && last && animated.current !== last.id) {
      animated.current = last.id;
      reveal.show(last.result);
    }
    if (last && toasted.current !== last.id && state.last_round_bets.length && animated.current === last.id) {
      toasted.current = last.id;
      setTimeout(() => {
        const bets = state.last_round_bets;
        const won = bets.filter((b) => b.status === "won");
        const staked = bets.reduce((s, b) => s + b.amount, 0);
        const payout = won.reduce((s, b) => s + b.payout, 0);
        setOutcome({ won: won.length > 0, amount: payout, staked, round: last.number, result: last.result });
        if (won.length) {
          setBurst(Date.now());
          playWinSound();
          setTimeout(() => setBurst(0), 2400);
        }
      }, 300);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverNow = now + offset.current;
  const holding = reveal.spinning || round?.status === "revealing" || round?.status === "closed";
  const remaining = round?.status === "betting" && !holding ? (new Date(round.closes_at).getTime() - serverNow) / 1000 : 0;
  const bettingOpen = round?.status === "betting" && !holding && remaining > 0;
  const mult = ((state?.config?.multiplier_bps || 195) / 100).toFixed(2);
  const myBets = state?.my_bets || [];
  const statusLabel = state?.paused ? "Paused" : myBets.length > 0 && !bettingOpen ? "BET LOCKED" : bettingOpen && remaining <= 5 ? "LAST CALL" : myBets.length > 0 ? "BET PLACED" : bettingOpen ? "Next round" : holding ? "Result" : round ? "Closed" : last ? "Result" : "Starting";
  const secLeft = bettingOpen ? Math.ceil(remaining) : 0;
  const ticked = useRef(null);
  useEffect(() => {
    const key = `${round?.id}:${secLeft}`;
    if (secLeft >= 1 && secLeft <= 5 && ticked.current !== key) {
      ticked.current = key;
      playTickSound(secLeft === 1);
    }
  }, [secLeft, round?.id]);

  const placeBet = async () => {
    unlockAudio();
    if (!side) return toast.error("Select ODD or EVEN");
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return toast.error("Enter a stake amount");
    if (paise > (state?.balance || 0)) return toast.error("Insufficient balance. Please deposit.");
    setBusy(true);
    try {
      const { data } = await api.post("/game/bet", { side, amount: paise, client_key: newKey() });
      playBetSound();
      toast.success(`Bet placed: ${side} ${inr(paise)} · ID ${data.bet.id.slice(0, 8)}`);
      document.activeElement?.blur?.();
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-[100dvh] flex flex-col" data-testid="game-page" onClickCapture={(e) => { if (!user && e.target.closest("button,a,input")) { e.preventDefault(); e.stopPropagation(); nav("/login"); } }}>
      <header className="sticky top-0 shrink-0 z-30 px-4 safe-top pb-1.5 bg-[#050505]/95 border-b border-white/5" data-testid="sticky-header">
        <TopBar balance={state?.balance} music={music} onToggleMusic={toggleMusic} />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Link to="/refer" data-testid="refer-earn-badge"
            className="inline-flex items-center gap-1.5 h-7 pl-0.5 pr-3 rounded-full border border-[#d4af37]/45 bg-gradient-to-r from-[#d4af37]/15 to-white/5 text-[11px] font-bold whitespace-nowrap hover:border-[#d4af37]/80 transition-colors">
            <span className="h-6 w-6 rounded-full silver-btn flex items-center justify-center"><Gift size={11} /></span>
            <span className="gold-text">Refer & Earn {inr0(referBonus)}</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <IconLink to="/messages" icon={Mail} label="Messages" testid="nav-messages" badge={coupons} />
            <IconLink to="/support" icon={Headset} label="Support" testid="nav-support" />
            <IconLink to="/wallet" icon={WalletIcon} label="Wallet" testid="nav-wallet" />
          </div>
        </div>
      </header>

      <Confetti burstKey={burst} />
      <OutcomeCard data={outcome} onClose={() => setOutcome(null)} />
      <WinTicker winners={state?.winners || NONE} />
      <main className="flex-1 px-4 pt-2 pb-3 flex flex-col justify-evenly gap-[clamp(8px,1.4dvh,14px)]">
        <div className="relative shrink-0 panel !rounded-[24px] px-4 py-[clamp(6px,1.2dvh,12px)] overflow-hidden" data-testid="game-board">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="text-[10px] text-neutral-500 mono justify-self-start" data-testid="round-number">Round #{round?.number || last?.number || "—"}</span>
            <CountdownRing label={statusLabel} value={bettingOpen ? fmtTime(remaining) : "00:00"} locked={myBets.length > 0}
              hurry={bettingOpen && remaining <= 5}
              progress={bettingOpen ? remaining / (state?.config?.round_seconds || 30) : 0} />
            <span className={`text-[10px] justify-self-end font-semibold ${myBets.length > 0 ? "text-emerald-400" : bettingOpen ? "text-emerald-400" : "text-neutral-500"}`} data-testid="round-status">
              {myBets.length > 0 && !bettingOpen ? <span className="inline-flex items-center gap-1"><Lock size={10} />Bet locked</span> : myBets.length > 0 ? "Bet placed" : bettingOpen ? "Betting open" : "Betting closed"}
            </span>
          </div>
          <div className="flex items-center justify-around relative mt-[clamp(2px,0.8dvh,10px)] py-[10px]">
            <SideCircle side="ODD" multiplier={mult} active={side === "ODD"} dim={side === "EVEN"} onClick={pickOdd} />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-white/30 via-white/10 to-transparent" />
            <SideCircle side="EVEN" multiplier={mult} active={side === "EVEN"} dim={side === "ODD"} onClick={pickEven} />
          </div>
        </div>
        <ResultStage label={reveal.label} final={reveal.final} />
        <RecentResults results={state?.recent || NONE} />
      </main>

      <footer className="sticky bottom-0 shrink-0 z-30 px-4 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] bg-[#050505]/95 border-t border-white/10 space-y-1.5" data-testid="sticky-bet-bar">
        <StakePicker amount={amount} setAmount={setAmount} balance={state?.balance || 0} maxStake={state?.config?.max_stake} />
        <div className="h-4 text-center text-[11px] leading-4 text-neutral-400 truncate" data-testid="my-round-bets">
          {myBets.length > 0 ? `Your bets: ${myBets.map((b) => `${b.side} ${inr(b.amount)}`).join(" · ")}` : bettingOpen ? "Pick ODD or EVEN, then place your bet" : "Wait for the result. The next round starts after it"}
        </div>
        <button onClick={placeBet} disabled={user && (busy || !bettingOpen)} data-testid="place-bet-button"
          className="silver-btn rounded-full h-[clamp(40px,6dvh,48px)] w-full text-[clamp(15px,2.3dvh,18px)] font-extrabold tracking-wide">
          {!user ? "LOGIN TO PLAY" : busy ? "PLACING…" : bettingOpen ? `PLACE BET${side ? ` · ${side}` : ""}` : "BETTING CLOSED"}
        </button>
      </footer>
    </div>
  );
}
