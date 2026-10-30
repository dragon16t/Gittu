import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Infinity as Inf, Users, ChevronRight } from "lucide-react";

export const useCountdown = (iso) => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  const s = Math.floor(left / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export const EarnUnlimitedBadge = ({ className = "" }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border border-[#d4af37]/60 bg-[#d4af37]/10 px-2.5 py-0.5 text-[9px] font-black tracking-[0.18em] gold-text ${className}`} data-testid="earn-unlimited-badge">
    <Inf size={11} className="text-[#d4af37]" /> EARN UNLIMITED
  </span>
);

const Chip = ({ n, label }) => (
  <div className="flex flex-col items-center">
    <span className="h-8 w-8 rounded-full border border-[#00F58A]/50 bg-[#00F58A]/10 text-[#00F58A] text-xs font-black flex items-center justify-center">{n}</span>
    <span className="mt-1 text-[9px] text-neutral-400 text-center leading-tight">{label}</span>
  </div>
);

export const ChainPromo = () => (
  <Link to="/chain" className="card-glow block relative overflow-hidden rounded-[20px] border-2 border-[#d4af37]/70 bg-[#0d0f0e] p-4 active:scale-[0.99] transition-transform"
    style={{ "--glow": "rgba(212,175,55,0.3)" }} data-testid="home-chain-promo">
    <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(0,245,138,0.16),transparent_70%)]" />
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <EarnUnlimitedBadge />
        <div className="mt-2 text-[19px] font-black leading-tight silver-text">Chain Pool Earnings</div>
        <div className="text-[13px] font-extrabold text-[#00F58A] leading-tight">Earn ₹5,000 – ₹10 Lakh a day*</div>
      </div>
      <span className="shrink-0 h-9 w-9 rounded-full bg-[#d4af37] text-black flex items-center justify-center"><ChevronRight size={18} /></span>
    </div>
    <div className="mt-3 grid grid-cols-4 gap-1.5">
      <Chip n="1" label="Share your link" />
      <Chip n="2" label="Friends invite friends" />
      <Chip n="3" label="Whole chain deposits" />
      <Chip n="4" label="10% paid daily at 12 AM" />
    </div>
    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-neutral-400">
      <Users size={12} className="text-[#d4af37]" />No level limit · No wagering · Withdraw from ₹1,000
    </div>
    <div className="mt-1 text-[8.5px] text-neutral-600">*Earnings depend on your chain's total deposits. Shared equally among members who have deposited.</div>
  </Link>
);
