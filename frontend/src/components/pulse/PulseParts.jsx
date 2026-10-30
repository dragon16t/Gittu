import { memo } from "react";
import { Minus, Plus, Trophy, ChevronRight, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { inr } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ART } from "@/lib/assets";

const C = 2 * Math.PI * 190;

export const PulseTicker = memo(function PulseTicker({ winners }) {
  const t = useT();
  if (!winners.length) return <div className="h-[28px] shrink-0 border-y border-white/5" />;
  const items = [...winners, ...winners];
  return (
    <div className="ticker shrink-0 h-[28px] overflow-hidden border-y border-white/5 bg-white/[0.02] flex items-center text-[13px]" data-testid="pulse-win-feed">
      <div className="ticker-track px-2">
        {items.map((w, i) => (
          <span key={i} className="text-neutral-200"><Trophy size={14} className="inline -mt-0.5 mr-1.5 text-[#FFC52E]" />
            {w.name} {t("won")} <b className="text-[#00F58A]">{inr(w.payout)}</b> {t("at")} <span className="text-[#00F58A]">{w.multiplier.toFixed(2)}x</span></span>
        ))}
      </div>
    </div>
  );
});

export const MAX_ARC = 3000;
const HALF = MAX_ARC / 2;
export const arcFrac = (m) => (m <= 1 ? 0 : m <= HALF ? 0.5 * Math.log(m) / Math.log(HALF) : Math.min(1, 0.5 + 0.5 * (m - HALF) / HALF));

export const Arena = ({ m, status }) => {
  const t = useT();
  const crashed = status === "crashed";
  const frac = status === "running" || crashed ? arcFrac(m) : 0;
  const a = frac * 2 * Math.PI;
  const dot = { x: 200 + 190 * Math.sin(a), y: 200 - 190 * Math.cos(a) };
  const txt = `${m.toFixed(2)}x`;
  return (
    <div className="relative mx-auto aspect-square w-[min(100%,calc(100dvh-530px))] min-w-[230px] [container-type:inline-size]" data-testid="pulse-arena">
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <filter id="pglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="pbg"><stop offset="0.55" stopColor="#00F58A" stopOpacity="0.10" /><stop offset="1" stopColor="#00F58A" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx="200" cy="200" r="200" fill="url(#pbg)" />
        <circle cx="200" cy="200" r="190" fill="none" stroke="#ff3b4e" strokeOpacity="0.28" strokeWidth="9" data-testid="pulse-track" />
        <circle cx="200" cy="200" r="190" fill="none" stroke="#00F58A" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 200 200)" filter="url(#pglow)" data-testid="pulse-arc" />
        <circle cx="200" cy="200" r="160" fill="none" stroke="#ffffff10" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="138" fill="none" stroke="#ffffffb0" strokeWidth="1.6" strokeDasharray="7 7" />
        <circle cx="200" cy="200" r="116" fill="none" stroke="#ffffff12" strokeWidth="16" />
        {[0, 45, 90, 135].map((d) => (
          <line key={d} x1="200" y1="28" x2="200" y2="372" stroke="#ffffff" strokeOpacity={d % 90 ? 0.16 : 0.3} strokeWidth="1.2" transform={`rotate(${d} 200 200)`} />
        ))}
        <circle cx="200" cy="10" r="5" fill="#00F58A" opacity="0.5" />
        <g data-testid="pulse-pointer"><circle cx={dot.x} cy={dot.y} r="11" fill="#7dffc4" filter="url(#pglow)" /><circle cx={dot.x} cy={dot.y} r="6" fill="#eafff4" /></g>
      </svg>
      <img src={ART.sphere} alt="" className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42%] rounded-full mix-blend-screen ${status === "running" ? "animate-[pulse_1.6s_ease-in-out_infinite]" : ""}`} />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="font-black tracking-tight leading-none text-white whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
          style={{ fontSize: `${Math.min(20, 66 / (0.6 * txt.length))}cqw` }} data-testid="pulse-multiplier">{txt}</div>
        {crashed && <div className="mt-[2cqw] rounded-full bg-black/70 px-3 py-1 text-[4.2cqw] font-extrabold tracking-[0.2em] text-[#ff3b4e]" data-testid="pulse-round-ends">{t("ROUND ENDS")}</div>}
      </div>
    </div>
  );
};

export const TimerBar = ({ status, secs, total, totalWin }) => {
  const t = useT();
  const betting = status === "betting";
  const frac = betting ? Math.max(0, Math.min(1, secs / total)) : 0;
  return (
    <div className="relative mx-auto -mt-3 w-[82%] max-w-[330px] rounded-[20px] border border-white/10 bg-[#0b0e0e] px-4 py-2 text-center" data-testid="pulse-timer">
      <div className="text-[13px] text-neutral-300 leading-none" data-testid="pulse-timer-title">{betting ? t("Place your bets") : t("Total Win")}</div>
      {betting ? (
        <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden flex justify-end"><div className="h-full bg-[#00F58A]" style={{ width: `${frac * 100}%` }} /></div>
          <div className="mono font-bold text-[26px] leading-none text-[#00F58A] drop-shadow-[0_0_10px_rgba(0,245,138,0.6)]" data-testid="pulse-countdown">00:{String(Math.ceil(secs)).padStart(2, "0")}</div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00F58A]" style={{ width: `${frac * 100}%` }} /></div>
        </div>
      ) : (
        <div className="mt-1.5 font-extrabold text-[26px] leading-none text-[#00F58A] drop-shadow-[0_0_10px_rgba(0,245,138,0.6)]" data-testid="pulse-total-win">{inr(totalWin)}</div>
      )}
    </div>
  );
};

const CHIPS = [1000, 5000, 10000, 50000];

export const BetCard = ({ slot, amount, setAmount, bet, status, m, busy, flash, onAction }) => {
  const t = useT();
  const live = bet && bet.status === "active";
  const locked = !!bet || status !== "betting";
  let label, tone = "silver", disabled = busy;
  if (bet?.status === "collected") { label = `${t("COLLECTED")} ${inr(bet.payout)}`; tone = "done"; disabled = true; }
  else if (bet?.status === "lost") { label = t("ROUND LOST"); tone = "lost"; disabled = true; }
  else if (live && status === "running") { label = `${t("COLLECT")} ${inr(Math.floor(bet.stake * Math.round(m * 100) / 100))}`; tone = "green"; }
  else if (live) { label = `${t("BET PLACED")} ${inr(bet.stake)}`; tone = "placed"; disabled = true; }
  else if (status === "betting") label = t("PLACE BET");
  else { label = t("NEXT ROUND"); tone = "wait"; disabled = true; }
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
        <span className="text-[16px] text-neutral-200">{t("Bet")} {slot}</span>
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
        className={`w-full h-12 rounded-full flex items-center justify-center gap-2 font-extrabold text-[clamp(11px,3.3vw,15px)] whitespace-nowrap tracking-normal px-2 transition-[background-color,box-shadow,transform] active:scale-[0.98] ${toneCls}`}>
        {tone === "silver" && !flash && <WalletCards size={19} />}{flash || label}
      </button>
    </div>
  );
};

export const RecentRounds = memo(function RecentRounds({ rounds }) {
  const t = useT();
  return (
    <div className="rounded-[20px] border border-white/10 bg-[#0b0e0e] px-3.5 py-2" data-testid="pulse-recent">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-bold">{t("Recent Rounds")}</span>
        <Link to="/history?tab=pulse" className="text-[13px] text-neutral-400 flex items-center gap-1" data-testid="pulse-view-all">{t("View All")} <ChevronRight size={15} /></Link>
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
