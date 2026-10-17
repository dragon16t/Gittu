import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Zap, ShieldCheck, BarChart3, Phone, Lock, Eye, EyeOff, ChevronRight, Percent, Headset } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useBrand } from "@/lib/brand";

const DICE = "https://static.prod-images.emergentagent.com/jobs/3c713776-5c1e-4a0e-a798-208d8fdeb68f/images/3b3645e573104c1ec9f3073669efca6f43b5c7539cce7e3fdfcb7f9d5ea34eae.jpeg";
const FEATURES = [[Zap, "Fast", "Rounds"], [ShieldCheck, "Secure", "Payments"], [BarChart3, "Transparent", "Results"]];
const STATS = [[Percent, "1.95x", "Winning Payout"], [ShieldCheck, "100%", "Secure & Safe"], [Headset, "24/7", "Support"]];

const Trio = ({ items, ring }) => (
  <div className="grid grid-cols-3 divide-x divide-white/10">
    {items.map(([Icon, a, b]) => (
      <div key={a} className="flex flex-col items-center text-center px-1">
        <span className={ring ? "h-12 w-12 rounded-full border border-[#d4af37]/50 bg-black/60 flex items-center justify-center shadow-[0_0_18px_rgba(212,175,55,0.18)]" : ""}>
          <Icon size={ring ? 20 : 20} className={ring ? "text-[#e9c766]" : "text-neutral-200"} strokeWidth={1.7} />
        </span>
        {ring ? <span className="mt-1.5 text-[12px] leading-tight text-neutral-100">{a}<br />{b}</span>
          : <><b className="mt-1 text-[14px] text-white">{a}</b><span className="text-[11px] text-neutral-400">{b}</span></>}
      </div>
    ))}
  </div>
);

export default function Login() {
  const [f, setF] = useState({ username: localStorage.getItem("oe_last_user") || "", password: "" });
  const [remember, setRemember] = useState(!!localStorage.getItem("oe_last_user"));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const { setUser } = useSession();
  const brand = useBrand();
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", f);
      remember ? localStorage.setItem("oe_last_user", f.username) : localStorage.removeItem("oe_last_user");
      setUser(data.user);
      nav("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative min-h-[100dvh] mx-auto max-w-[480px] px-5 safe-top pb-6 overflow-hidden" data-testid="login-page">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full border border-[#d4af37]/10" />
      <div className="pointer-events-none absolute top-40 -left-32 h-80 w-80 rounded-full bg-[#d4af37]/5 blur-3xl" />
      <header className="relative text-center pt-4 rise">
        <h1 className="text-5xl font-black tracking-tight silver-text uppercase" data-testid="login-brand">{brand}</h1>
        <div className="mt-2 text-[15px] font-bold tracking-[0.18em]"><span className="text-neutral-200">PLAY SIMPLE.</span> <span className="gold-text">WIN BIG.</span></div>
        <p className="mt-1 text-[14px] text-neutral-200">Predict <b className="text-white">ODD</b> or <b className="text-white">EVEN</b> and win up to <b className="gold-text">1.95x</b></p>
      </header>
      <img src={DICE} alt="Glowing dice" className="relative mx-auto -my-2 w-[min(78vw,330px)] aspect-square object-cover mix-blend-screen rise" data-testid="login-dice" />
      <Trio items={FEATURES} ring />
      <form onSubmit={submit} className="relative mt-5 rounded-3xl border border-white/12 bg-black/70 backdrop-blur-xl p-4 shadow-2xl" data-testid="login-form">
        <div className="grid grid-cols-2 text-center text-[15px] font-semibold border-b border-white/10">
          <span className="pb-2.5 text-white border-b-2 border-white" data-testid="login-tab">Login</span>
          <Link to="/register" className="pb-2.5 text-neutral-500 hover:text-neutral-300 transition-colors" data-testid="signup-link">Sign Up</Link>
        </div>
        <label className="mt-4 flex items-center gap-3 h-[52px] rounded-2xl border border-white/12 bg-white/[0.03] px-4 focus-within:border-white/35 transition-colors">
          <Phone size={18} className="text-neutral-400 shrink-0" />
          <input className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-neutral-500" placeholder="Mobile Number or Username" autoComplete="username"
            value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required data-testid="login-username-input" />
        </label>
        <label className="mt-3 flex items-center gap-3 h-[52px] rounded-2xl border border-white/12 bg-white/[0.03] px-4 focus-within:border-white/35 transition-colors">
          <Lock size={18} className="text-neutral-400 shrink-0" />
          <input className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-neutral-500" placeholder="Enter Password" type={show ? "text" : "password"} autoComplete="current-password"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required data-testid="login-password-input" />
          <button type="button" onClick={() => setShow(!show)} className="text-neutral-400" aria-label="Show password" data-testid="login-toggle-password">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </label>
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-white" data-testid="login-remember-checkbox" /> Remember me
          </label>
          <Link to="/forgot" className="text-neutral-200 hover:text-white" data-testid="forgot-password-link">Forgot Password?</Link>
        </div>
        <button type="submit" disabled={busy} className="silver-btn mt-4 w-full h-[54px] rounded-full text-[18px] font-extrabold flex items-center justify-center gap-1.5" data-testid="login-submit-button">
          {busy ? "Signing in…" : <>Login <ChevronRight size={20} /></>}
        </button>
        <div className="mt-5"><Trio items={STATS} /></div>
      </form>
      <footer className="mt-4 text-center text-[12px] text-neutral-400">
        <div className="flex items-center justify-center gap-2"><ShieldCheck size={14} className="text-[#e9c766]" /> Fair Play <span className="text-neutral-600">|</span> Responsible Gaming</div>
        <div className="mt-1 text-neutral-500">Play responsibly. 18+ only.</div>
      </footer>
    </div>
  );
}
