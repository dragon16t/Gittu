import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Users, Gamepad2 } from "lucide-react";
import { api, inr } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ART, avatarFor } from "@/lib/assets";
import { AppHeader } from "@/components/lobby/AppHeader";
import { BottomNav } from "@/components/lobby/BottomNav";

const PlayersPill = ({ n, color, testid }) => (
  <div className="inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-full border border-white/15 bg-black/70" data-testid={testid}>
    <Users size={15} style={{ color }} fill={color} />
    <span className="text-[13px] font-bold text-white">{n ?? "—"}</span><span className="text-[10px] text-neutral-300">playing</span>
  </div>
);

const CardTicker = ({ wins, accent, testid }) => {
  if (!wins) return <div className="h-7 mx-2 rounded-full bg-white/5 animate-pulse" />;
  if (!wins.length) return <div className="h-7 mx-2 rounded-full border border-white/10 bg-black/70 text-[10px] text-neutral-400 flex items-center justify-center" data-testid={testid}>No wins yet — be the first</div>;
  const items = [...wins, ...wins];
  return (
    <div className="ticker h-7 mx-2 rounded-full border bg-black/75 overflow-hidden flex items-center" style={{ borderColor: `${accent}55` }} data-testid={testid}>
      <div className="ticker-track px-2 text-[10.5px] whitespace-nowrap">
        {items.map((w, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-neutral-200">
            <img src={avatarFor(w.name)} alt="" className="h-4 w-4 rounded-full object-cover" />
            {w.name} <b style={{ color: accent }}>{inr(w.amount)}</b>
          </span>
        ))}
      </div>
    </div>
  );
};

const GameCard = ({ to, art, accent, glow, players, title, tagline, wins, testid }) => (
  <Link to={to} data-testid={testid} className="relative flex flex-col rounded-[20px] overflow-hidden border bg-[#101313] active:scale-[0.99] transition-transform"
    style={{ borderColor: `${accent}aa`, boxShadow: `0 0 16px ${glow}` }}>
    <div className="relative h-[clamp(150px,calc(100dvh-515px),320px)] overflow-hidden">
      <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover object-top" loading="eager" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[#101313]" />
      <div className="absolute top-2 left-2"><PlayersPill n={players} color={accent} testid={`${testid}-players`} /></div>
    </div>
    <div className="relative -mt-1 pb-2.5 flex flex-col flex-1 gap-2 text-center">
      <CardTicker wins={wins} accent={accent} testid={`${testid}-wins`} />
      {title}
      <div className="text-[9px] tracking-[0.18em] font-semibold whitespace-nowrap" style={{ color: accent }}>{tagline}</div>
      <div className="mt-auto mx-2 h-10 rounded-full flex items-center justify-center gap-1.5 text-black font-extrabold text-[13.5px] whitespace-nowrap"
        style={{ background: `linear-gradient(180deg, #fff6, transparent 60%), ${accent}`, boxShadow: `0 0 12px ${glow}` }} data-testid={`${testid}-play`}>
        <Gamepad2 size={17} /> PLAY NOW <ChevronRight size={15} />
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
      <section className="relative h-[clamp(130px,19dvh,220px)] overflow-hidden" data-testid="home-hero">
        <img src={ART.hero} alt="" className="absolute right-[-18%] top-0 h-full w-[100%] object-cover object-right [mask-image:linear-gradient(to_right,transparent,black_35%)]" />
        <div className="relative px-5 pt-3">
          <h1 className="italic font-black leading-[0.95] text-[clamp(26px,8vw,44px)] tracking-tight">
            <span className="block silver-text">PLAY.</span><span className="block silver-text">WATCH.</span>
            <span className="block text-[#00F58A] drop-shadow-[0_0_18px_rgba(0,245,138,0.5)]">WIN BIG.</span>
          </h1>
          <p className="mt-2 text-[9.5px] tracking-[0.3em] text-neutral-400 max-w-[220px]">REAL GAMES. REAL PLAYERS. REAL WINS.</p>
        </div>
      </section>
      <div className="px-4 space-y-3">
        {failed && <div className="text-center text-[11px] text-neutral-500" data-testid="lobby-offline">Connection issue — retrying…</div>}
        <div className="grid grid-cols-2 gap-3">
          <GameCard to="/pulse" art={ART.pulseCard} accent="#00F58A" glow="rgba(0,245,138,0.35)" players={lobby?.pulse.players} testid="pulse-card" tagline="FEEL THE PULSE" wins={lobby && lobby.wins.filter((w) => w.game === "PULSE")}
            title={<div><div className="italic font-black text-[clamp(24px,7vw,34px)] leading-none silver-text">PULSE</div><div className="text-[#00F58A] font-black tracking-[0.4em] text-[clamp(11px,3vw,14px)]">ARENA</div></div>} />
          <GameCard to="/oddy-nacho" art={ART.oddyCard} accent="#FFC52E" glow="rgba(255,197,46,0.35)" players={lobby?.oddeven.players} testid="oddy-card" tagline="PREDICT. WIN. REPEAT." wins={lobby && lobby.wins.filter((w) => w.game !== "PULSE")}
            title={<div className="italic font-black text-[clamp(20px,5.8vw,28px)] leading-[0.95]"><div className="text-[#FFC52E]">ODDY</div><div className="silver-text">NACHO</div></div>} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
