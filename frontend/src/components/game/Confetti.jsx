import { useMemo } from "react";

export const Confetti = ({ burstKey }) => {
  const pieces = useMemo(
    () => Array.from({ length: 46 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 0.25, dur: 1.2 + Math.random() * 0.8,
      w: 5 + Math.random() * 6, h: 8 + Math.random() * 10, rot: Math.random() * 360, drift: (Math.random() - 0.5) * 120, i,
    })),
    [burstKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!burstKey) return null;
  return (
    <div key={burstKey} className="fixed inset-0 pointer-events-none z-50 overflow-hidden" data-testid="win-confetti">
      {pieces.map((p) => (
        <span key={p.i} className="confetti-piece" style={{
          left: `${p.left}%`, width: p.w, height: p.h, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
          "--rot": `${p.rot}deg`, "--drift": `${p.drift}px`,
        }} />
      ))}
    </div>
  );
};
