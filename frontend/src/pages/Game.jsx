import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, Mail, Gift, Wallet as WalletIcon, Gamepad2 } from "lucide-react";
import { api, errMsg, inr, newKey, toPaise } from "@/lib/api";
import { TopBar, CountdownRing, SideCircle, StakePicker, ResultStage, RecentResults } from "@/components/game/GameParts";
import { useMusic, useRevealAnimation } from "@/components/game/hooks";

const fmtTime = (s) => `00:${String(Math.max(0, Math.ceil(s))).padStart(2, "0")}`;

const QuickLink = ({ to, icon: Icon, label, testid, badge }) => (
  <Link to={to} data-testid={testid} className="ghost-chip rounded-2xl h-16 flex flex-col items-center justify-center gap-1 text-xs text-neutral-300 relative">
    <Icon size={18} />
    {label}
    {badge > 0 && <span className="absolute top-1.5 right-2 h-4 min-w-4 px-1 rounded-full bg-white text-black text-[10px] font-bold">{badge}</span>}
  </Link>
);

export default function Game() {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [side, setSide] = useState(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [coupons, setCoupons] = useState(0);
  const offset = useRef(0);
  const animated = useRef(null);
  const toasted = useRef(null);
  const [music, toggleMusic] = useMusic();
  const reveal = useRevealAnimation();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/game/state");
      offset.current = new Date(data.server_time).getTime() - Date.now();
      setState(data);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const p = setInterval(load, 1000);
    const t = setInterval(() => setNow(Date.now()), 250);
    api.get("/coupons").then(({ data }) => setCoupons(data.filter((c) => c.status === "available").length)).catch(() => {});
    return () => { clearInterval(p); clearInterval(t); };
  }, [load]);

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
    }
    if (last && toasted.current !== last.id && state.last_round_bets.length && animated.current === last.id) {
      toasted.current = last.id;
      setTimeout(() => {
        const won = state.last_round_bets.filter((b) => b.status === "won");
        if (won.length) toast.success(`You won ${inr(won.reduce((s, b) => s + b.payout, 0))}`);
        else toast(`Round #${last.number}: ${last.result}. Better luck next round.`);
      }, 300);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverNow = now + offset.current;
  const remaining = round?.status === "betting" ? (new Date(round.closes_at).getTime() - serverNow) / 1000 : 0;
  const bettingOpen = round?.status === "betting" && remaining > 0;
  const mult = ((state?.config?.multiplier_bps || 195) / 100).toFixed(2);
  const statusLabel = state?.paused ? "Paused" : bettingOpen ? "Next Round In" : round ? "Revealing" : "Starting";

  const placeBet = async () => {
    if (!side) return toast.error("Select ODD or EVEN");
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return toast.error("Enter a stake amount");
    if (paise > (state?.balance || 0)) return toast.error("Insufficient balance. Please deposit.");
    setBusy(true);
    try {
      const { data } = await api.post("/game/bet", { side, amount: paise, client_key: newKey() });
      toast.success(`Bet placed: ${side} ${inr(paise)} · ID ${data.bet.id.slice(0, 8)}`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const myBets = state?.my_bets || [];
  return (
    <div className="relative z-10 mx-auto max-w-[480px] px-4 pt-5 pb-14 space-y-5" data-testid="game-page">
      <TopBar balance={state?.balance} music={music} onToggleMusic={toggleMusic} />

      <div className="relative !mt-[84px] panel !rounded-[34px] pt-24 pb-8 px-4 rise" style={{ animationDelay: "0.06s" }}>
        <CountdownRing label={statusLabel} value={bettingOpen ? fmtTime(remaining) : "00:00"}
          progress={bettingOpen ? remaining / (state?.config?.round_seconds || 30) : 0} />
        <div className="absolute top-3 left-5 text-[11px] text-neutral-500 mono" data-testid="round-number">#{round?.number || "—"}</div>
        <div className="absolute top-3 right-5 text-[11px] text-neutral-500" data-testid="round-status">
          {bettingOpen ? "Betting open" : "Betting closed"}
        </div>
        <div className="flex items-center justify-around relative">
          <SideCircle side="ODD" multiplier={mult} active={side === "ODD"} dim={side === "EVEN"} onClick={() => setSide("ODD")} />
          <div className="absolute left-1/2 top-[-30px] bottom-0 w-px bg-gradient-to-b from-white/40 via-white/15 to-transparent" />
          <SideCircle side="EVEN" multiplier={mult} active={side === "EVEN"} dim={side === "ODD"} onClick={() => setSide("EVEN")} />
        </div>
        <div className="flex justify-around mt-5 text-[11px] text-neutral-500">
          <span>1 · 3 · 5</span><span>2 · 4 · 6</span>
        </div>
      </div>

      <StakePicker amount={amount} setAmount={setAmount} />

      <button onClick={placeBet} disabled={busy || !bettingOpen} data-testid="place-bet-button"
        className="silver-btn rounded-full h-[60px] w-full text-[22px] font-extrabold tracking-wide">
        {busy ? "PLACING…" : bettingOpen ? "PLACE BET" : "BETTING CLOSED"}
      </button>

      {myBets.length > 0 && (
        <div className="text-center text-sm text-neutral-400" data-testid="my-round-bets">
          Your bets this round: {myBets.map((b) => `${b.side} ${inr(b.amount)}`).join(" · ")}
        </div>
      )}

      <div className="glow-line" />
      <ResultStage label={reveal.label} final={reveal.final} />
      <RecentResults results={state?.recent || []} />

      <Link to="/refer" data-testid="referral-ad-banner"
        className="block panel !rounded-3xl p-5 relative overflow-hidden hover:border-white/30 transition-colors">
        <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full silver-btn flex items-center justify-center"><Gift size={22} /></div>
          <div>
            <div className="font-bold">Refer & Earn ₹300</div>
            <div className="text-xs text-neutral-400">Your friend deposits ₹500+ and you get a ₹300 bonus coupon</div>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-4 gap-2">
        <QuickLink to="/practice" icon={Gamepad2} label="Practice" testid="nav-practice" />
        <QuickLink to="/messages" icon={Mail} label="Messages" testid="nav-messages" badge={coupons} />
        <QuickLink to="/refer" icon={Sparkles} label="Refer" testid="nav-refer" />
        <QuickLink to="/wallet" icon={WalletIcon} label="Wallet" testid="nav-wallet" />
      </div>
      <p className="text-[11px] text-neutral-600 text-center leading-relaxed">
        Results use a cryptographically secure random draw recorded before reveal and never depend on bets placed. ODD wins on 1, 3, 5 · EVEN wins on 2, 4, 6 ·
        Winning return {mult}× stake. Play responsibly. 18+.
      </p>
    </div>
  );
}
