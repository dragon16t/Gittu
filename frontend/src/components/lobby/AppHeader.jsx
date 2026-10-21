import { memo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Plus, Settings, Gift, Mail, Headset, Wallet, ChevronRight, Volume2, VolumeX, WalletCards } from "lucide-react";
import { api, inr, inr0 } from "@/lib/api";
import { useSession } from "@/lib/session";

const Round = ({ to, icon: Icon, label, testid, dot }) => (
  <Link to={to} data-testid={testid} aria-label={label} title={label}
    className="relative h-9 w-9 rounded-full border border-white/15 bg-[#0d1010] flex items-center justify-center text-neutral-200 hover:border-white/35 transition-colors">
    <Icon size={18} strokeWidth={1.7} />
    {dot && <span className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-red-500" data-testid={`${testid}-dot`} />}
  </Link>
);

export const AppHeader = memo(function AppHeader({ balance, music, onToggleMusic }) {
  const { user } = useSession();
  const [refer, setRefer] = useState(30000);
  const [coupons, setCoupons] = useState(0);
  useEffect(() => {
    api.get("/promo/rules").then(({ data }) => setRefer(data.bonus)).catch(() => {});
    if (user) api.get("/coupons").then(({ data }) => setCoupons(data.filter((c) => c.status === "available").length)).catch(() => {});
  }, [user]);
  return (
    <header className="shrink-0 px-4 safe-top pb-2 space-y-2" data-testid="app-header">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={user ? "/settings" : "/login"} className="h-11 w-11 shrink-0 rounded-full border border-white/15 bg-[#0d1010] flex items-center justify-center" data-testid="profile-button">
            <User size={22} strokeWidth={1.5} />
          </Link>
          <div className="min-w-0">
            <div className="text-neutral-300 text-[13px] leading-none">Balance</div>
            <div className="mt-1 text-[clamp(16px,5vw,21px)] font-extrabold leading-none tracking-tight truncate" data-testid="header-balance">{user ? inr(balance) : "—"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onToggleMusic && (
            <button onClick={onToggleMusic} className="h-8 w-7 flex items-center justify-center text-neutral-300" data-testid="music-toggle-button" aria-label="Toggle sound">
              {music ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          )}
          <Link to={user ? "/deposit" : "/login"} className="silver-btn rounded-full h-10 pl-2.5 pr-1 flex items-center gap-1.5 font-bold text-[14px] shadow-[0_0_18px_rgba(0,245,138,0.25)]" data-testid="header-deposit-button">
            <WalletCards size={17} /> Deposit
            <span className="h-8 w-8 rounded-full bg-black text-white flex items-center justify-center"><Plus size={17} /></span>
          </Link>
          <Link to={user ? "/settings" : "/login"} className="h-10 w-10 rounded-full border border-white/15 bg-[#0d1010] flex items-center justify-center" data-testid="settings-button"><Settings size={20} /></Link>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Link to="/refer" data-testid="refer-earn-badge"
          className="inline-flex items-center gap-2 h-9 pl-0.5 pr-2.5 rounded-full border border-[#FFC52E]/60 bg-gradient-to-r from-[#FFC52E]/15 to-transparent text-[13px] font-bold whitespace-nowrap">
          <span className="h-8 w-8 rounded-full silver-btn flex items-center justify-center"><Gift size={15} /></span>
          <span className="text-[#FFC52E]">Refer & Earn {inr0(refer)}</span>
          <ChevronRight size={16} className="text-[#FFC52E]" />
        </Link>
        <div className="flex items-center gap-2">
          <Round to={user ? "/messages" : "/login"} icon={Mail} label="Messages" testid="nav-messages" dot={coupons > 0} />
          <Round to={user ? "/support" : "/login"} icon={Headset} label="Support" testid="nav-support" />
          <Round to={user ? "/wallet" : "/login"} icon={Wallet} label="Wallet" testid="nav-wallet" />
        </div>
      </div>
    </header>
  );
});
