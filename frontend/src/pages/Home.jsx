import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Gamepad2 } from "lucide-react";
import { api, inr } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ART, avatarFor } from "@/lib/assets";
import { AppHeader } from "@/components/lobby/AppHeader";
import { BottomNav } from "@/components/lobby/BottomNav";

const LiveWins = ({ wins }) => {
  if (!wins) return <div className="h-12 rounded-2xl bg-white/5 animate-pulse" data-testid="live-wins" />;
  const items = wins.length ? [...wins, ...wins] : [];
  return (
    <div className="flex items-center gap-2.5 h-12 rounded-2xl border border-[#00F58A]/30 bg-[#0b1110] pl-3 pr-1 overflow-hidden" data-testid="live-wins">
      <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-extrabold tracking-wider"><span className="h-2 w-2 rounded-full bg-[#00F58A] animate-pulse" />LIVE WINS</div>
      <div className="h-6 w-px bg-white/10 shrink-0" />
      {items.length === 0 ? <div className="text-[11px] text-neutral-500">No wins yet — be the first</div> : (
        <div className="ticker flex-1 overflow-hidden"><div className="ticker-track text-[11.5px] whitespace-nowrap" data-testid="live-wins-list">
          {items.map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-neutral-200">
              <img src={avatarFor(w.name)} alt="" className="h-6 w-6 rounded-full object-cover border border-white/15" />
              {w.name} <b className={w.game === "PULSE" ? "text-[#00F58A]" : "text-[#FFC52E]"}>{inr(w.amount)}</b>
              <span className="text-neutral-500 text-[10px]">{w.game === "PULSE" ? "Pulse" : "Oddy"}</span>
            </span>
          ))}
        </div></div>
      )}
    </div>
  );
};

const GameCard = ({ to, art, accent, glow, title, tagline, testid }) => (
  <Link to={to} data-testid={testid} className="relative flex flex-col rounded-[20px] overflow-hidden border bg-[#101313] active:scale-[0.99] transition-transform"
    style={{ borderColor: `${accent}aa`, boxShadow: `0 0 16px ${glow}` }}>
    <div className="relative h-[clamp(150px,calc(100dvh-555px),320px)] overflow-hidden">
      <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover object-top" loading="eager" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[#101313]" />
    </div>
    <div className="relative -mt-1 pb-2.5 flex flex-col flex-1 gap-2 text-center">
      {title}
      <div className="text-[9px] tracking-[0.18em] font-semibold whitespace-nowrap" style={{ color: accent }}>{tagline}</div>
      <div className="mt-auto mx-3 h-9 rounded-full flex items-center justify-center gap-1.5 text-black font-extrabold text-[12.5px] tracking-wide whitespace-nowrap"
        style={{ background: `linear-gradient(180deg, #fff6, transparent 60%), ${accent}`, boxShadow: `0 0 12px ${glow}` }} data-testid={`${testid}-play`}>
        <Gamepad2 size={15} /> PLAY NOW <ChevronRight size={14} />
      </div>
    </div>
  </Link>
);

export default function Home() {
  const { user } = useSession();
  const [lobby, setLobby] = useState(null);
  const [failed, setFailed] = useState(false);
  const [balance, setBalance] = useState(null);
    useEffect(() => {
    let off = false;
    const load = () => api.get("/lobby").then(({ data }) => { if (!off) { setLobby(data); setFailed(false); } }).catch(() => !off && setFailed(true));
    load();
    const t = setInterval(() => { load(); }, 5000);
    return () => { off = true; clearInterval(t); };
  }, []);
  useEffect(() => { if (user) api.get("/wallet").then(({ data }) => setBalance(data.balance)).catch(() => {}); }, [user]);
  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-[100dvh] bg-[#050606] pb-28" data-testid="home-page">
      <AppHeader balance={balance} />
      <div className="px-4 pb-1"><LiveWins wins={lobby ? lobby.wins : failed ? [] : null} /></div>
      <section className="relative h-[clamp(130px,19dvh,220px)] overflow-hidden" data-testid="home-hero">
        <img src={ART.hero} alt="" className="absolute right-[-18%] top-0 h-full w-[100%] object-cover object-right [mask-image:linear-gradient(to_right,transparent,black_35%)]" />
        <div className="relative px-5 pt-3">
          <h1 className="italic font-black leading-[0.95] text-[clamp(24px,7vw,38px)] tracking-tight">
            <span className="block silver-text">PLAY</span><span className="block silver-text">WATCH</span>
            <span className="block text-[#00F58A] drop-shadow-[0_0_18px_rgba(0,245,138,0.5)]">WIN BIG</span>
          </h1>
          <p className="mt-2 text-[9.5px] font-semibold tracking-[0.14em] text-neutral-300 whitespace-nowrap">REAL GAMES. REAL PLAYERS. REAL WINS.</p>
        </div>
      </section>
      <div className="px-4 space-y-3">
        {failed && <div className="text-center text-[11px] text-neutral-500" data-testid="lobby-offline">Connection issue — retrying…</div>}
        <div className="grid grid-cols-2 gap-3">
          <GameCard to="/pulse" art={ART.pulseCard} accent="#00F58A" glow="rgba(0,245,138,0.35)" testid="pulse-card" tagline="FEEL THE PULSE"
            title={<div><div className="italic font-black text-[clamp(24px,7vw,34px)] leading-none silver-text">PULSE</div><div className="text-[#00F58A] font-black tracking-[0.4em] text-[clamp(11px,3vw,14px)]">ARENA</div></div>} />
          <GameCard to="/oddy-nacho" art={ART.oddyCard} accent="#FFC52E" glow="rgba(255,197,46,0.35)" testid="oddy-card" tagline="PREDICT. WIN. REPEAT."
            title={<div className="italic font-black text-[clamp(20px,5.8vw,28px)] leading-[0.95]"><div className="text-[#FFC52E]">ODDY</div><div className="silver-text">NACHO</div></div>} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
