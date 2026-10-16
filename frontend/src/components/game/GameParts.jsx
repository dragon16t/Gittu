import { Link } from "react-router-dom";
import { User, Plus, Settings, ChevronRight, X, Volume2, VolumeX } from "lucide-react";
import { inr } from "@/lib/api";

export const TopBar = ({ balance, music, onToggleMusic }) => (
  <div className="flex items-center justify-between rise">
    <div className="flex items-center gap-4">
      <Link to="/settings" className="h-14 w-14 rounded-full ghost-chip flex items-center justify-center" data-testid="profile-button">
        <User size={26} strokeWidth={1.6} />
      </Link>
      <div>
        <div className="text-neutral-400 text-sm">Balance</div>
        <div className="text-xl font-bold tracking-tight" data-testid="header-balance">{inr(balance)}</div>
      </div>
    </div>
    <div className="flex items-center gap-2.5">
      <button onClick={onToggleMusic} className="h-9 w-9 rounded-full flex items-center justify-center text-neutral-400 hover:text-white"
        data-testid="music-toggle-button" aria-label="Toggle music">
        {music ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      <Link to="/deposit" className="silver-btn rounded-full h-11 pl-5 pr-1.5 flex items-center gap-3 font-semibold" data-testid="header-deposit-button">
        Deposit
        <span className="h-8 w-8 rounded-full bg-black text-white flex items-center justify-center"><Plus size={18} /></span>
      </Link>
      <Link to="/settings" className="text-neutral-300 hover:text-white" data-testid="settings-button"><Settings size={26} /></Link>
    </div>
  </div>
);

export const CountdownRing = ({ label, value, progress }) => {
  const r = 66;
  const c = 2 * Math.PI * r;
  return (
    <div className="notch flex flex-col items-center justify-center" data-testid="round-countdown">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="4" fill="none" />
        <circle cx="75" cy="75" r={r} stroke="url(#ringg)" strokeWidth="4" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - progress)} style={{ transition: "stroke-dashoffset 0.95s linear" }} />
        <defs>
          <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#8a8a8a" />
          </linearGradient>
        </defs>
      </svg>
      <div className="text-[12px] text-neutral-400 mt-5" data-testid="round-status-label">{label}</div>
      <div className="text-[34px] font-extrabold leading-tight mono tracking-tight" data-testid="round-countdown-value">{value}</div>
    </div>
  );
};

export const SideCircle = ({ side, multiplier, active, dim, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    data-testid={`select-${side.toLowerCase()}-button`}
    className={`side-ring relative w-[33vw] max-w-[160px] aspect-square flex flex-col items-center justify-center ${active ? "active" : ""} ${dim ? "dim" : ""}`}
  >
    <span className="inner-ring" />
    <span className="relative text-[clamp(30px,9vw,44px)] font-black silver-text leading-none">{side}</span>
    <span className="relative mt-2 text-lg font-bold text-neutral-200">{multiplier}x</span>
  </button>
);

const PRESETS = [1000, 5000, 10000, 50000, 100000];
export const StakePicker = ({ amount, setAmount }) => (
  <div className="rise" style={{ animationDelay: "0.12s" }}>
    <div className="text-neutral-400 text-sm mb-2">Bet Amount (₹)</div>
    <div className="field h-14 flex items-center px-4 gap-4">
      <span className="text-2xl text-neutral-400">₹</span>
      <input type="number" inputMode="decimal" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
        className="text-lg font-semibold" data-testid="stake-amount-input" />
      {amount !== "" && (
        <button onClick={() => setAmount("")} className="h-7 w-7 rounded-full bg-neutral-300 text-black flex items-center justify-center" data-testid="stake-clear-button">
          <X size={15} strokeWidth={3} />
        </button>
      )}
    </div>
    <div className="grid grid-cols-5 gap-2 mt-3">
      {PRESETS.map((p) => {
        const on = Math.round(parseFloat(amount || 0) * 100) === p;
        return (
          <button key={p} onClick={() => setAmount(String(p / 100))} data-testid={`stake-preset-${p / 100}`}
            className={`h-12 rounded-xl text-[15px] font-bold ${on ? "silver-btn" : "ghost-chip text-neutral-100"}`}>
            ₹{(p / 100).toLocaleString("en-IN")}
          </button>
        );
      })}
    </div>
  </div>
);

const SPARKS = [[14, 22], [26, 45], [8, 70], [20, 82], [80, 18], [86, 50], [74, 62], [92, 74], [60, 12], [36, 10]];
export const ResultStage = ({ label, final, practice }) => (
  <div className="panel relative overflow-hidden h-[210px] flex items-end justify-center" data-testid="result-stage">
    {SPARKS.map(([x, y], i) => (
      <span key={i} className="sparkle" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.3}s`, width: i % 3 ? 6 : 9, height: i % 3 ? 6 : 9 }} />
    ))}
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[92%] h-14 rounded-[50%] border border-white/10" />
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[62%] h-9 platform" />
    <div className="dome relative w-[64%] h-[175px] mb-[34px] flex flex-col items-center justify-center">
      <div className="text-sm tracking-[0.2em] text-neutral-400 mb-1">{practice ? "PRACTICE" : "RESULT"}</div>
      <div className={`text-[clamp(44px,13vw,64px)] font-black silver-text leading-none ${final ? "result-glow" : ""}`} data-testid="result-label">
        {label || "—"}
      </div>
    </div>
  </div>
);

export const ResultChip = ({ r, size = 46, testid }) => (
  <span data-testid={testid} className={`res-chip ${r === "ODD" ? "res-odd" : "res-even"}`}
    style={{ width: size, height: size, fontSize: size * 0.27 }}>{r}</span>
);

export const RecentResults = ({ results }) => (
  <div className="panel !rounded-3xl p-5" data-testid="recent-results">
    <div className="flex items-center justify-between mb-4">
      <span className="font-semibold">Recent Results</span>
      <Link to="/history" className="text-neutral-400 text-sm flex items-center gap-1 hover:text-white" data-testid="view-all-results-link">
        View All <ChevronRight size={16} />
      </Link>
    </div>
    <div className="grid grid-cols-10 gap-1">
      {results.length ? results.map((r, i) => (
        <span key={i} data-testid={`recent-result-${i}`} className={`res-chip aspect-square w-full text-[clamp(7px,2.3vw,11px)] !border-[1.5px] ${r === "ODD" ? "res-odd" : "res-even"}`}>{r}</span>
      )) : (
        <span className="text-neutral-500 text-sm">Waiting for first result…</span>
      )}
    </div>
    <div className="mt-3 text-xs text-neutral-500 mono" data-testid="recent-results-text">{results.join(" | ")}</div>
  </div>
);
