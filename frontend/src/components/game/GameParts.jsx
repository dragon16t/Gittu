import { memo } from "react";
import { Link } from "react-router-dom";
import { User, Plus, Settings, ChevronRight, X, Volume2, VolumeX } from "lucide-react";
import { inr } from "@/lib/api";

export const TopBar = memo(({ balance, music, onToggleMusic }) => (
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-3 min-w-0">
      <Link to="/settings" className="h-10 w-10 shrink-0 rounded-full ghost-chip flex items-center justify-center" data-testid="profile-button">
        <User size={19} strokeWidth={1.6} />
      </Link>
      <div className="min-w-0">
        <div className="text-neutral-400 text-xs">Balance</div>
        <div className="text-[clamp(14px,4.4vw,18px)] font-bold leading-tight tracking-tight truncate" data-testid="header-balance">{inr(balance)}</div>
      </div>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={onToggleMusic} className="h-8 w-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white"
        data-testid="music-toggle-button" aria-label="Toggle music">
        {music ? <Volume2 size={17} /> : <VolumeX size={17} />}
      </button>
      <Link to="/deposit" className="silver-btn rounded-full h-9 pl-3.5 pr-1 flex items-center gap-2 font-semibold text-sm" data-testid="header-deposit-button">
        Deposit
        <span className="h-7 w-7 rounded-full bg-black text-white flex items-center justify-center"><Plus size={15} /></span>
      </Link>
      <Link to="/settings" className="h-8 w-8 flex items-center justify-center text-neutral-300 hover:text-white" data-testid="settings-button"><Settings size={22} /></Link>
    </div>
  </div>
));

export const CountdownRing = ({ label, value, progress, locked, hurry }) => {
  const r = 66;
  const c = 2 * Math.PI * r;
  const grad = locked ? "ringgreen" : hurry ? "ringhot" : "ringg";
  return (
    <div className={`notch flex flex-col items-center justify-center ${hurry ? "ring-hurry" : ""} ${locked ? "ring-locked" : ""}`} data-testid="round-countdown">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} stroke={locked ? "rgba(52,211,153,0.18)" : "rgba(255,255,255,0.08)"} strokeWidth="4" fill="none" />
        <circle cx="75" cy="75" r={r} stroke={`url(#${grad})`} strokeWidth={locked ? 5 : 4} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (locked && progress === 0 ? 1 : progress))} style={{ transition: "stroke-dashoffset 0.95s linear, stroke-width 0.3s" }} />
        <defs>
          <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#8a8a8a" /></linearGradient>
          <linearGradient id="ringgreen" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#6ee7b7" /><stop offset="100%" stopColor="#059669" /></linearGradient>
          <linearGradient id="ringhot" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#f87171" /></linearGradient>
        </defs>
      </svg>
      <div className={`relative text-[clamp(7px,1.1dvh,9px)] leading-none font-bold tracking-wider ${locked ? "text-emerald-300" : hurry ? "text-amber-200" : "text-neutral-400"}`} data-testid="round-status-label">{label}</div>
      <div className={`relative text-[clamp(14px,2.5dvh,24px)] font-extrabold leading-tight mono tracking-tight ${hurry ? "beat text-amber-100" : ""} ${locked && !hurry ? "text-emerald-100" : ""}`} data-testid="round-countdown-value">{value}</div>
    </div>
  );
};

export const SideCircle = memo(({ side, multiplier, active, dim, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    data-testid={`select-${side.toLowerCase()}-button`}
    className={`side-ring relative w-[min(28vw,15dvh)] max-w-[136px] aspect-square flex flex-col items-center justify-center ${active ? "active" : ""} ${dim ? "dim" : ""}`}
  >
    <span className="inner-ring" />
    <span className="relative text-[clamp(17px,min(7vw,3.6dvh),34px)] font-black silver-text leading-none">{side}</span>
    <span className="relative mt-0.5 text-[clamp(10px,1.7dvh,15px)] font-bold text-neutral-200">{multiplier}x</span>
  </button>
));

const PRESETS = [1000, 5000, 10000, 50000, 100000];
const PCTS = [100, 75, 50, 25];
export const StakePicker = memo(({ amount, setAmount, balance, maxStake }) => {
  const pick = (pct) => {
    const paise = Math.min(Math.floor((balance * pct) / 100 / 100) * 100, maxStake || Infinity);
    setAmount(paise > 0 ? String(paise / 100) : "");
  };
  return (
  <div>
    <div className="sr-only">Bet Amount (₹)</div>
    <div className="field h-[clamp(36px,5.2dvh,44px)] flex items-center px-4 gap-4">
      <span className="text-lg text-neutral-400">₹</span>
      <input type="number" inputMode="decimal" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
        className="text-base font-semibold" placeholder="Bet amount" data-testid="stake-amount-input" />
      {amount !== "" && (
        <button onClick={() => setAmount("")} className="h-7 w-7 rounded-full bg-neutral-300 text-black flex items-center justify-center" data-testid="stake-clear-button">
          <X size={15} strokeWidth={3} />
        </button>
      )}
    </div>
    <div className="grid grid-cols-5 gap-1.5 mt-1.5">
      {PRESETS.map((p) => {
        const on = Math.round(parseFloat(amount || 0) * 100) === p;
        return (
          <button key={p} onClick={() => setAmount(String(p / 100))} data-testid={`stake-preset-${p / 100}`}
            className={`h-[clamp(30px,4.4dvh,36px)] rounded-xl text-[clamp(11px,3.4vw,14px)] font-bold whitespace-nowrap ${on ? "silver-btn" : "ghost-chip text-neutral-100"}`}>
            ₹{(p / 100).toLocaleString("en-IN")}
          </button>
        );
      })}
    </div>
    <div className="grid grid-cols-4 gap-1.5 mt-1.5" data-testid="stake-percent-row">
      {PCTS.map((p) => (
        <button key={p} onClick={() => pick(p)} disabled={balance < 100} data-testid={`stake-pct-${p}`}
          className="h-[clamp(26px,3.8dvh,32px)] rounded-xl text-[clamp(11px,3.2vw,13px)] font-bold ghost-chip text-neutral-200 disabled:opacity-40">
          {p}%
        </button>
      ))}
    </div>
  </div>
  );
});

const SPARKS = [[14, 22], [26, 45], [8, 70], [20, 82], [80, 18], [86, 50], [74, 62], [92, 74], [60, 12], [36, 10]];
export const ResultStage = memo(({ label, final, practice }) => (
  <div className="panel shrink-0 relative overflow-hidden h-[clamp(76px,12.5dvh,150px)] flex items-center justify-center px-4" data-testid="result-stage">
    {SPARKS.map(([x, y], i) => (
      <span key={i} className="sparkle" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.3}s`, width: i % 3 ? 5 : 7, height: i % 3 ? 5 : 7 }} />
    ))}
    <div className={`capsule relative w-[62%] h-[74%] flex flex-col items-center justify-center ${final ? "capsule-final" : ""}`}>
      <div className="text-[clamp(7px,1.1dvh,10px)] tracking-[0.25em] text-neutral-400 leading-none">{practice ? "PRACTICE" : "RESULT"}</div>
      <div className={`text-[clamp(20px,min(9vw,4.4dvh),46px)] font-black silver-text leading-none mt-1 ${final ? "result-glow" : ""}`} data-testid="result-label">
        {label || "—"}
      </div>
    </div>
  </div>
));

export const ResultChip = ({ r, size = 46, testid }) => (
  <span data-testid={testid} className={`res-chip ${r === "ODD" ? "res-odd" : "res-even"}`}
    style={{ width: size, height: size, fontSize: size * 0.27 }}>{r}</span>
);

export const RecentResults = memo(({ results }) => (
  <div className="panel shrink-0 !rounded-2xl px-3 py-2" data-testid="recent-results">
    <div className="flex items-center justify-between mb-1.5">
      <span className="font-semibold text-xs">Recent Results</span>
      <Link to="/history" className="text-neutral-400 text-xs flex items-center gap-1 hover:text-white" data-testid="view-all-results-link">
        View All <ChevronRight size={16} />
      </Link>
    </div>
    <div className="grid grid-cols-10 gap-1">
      {results.length ? results.map((r, i) => (
        <span key={i} data-testid={`recent-result-${i}`} className={`res-chip aspect-square w-full text-[clamp(7px,2.3vw,11px)] !border-[1.5px] ${r === "ODD" ? "res-odd" : "res-even"}`}>{r}</span>
      )) : (
        <span className="col-span-10 text-neutral-500 text-xs">Waiting for first result…</span>
      )}
    </div>
    <div className="sr-only" data-testid="recent-results-text">{results.join(" | ")}</div>
  </div>
));
