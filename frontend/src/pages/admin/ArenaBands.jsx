import { Plus, X } from "lucide-react";

const cell = "h-9 w-full rounded-lg bg-black border border-white/15 px-2 text-xs mono";

export const bandTotal = (bands) => Math.round(bands.reduce((s, b) => s + (parseFloat(b[2]) || 0), 0) * 100) / 100;

export const BandEditor = ({ bands, onChange, testid }) => {
  const set = (i, j) => (e) => onChange(bands.map((b, k) => (k === i ? b.map((x, m) => (m === j ? e.target.value : x)) : b)));
  const total = bandTotal(bands);
  const ok = Math.abs(total - 100) < 0.01;
  return (
    <div className="space-y-1.5" data-testid={testid}>
      <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
        <span>From ×</span><span>To ×</span><span>% rounds</span><span />
      </div>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-1.5 items-center">
          <input type="number" step="0.01" value={b[0]} onChange={set(i, 0)} className={cell} data-testid={`${testid}-from-${i}`} />
          <input type="number" step="0.01" value={b[1]} onChange={set(i, 1)} className={cell} data-testid={`${testid}-to-${i}`} />
          <input type="number" step="0.1" value={b[2]} onChange={set(i, 2)} className={cell} data-testid={`${testid}-pct-${i}`} />
          <button type="button" onClick={() => onChange(bands.filter((_, k) => k !== i))} disabled={bands.length < 2}
            className="h-7 w-7 rounded-full text-neutral-500 hover:text-red-400 disabled:opacity-30" data-testid={`${testid}-remove-${i}`}><X size={14} /></button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => onChange([...bands, [2, 3, 0]])} disabled={bands.length >= 15}
          className="flex items-center gap-1 text-xs text-neutral-300 hover:text-white" data-testid={`${testid}-add`}><Plus size={13} />Add range</button>
        <span className={`text-xs font-bold ${ok ? "text-emerald-300" : "text-red-400"}`} data-testid={`${testid}-total`}>Total {total}% {ok ? "✓" : "· must be 100%"}</span>
      </div>
    </div>
  );
};

export const toBands = (bands) => bands.map((b) => ({ from: +b[0], to: +b[1], pct: +b[2] }));
