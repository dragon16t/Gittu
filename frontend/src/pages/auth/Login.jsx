import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Zap, ShieldCheck, BarChart3, Phone, Lock, Eye, EyeOff, ChevronRight, Percent, Headset } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useBrand } from "@/lib/brand";

const DICE = "https://static.prod-images.emergentagent.com/jobs/3c713776-5c1e-4a0e-a798-208d8fdeb68f/images/ef2fc125849ec0e73f7eab637b1d458fcce0787f2044f6588daaee9efadaf714.jpeg";
const FEATURES = [[Zap, "Fast", "Rounds"], [ShieldCheck, "Secure", "Payments"], [BarChart3, "Transparent", "Results"]];
const STATS = [[Percent, "1.95x", "Winning Payout"], [ShieldCheck, "100%", "Secure & Safe"], [Headset, "24/7", "Support"]];

const Trio = ({ items, ring }) => (
  <div className="grid grid-cols-3 divide-x divide-white/10">
    {items.map(([Icon, a, b]) => (
      <div key={a} className="flex flex-col items-center text-center px-1">
        <span className={ring ? "h-[clamp(34px,5.2dvh,48px)] w-[clamp(34px,5.2dvh,48px)] rounded-full border border-[#d4af37]/50 bg-black/60 flex items-center justify-center shadow-[0_0_18px_rgba(212,175,55,0.18)]" : ""}>
          <Icon size={ring ? 18 : 17} className={ring ? "text-[#e9c766]" : "text-neutral-200"} strokeWidth={1.7} />
        </span>
        {ring ? <span className="mt-1 text-[clamp(10px,1.45dvh,12px)] leading-tight text-neutral-100">{a}<br />{b}</span>
          : <><b className="mt-0.5 text-[clamp(12px,1.6dvh,14px)] leading-tight text-white">{a}</b><span className="text-[clamp(9px,1.3dvh,11px)] text-neutral-400">{b}</span></>}
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
    <div className="relative h-[100dvh] mx-auto max-w-[480px] px-5 safe-top pb-[max(10px,env(safe-area-inset-bottom))] overflow-hidden flex flex-col justify-between" data-testid="login-page">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full border border-[#d4af37]/10" />
      <div className="pointer-events-none absolute top-40 -left-32 h-80 w-80 rounded-full bg-[#d4af37]/5 blur-3xl" />
      <header className="relative text-center pt-1 rise">
        <h1 className="text-[clamp(30px,5.2dvh,46px)] leading-none font-black tracking-tight silver-text uppercase" data-testid="login-brand">{brand}</h1>
        <div className="mt-1.5 text-[clamp(12px,1.8dvh,15px)] font-bold tracking-[0.18em]"><span className="text-neutral-200">PLAY SIMPLE.</span> <span className="gold-text">WIN BIG.</span></div>
        <p className="mt-0.5 text-[clamp(11px,1.65dvh,14px)] text-neutral-200">Predict <b className="text-white">ODD</b> or <b className="text-white">EVEN</b> and win up to <b className="gold-text">1.95x</b></p>
      </header>
      <img src={DICE} alt="Glowing dice" className="relative -mx-5 w-[calc(100%+40px)] max-w-none h-[clamp(130px,25dvh,300px)] object-cover object-center mix-blend-screen rise -mt-1 -mb-[clamp(10px,2.4dvh,26px)] [mask-image:radial-gradient(ellipse_70%_75%_at_50%_50%,black_55%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_70%_75%_at_50%_50%,black_55%,transparent_100%)]" data-testid="login-dice" />
      <Trio items={FEATURES} ring />
      <form onSubmit={submit} className="relative mt-[clamp(6px,1.4dvh,16px)] rounded-3xl border border-white/12 bg-black/70 backdrop-blur-xl px-4 py-[clamp(10px,1.6dvh,16px)] shadow-2xl" data-testid="login-form">
        <div className="grid grid-cols-2 text-center text-[15px] font-semibold border-b border-white/10">
          <span className="pb-[clamp(6px,1dvh,10px)] text-white border-b-2 border-white" data-testid="login-tab">Login</span>
          <Link to="/register" className="pb-[clamp(6px,1dvh,10px)] text-neutral-500 hover:text-neutral-300 transition-colors" data-testid="signup-link">Sign Up</Link>
        </div>
        <label className="mt-[clamp(8px,1.4dvh,16px)] flex items-center gap-3 h-[clamp(42px,5.8dvh,52px)] rounded-2xl border border-white/12 bg-white/[0.03] px-4 focus-within:border-white/35 transition-colors">
          <Phone size={18} className="text-neutral-400 shrink-0" />
          <input className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-neutral-500" placeholder="Mobile Number or Username" autoComplete="username"
            value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required data-testid="login-username-input" />
        </label>
        <label className="mt-[clamp(6px,1.1dvh,12px)] flex items-center gap-3 h-[clamp(42px,5.8dvh,52px)] rounded-2xl border border-white/12 bg-white/[0.03] px-4 focus-within:border-white/35 transition-colors">
          <Lock size={18} className="text-neutral-400 shrink-0" />
          <input className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-neutral-500" placeholder="Enter Password" type={show ? "text" : "password"} autoComplete="current-password"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required data-testid="login-password-input" />
          <button type="button" onClick={() => setShow(!show)} className="text-neutral-400" aria-label="Show password" data-testid="login-toggle-password">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </label>
        <div className="mt-[clamp(6px,1.1dvh,12px)] flex items-center justify-between text-[13px]">
          <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-white" data-testid="login-remember-checkbox" /> Remember me
          </label>
          <Link to="/forgot" className="text-neutral-200 hover:text-white" data-testid="forgot-password-link">Forgot Password?</Link>
        </div>
        <button type="submit" disabled={busy} className="silver-btn mt-[clamp(8px,1.4dvh,16px)] w-full h-[clamp(44px,6dvh,54px)] rounded-full text-[18px] font-extrabold flex items-center justify-center gap-1.5" data-testid="login-submit-button">
          {busy ? "Signing in…" : <>Login <ChevronRight size={20} /></>}
        </button>
        <div className="mt-[clamp(8px,1.6dvh,20px)]"><Trio items={STATS} /></div>
      </form>
      <footer className="mt-[clamp(4px,1dvh,14px)] text-center text-[11px] text-neutral-400">
        <div className="flex items-center justify-center gap-2"><ShieldCheck size={14} className="text-[#e9c766]" /> Fair Play <span className="text-neutral-600">|</span> Responsible Gaming</div>
        <div className="mt-0.5 text-neutral-500">Play responsibly. 18+ only.</div>
      </footer>
    </div>
  );
}
