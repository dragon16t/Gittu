import { NavLink } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { Home, Activity, Triangle, Clock3 } from "lucide-react";

const ITEMS = [["/", "Home", Home, "home"], ["/pulse", "Pulse Arena", Activity, "pulse"], ["/oddy-nacho", "Oddy Nacho", Triangle, "oddy"], ["/history", "History", Clock3, "history"]];

export const BottomNav = () => {
  const t = useT();
  return (
  <nav className="fixed bottom-0 inset-x-0 z-40 mx-auto max-w-[480px] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 bg-gradient-to-t from-[#050606] via-[#050606]/95 to-transparent" data-testid="bottom-nav">
    <div className="grid grid-cols-4 gap-1 rounded-[22px] border border-white/10 bg-[#0b0e0e] p-1.5">
      {ITEMS.map(([to, label, Icon, id]) => (
        <NavLink key={to} to={to} end data-testid={`bottom-nav-${id}`}
          className={({ isActive }) => `flex flex-col items-center justify-center gap-1 h-[58px] rounded-2xl text-[12px] font-semibold transition-colors ${isActive
            ? "text-[#00F58A] bg-[#00F58A]/10 border border-[#00F58A]/40 shadow-[0_0_18px_rgba(0,245,138,0.25)]" : "text-neutral-300 border border-transparent"}`}>
          <Icon size={22} strokeWidth={1.8} fill={id === "oddy" || id === "home" ? "currentColor" : "none"} />
          {t(label)}
        </NavLink>
      ))}
    </div>
  </nav>
);
};
