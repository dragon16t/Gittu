import { memo } from "react";
import { Minus, Plus, Trophy, ChevronRight, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { inr, inr0 } from "@/lib/api";
import { ART } from "@/lib/assets";

const C = 2 * Math.PI * 190;

export const PulseTicker = memo(function PulseTicker({ winners }) {
  if (!winners.length) return <div className="h-[28px] shrink-0 border-y border-white/5" />;
  const items = [...winners, ...winners];
  return (
    <div className="ticker shrink-0 h-[28px] overflow-hidden border-y border-white/5 bg-white/[0.02] flex items-center text-[13px]" data-testid="pulse-win-feed">
      <div className="ticker-track px-2">
        {items.map((w, i) => (
          <span key={i} className="text-neutral-200"><Trophy size={14} className="inline -mt-0.5 mr-1.5 text-[#FFC52E]" />
            {w.name} won <b className="text-[#00F58A]">{inr(w.payout)}</b> at <span className="text-[#00F58A]">{w.multiplier.toFixed(2)}x</span></span>
        ))}
      </div>
    </div>
  );
});

export const Arena = ({ m, status, frac, simulated }) => {
  const crashed = status === "crashed";
  return (
    <div className="relative mx-auto aspect-square w-[min(100%,calc(100dvh-530px))] min-w-[230px]" data-testid="pulse-arena">
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <filter id="pglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="pbg"><stop offset="0.55" stopColor="#00F58A" stopOpacity="0.10" /><stop offset="1" stopColor="#00F58A" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx="200" cy="200" r="200" fill="url(#pbg)" />
        <circle cx="200" cy="200" r="190" fill="none" stroke="#ffffff22" strokeWidth="9" />
        <circle cx="200" cy="200" r="190" fill="none" stroke={crashed ? "#ff3b4e" : "#00F58A"} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 200 200)" filter="url(#pglow)"
          style={{ transition: "stroke-dashoffset 120ms linear" }} data-testid="pulse-arc" />
        <circle cx="200" cy="200" r="160" fill="none" stroke="#ffffff10" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="138" fill="none" stroke="#ffffffb0" strokeWidth="1.6" strokeDasharray="7 7" />
        <circle cx="200" cy="200" r="116" fill="none" stroke="#ffffff12" strokeWidth="16" />
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1="200" y1="28" x2="200" y2="372" stroke="#ffffff" strokeOpacity={a % 90 ? 0.16 : 0.3} strokeWidth="1.2" transform={`rotate(${a} 200 200)`} />
        ))}
        <circle cx="200" cy="10" r="11" fill={crashed ? "#ff3b4e" : "#7dffc4"} filter="url(#pglow)" />
        <circle cx="200" cy="10" r="6" fill="#eafff4" />
      </svg>
      <img src={ART.sphere} alt="" className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42%] rounded-full mix-blend-screen ${status === "running" ? "animate-[pulse_1.6s_ease-in-out_infinite]" : ""} ${crashed ? "hue-rotate-[230deg] saturate-150" : ""}`} />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className={`font-black tracking-tight text-[clamp(44px,15vw,72px)] leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] ${crashed ? "text-[#ff5a68]" : "text-white"}`} data-testid="pulse-multiplier">
          {m.toFixed(2)}x
        </div>
        {crashed && <div className="mt-1 text-[12px] font-bold tracking-[0.25em] text-[#ff5a68]" data-testid="pulse-crashed-label">ROUND ENDED</div>}
        {simulated && status !== "betting" && <div className="mt-1 rounded-full bg-black/70 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-neutral-300" data-testid="pulse-sim-label">PRACTICE ROUND · NO STAKES</div>}
      </div>
    </div>
  );
};

export const TimerBar = ({ status, secs, total }) => {
  const frac = status === "betting" ? Math.max(0, Math.min(1, secs / total)) : 0;
  const label = status === "betting" ? "Place your bets" : status === "running" ? "Round in progress" : "Next round starting";
  return (
    <div className="relative mx-auto -mt-3 w-[88%] rounded-[22px] border border-white/10 bg-[#0b0e0e] px-4 py-2 text-center" data-testid="pulse-timer">
      <div className="text-[14px] text-neutral-200">{label}</div>
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 rounded-full border border-neutral-400 text-neutral-400 text-[9px] flex items-center justify-center">◷</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00F58A] ml-auto" style={{ width: `${frac * 100}%` }} /></div>
        <div className="mono font-bold text-[26px] leading-none text-[#00F58A] drop-shadow-[0_0_10px_rgba(0,245,138,0.6)]" data-testid="pulse-countdown">
          00:{String(status === "betting" ? Math.ceil(secs) : 0).padStart(2, "0")}
        </div>
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00F58A]" style={{ width: `${frac * 100}%` }} /></div>
      </div>
    </div>
  );
};

const CHIPS = [1000, 5000, 10000, 50000];

export const BetCard = ({ slot, amount, setAmount, bet, status, m, busy, onAction }) => {
  const live = bet && bet.status === "active";
  const locked = !!bet || status !== "betting";
  let label, tone = "silver", disabled = busy;
  if (bet?.status === "collected") { label = `COLLECTED ${inr0(bet.payout)}`; tone = "done"; disabled = true; }
  else if (bet?.status === "lost") { label = "ROUND LOST"; tone = "lost"; disabled = true; }
  else if (live && status === "running") { label = `COLLECT ${inr(Math.floor(bet.stake * Math.round(m * 100) / 100))}`; tone = "green"; }
  else if (live) { label = `BET PLACED ${inr0(bet.stake)}`; tone = "placed"; disabled = true; }
  else if (status === "betting") label = "PLACE BET";
  else { label = "NEXT ROUND"; tone = "wait"; disabled = true; }
  const toneCls = {
    silver: "silver-btn text-black shadow-[0_0_14px_rgba(0,245,138,0.35)] border border-[#00F58A]/60",
    green: "bg-gradient-to-b from-[#5dffb7] to-[#00c46e] text-black shadow-[0_0_22px_rgba(0,245,138,0.6)]",
    placed: "bg-[#00F58A]/10 text-[#00F58A] border border-[#00F58A]/50",
    done: "bg-[#00F58A]/15 text-[#00F58A] border border-[#00F58A]/60",
    lost: "bg-[#ff3b4e]/10 text-[#ff6b77] border border-[#ff3b4e]/50",
    wait: "bg-white/5 text-neutral-400 border border-white/10",
  }[tone];
  const step = (d) => setAmount(Math.max(1000, (amount || 0) + d));
  return (
    <div className="rounded-[20px] border border-white/10 bg-[#0b0e0e] p-2.5 space-y-1.5" data-testid={`bet-card-${slot}`}>
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-8 rounded-full border-2 border-[#00F58A] text-[#00F58A] font-extrabold flex items-center justify-center">{slot}</span>
        <span className="text-[16px] text-neutral-200">Bet {slot}</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl bg-black/60 border border-white/5 pl-3 pr-1.5 h-11">
        <span className="text-[19px] font-extrabold">₹</span>
        <input value={amount ? amount / 100 : ""} inputMode="numeric" disabled={locked} data-testid={`bet-${slot}-amount-input`}
          onChange={(e) => setAmount(Math.round((parseInt(e.target.value.replace(/\D/g, ""), 10) || 0) * 100))}
          className="min-w-0 flex-1 bg-transparent text-[19px] font-extrabold outline-none disabled:opacity-80" />
        <button type="button" disabled={locked} onClick={() => step(-1000)} className="h-8 w-8 rounded-full border border-white/20 flex items-center justify-center disabled:opacity-40" data-testid={`bet-${slot}-minus`}><Minus size={16} /></button>
        <button type="button" disabled={locked} onClick={() => step(1000)} className="h-8 w-8 rounded-full border border-white/20 flex items-center justify-center disabled:opacity-40" data-testid={`bet-${slot}-plus`}><Plus size={16} /></button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {CHIPS.map((c) => (
          <button key={c} type="button" disabled={locked} onClick={() => setAmount(c)} data-testid={`bet-${slot}-chip-${c / 100}`}
            className={`h-8 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${amount === c ? "silver-btn text-black border-transparent" : "border-white/10 bg-black/40 text-neutral-300"}`}>₹{c / 100}</button>
        ))}
      </div>
      <button type="button" disabled={disabled} onClick={onAction} data-testid={`bet-${slot}-action-button`}
        className={`w-full h-12 rounded-full flex items-center justify-center gap-2 font-extrabold text-[clamp(12px,3.6vw,16px)] tracking-wide transition-[background-color,box-shadow,transform] active:scale-[0.98] ${toneCls}`}>
        {tone === "silver" && <WalletCards size={19} />}{busy ? "…" : label}
      </button>
    </div>
  );
};

export const RecentRounds = memo(function RecentRounds({ rounds }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-[#0b0e0e] px-3.5 py-2" data-testid="pulse-recent">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-bold">Recent Rounds</span>
        <Link to="/history?tab=pulse" className="text-[13px] text-neutral-400 flex items-center gap-1" data-testid="pulse-view-all">View All <ChevronRight size={15} /></Link>
      </div>
      <div className="mt-1.5 grid grid-cols-10 gap-1">
        {rounds.slice(0, 10).map((r) => {
          const hot = r.result >= 100;
          return (
            <div key={r.number} className="flex flex-col items-center gap-1" data-testid={`pulse-recent-${r.number}`}>
              <span className={`h-7 w-7 rounded-full border-2 flex items-center justify-center ${hot ? "border-[#ff3b4e]" : "border-[#00F58A]"}`}>
                <span className={`h-3.5 w-3.5 rounded-full ${hot ? "bg-[#ff3b4e] shadow-[0_0_8px_#ff3b4e]" : "bg-[#00F58A] shadow-[0_0_8px_#00F58A]"}`} />
              </span>
              <span className={`text-[9.5px] whitespace-nowrap ${hot ? "text-[#ff6b77]" : "text-neutral-200"}`}>{r.result >= 100 ? Math.round(r.result) : r.result.toFixed(2)}x</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
