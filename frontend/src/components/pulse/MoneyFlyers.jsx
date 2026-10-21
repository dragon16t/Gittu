import { motion, AnimatePresence } from "framer-motion";

const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();

export const makeFlyer = (slot, text, win) => {
  const from = rect(`[data-testid="bet-${slot}-action-button"]`);
  const to = rect('[data-testid="header-balance"]');
  if (!from || !to) return null;
  return { id: `${Date.now()}-${slot}`, text, win, x: from.left + from.width / 2, y: from.top, dx: to.left + 40 - (from.left + from.width / 2), dy: to.top - from.top };
};

export const MoneyFlyers = ({ items, onDone }) => (
  <div className="pointer-events-none fixed inset-0 z-[80]" data-testid="money-flyers">
    <AnimatePresence>
      {items.map((f) => (
        <motion.div key={f.id} data-testid={f.win ? "flyer-win" : "flyer-loss"}
          className={`absolute -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-1.5 font-extrabold text-[20px] border shadow-lg ${f.win
            ? "text-[#00F58A] bg-black/85 border-[#00F58A]/60 shadow-[0_0_24px_rgba(0,245,138,0.55)]"
            : "text-[#ff3b4e] bg-black/85 border-[#ff3b4e]/60 shadow-[0_0_24px_rgba(255,59,78,0.5)]"}`}
          style={{ left: f.x, top: f.y }}
          initial={{ opacity: 0, scale: 0.6, y: 0 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.15, 1, 0.45], x: [0, 0, f.dx * 0.6, f.dx], y: [0, -50, f.dy * 0.6, f.dy] }}
          transition={{ duration: 1.5, times: [0, 0.2, 0.65, 1], ease: "easeInOut" }}
          onAnimationComplete={() => onDone(f.id)}>
          {f.text}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);
