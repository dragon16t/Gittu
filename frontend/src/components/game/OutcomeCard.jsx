import { useEffect } from "react";
import { Trophy } from "lucide-react";
import { inr } from "@/lib/api";
import { ResultChip } from "@/components/game/GameParts";

export const OutcomeCard = ({ data, onClose }) => {
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(onClose, data.won ? 3600 : 2800);
    return () => clearTimeout(t);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const { won, amount, staked, round, result } = data;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-6 bg-black/55 backdrop-blur-[3px]" onClick={onClose} data-testid="outcome-overlay">
      <div className={`outcome-pop relative w-full max-w-[340px] rounded-[28px] p-[1.5px] ${won ? "bg-gradient-to-b from-[#f5dc8a] via-[#c99a2e] to-[#5b4413]" : "bg-gradient-to-b from-white/30 via-white/10 to-white/5"}`} data-testid={won ? "outcome-win-card" : "outcome-loss-card"}>
        <div className={`relative overflow-hidden rounded-[27px] px-6 pt-7 pb-6 text-center ${won ? "bg-[radial-gradient(120%_90%_at_50%_0%,#3b2d0b_0%,#120d03_55%,#050402_100%)]" : "bg-[radial-gradient(120%_90%_at_50%_0%,#2a1212_0%,#0d0707_60%,#050505_100%)]"}`}>
          {won && <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-40 rounded-full bg-[#f5dc8a]/25 blur-3xl" />}
          <div className={`mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold tracking-[0.25em] ${won ? "bg-[#f5dc8a]/15 border border-[#f5dc8a]/50 text-[#f5dc8a]" : "bg-red-500/10 border border-red-400/30 text-red-300"}`} data-testid="outcome-badge">
            {won && <Trophy size={11} />}{won ? "YOU WON" : "ROUND LOST"}
          </div>
          <div className="mt-4 flex justify-center"><ResultChip r={result} size={64} /></div>
          <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-neutral-400">Round #{round} · Result <b className="text-white">{result}</b></div>
          {won ? (
            <>
              <div className="mt-4 text-[44px] leading-none font-black gold-text" data-testid="outcome-amount">+{inr(amount)}</div>
              <div className="mt-2 text-xs text-neutral-300">Credited to your wallet · stake {inr(staked)}</div>
            </>
          ) : (
            <>
              <div className="mt-4 text-[30px] leading-none font-black text-neutral-100" data-testid="outcome-amount">−{inr(staked)}</div>
              <div className="mt-2 text-xs text-neutral-400">Better luck next round. Betting is open again.</div>
            </>
          )}
          <div className="mt-5 text-[10px] text-neutral-500">Tap anywhere to continue</div>
        </div>
      </div>
    </div>
  );
};
