import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export const MobileShell = ({ title, children, testid, back = "/" }) => {
  const nav = useNavigate();
  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-screen px-5 pb-16 pt-6" data-testid={testid}>
      <div className="flex items-center gap-3 mb-6 rise">
        <button
          onClick={() => nav(back)}
          className="h-11 w-11 rounded-full ghost-chip flex items-center justify-center"
          data-testid="back-button"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-xl font-bold tracking-tight silver-text">{title}</h1>
      </div>
      {children}
    </div>
  );
};

export const Field = ({ label, prefix, testid, className = "", ...props }) => (
  <label className={`block ${className}`}>
    {label && <span className="block text-sm text-neutral-400 mb-2">{label}</span>}
    <div className="field flex items-center gap-3 px-4 h-14">
      {prefix && <span className="text-neutral-400 text-lg">{prefix}</span>}
      <input data-testid={testid} className="text-base font-medium placeholder:text-neutral-600" {...props} />
    </div>
  </label>
);

export const SilverButton = ({ children, className = "", ...props }) => (
  <button className={`silver-btn rounded-full h-14 w-full font-extrabold tracking-wide text-lg ${className}`} {...props}>
    {children}
  </button>
);

export const GhostButton = ({ children, className = "", ...props }) => (
  <button className={`ghost-chip rounded-full h-11 px-5 font-semibold text-sm ${className}`} {...props}>
    {children}
  </button>
);

export const Stat = ({ label, value, testid, sub }) => (
  <div className="panel !rounded-2xl p-4" data-testid={testid}>
    <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{label}</div>
    <div className="mt-1 text-lg font-bold mono text-neutral-100">{value}</div>
    {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
  </div>
);

const TONES = {
  verified: "text-emerald-400 border-emerald-500/40", completed: "text-emerald-400 border-emerald-500/40",
  won: "text-emerald-400 border-emerald-500/40", claimed: "text-emerald-400 border-emerald-500/40",
  auto_credited: "text-emerald-400 border-emerald-500/40", active: "text-emerald-400 border-emerald-500/40",
  rejected: "text-red-400 border-red-500/40", lost: "text-red-400 border-red-500/40",
  suspended: "text-red-400 border-red-500/40", disabled: "text-red-400 border-red-500/40",
  inactive: "text-red-400 border-red-500/40",
};
export const Badge = ({ status, testid }) => (
  <span
    data-testid={testid}
    className={`inline-block text-[11px] uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${TONES[status] || "text-neutral-300 border-white/20"}`}
  >
    {String(status || "").replace("_", " ")}
  </span>
);

export const Empty = ({ children = "Nothing here yet" }) => (
  <div className="text-center text-neutral-500 text-sm py-10">{children}</div>
);

export const AuthCard = ({ title, subtitle, children, footer, testid }) => (
  <div className="relative z-10 min-h-screen flex items-center justify-center px-5 py-10" data-testid={testid}>
    <div className="w-full max-w-[420px] rise">
      <div className="text-center mb-8">
        <div className="text-[44px] leading-none font-black silver-text tracking-tight">ODD · EVEN</div>
        <div className="mt-3 text-neutral-400 text-sm">{subtitle}</div>
      </div>
      <div className="panel p-6">
        <h2 className="text-lg font-bold mb-5">{title}</h2>
        {children}
      </div>
      {footer && <div className="mt-6 text-center text-sm text-neutral-400">{footer}</div>}
    </div>
  </div>
);

export const TextLink = ({ to, children, testid }) => (
  <Link to={to} data-testid={testid} className="text-neutral-200 underline underline-offset-4 hover:text-white">
    {children}
  </Link>
);
