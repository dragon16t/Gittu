import { Plus, X } from "lucide-react";

const cell = "h-9 w-full rounded-lg bg-black border border-white/15 px-2 text-xs mono text-white normal-case tracking-normal mt-1";
const r1 = (n) => Math.round(n * 10) / 10;

export const bandTotal = (bands) => Math.round(bands.reduce((s, b) => s + (parseFloat(b[2]) || 0), 0) * 100) / 100;

// Spread a change over the other rows in proportion to their share so the total stays 100%.
const rebalance = (bands, fixed) => {
  const keep = fixed == null ? 0 : Math.min(100, Math.max(0, parseFloat(bands[fixed][2]) || 0));
  const others = bands.map((_, i) => i).filter((i) => i !== fixed);
  if (!others.length) return bands.map((b) => [b[0], b[1], 100]);
  const left = 100 - keep;
  const sum = others.reduce((s, i) => s + (parseFloat(bands[i][2]) || 0), 0);
  const out = bands.map((b, i) => [b[0], b[1], i === fixed ? keep : r1(sum > 0 ? ((parseFloat(b[2]) || 0) / sum) * left : left / others.length)]);
  const big = others.reduce((a, i) => (out[i][2] > out[a][2] ? i : a), others[0]);
  out[big][2] = r1(out[big][2] + 100 - bandTotal(out));
  return out;
};

export const BandEditor = ({ bands, onChange, testid }) => {
  const setX = (i, j) => (e) => onChange(bands.map((b, k) => (k === i ? b.map((x, m) => (m === j ? e.target.value : x)) : b)));
  const setPct = (i) => (e) => {
    const next = bands.map((b, k) => (k === i ? [b[0], b[1], e.target.value] : b));
    onChange(e.target.value === "" ? next : rebalance(next, i));
  };
  const total = bandTotal(bands);
  const ok = Math.abs(total - 100) < 0.01;
  return (
    <div className="space-y-1.5" data-testid={testid}>
      <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
        <span>From ×</span><span>To ×</span><span>% rounds</span><span />
      </div>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-1.5 items-center">
          <input type="number" step="0.01" value={b[0]} onChange={setX(i, 0)} className={cell} data-testid={`${testid}-from-${i}`} />
          <input type="number" step="0.01" value={b[1]} onChange={setX(i, 1)} className={cell} data-testid={`${testid}-to-${i}`} />
          <input type="number" step="0.1" value={b[2]} onChange={setPct(i)} onBlur={() => !ok && onChange(rebalance(bands, null))} className={cell} data-testid={`${testid}-pct-${i}`} />
          <button type="button" onClick={() => onChange(rebalance(bands.filter((_, k) => k !== i), null))} disabled={bands.length < 2}
            className="h-7 w-7 rounded-full text-neutral-500 hover:text-red-400 disabled:opacity-30" data-testid={`${testid}-remove-${i}`}><X size={14} /></button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => onChange(rebalance([...bands, [2, 3, 5]], bands.length))} disabled={bands.length >= 15}
          className="flex items-center gap-1 text-xs text-neutral-300 hover:text-white" data-testid={`${testid}-add`}><Plus size={13} />Add range</button>
        <span className={`text-xs font-bold ${ok ? "text-emerald-300" : "text-red-400"}`} data-testid={`${testid}-total`}>Total {total}% {ok ? "✓" : "· must be 100%"}</span>
      </div>
    </div>
  );
};

export const OneXShare = ({ min, max, onChange, testid }) => (
  <div className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-3 space-y-2" data-testid={testid}>
    <div className="text-xs text-amber-200">Of rounds ending below 2×, this share crashes at exactly 1.00× (random between min and max each round)</div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-[10px] uppercase tracking-wider text-neutral-500">Min %<input type="number" step="1" value={min} onChange={(e) => onChange(e.target.value, max)} className={cell} data-testid={`${testid}-min`} /></label>
      <label className="text-[10px] uppercase tracking-wider text-neutral-500">Max %<input type="number" step="1" value={max} onChange={(e) => onChange(min, e.target.value)} className={cell} data-testid={`${testid}-max`} /></label>
    </div>
  </div>
);

export const toBands = (bands) => bands.map((b) => ({ from: +b[0], to: +b[1], pct: +b[2] }));
