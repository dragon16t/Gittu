import { inr } from "@/lib/api";

export const WagerProgress = ({ w }) => {
  if (!w) return null;
  const req = w.wager_required || 0;
  const done = w.wager_done || 0;
  const pct = req ? Math.min(100, Math.round((done / req) * 100)) : 100;
  const unlocked = !w.wager_remaining;
  return (
    <div className="mt-4" data-testid="wager-progress">
      <div className="flex justify-between text-[11px] mb-1.5">
        <span className="text-neutral-400">{unlocked ? "Withdrawals unlocked" : "Wagering progress"}</span>
        <span className="mono text-neutral-200" data-testid="wager-progress-text">{unlocked ? "100%" : `${inr(done)} / ${inr(req)} · ${pct}%`}</span>
      </div>
      <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: "var(--silver-h)", boxShadow: "0 0 12px rgba(255,255,255,0.5)" }} />
      </div>
      {!unlocked && <div className="text-[11px] text-amber-200/80 mt-1.5" data-testid="wager-remaining">Bet {inr(w.wager_remaining)} more to unlock withdrawals</div>}
    </div>
  );
};
