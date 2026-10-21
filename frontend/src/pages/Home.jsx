import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Zap, ChevronRight, Users, Gamepad2 } from "lucide-react";
import { api, inr } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ART, avatarFor, ago } from "@/lib/assets";
import { AppHeader } from "@/components/lobby/AppHeader";
import { BottomNav } from "@/components/lobby/BottomNav";

const PlayersPill = ({ n, color, testid }) => (
  <div className="inline-flex items-center gap-2 h-12 pl-3 pr-2 rounded-full border border-white/15 bg-black/60" data-testid={testid}>
    <Users size={22} style={{ color }} fill={color} />
    <div className="leading-tight"><div className="text-[17px] font-bold text-white">{n ?? "—"}</div><div className="text-[10px] text-neutral-300">Playing Now</div></div>
    <ChevronRight size={15} className="text-neutral-400" />
  </div>
);

const GameCard = ({ to, art, accent, glow, players, title, tagline, testid }) => (
  <Link to={to} data-testid={testid} className="relative block rounded-[22px] overflow-hidden border-2 bg-black active:scale-[0.99] transition-transform"
    style={{ borderColor: accent, boxShadow: `0 0 22px ${glow}` }}>
    <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" loading="eager" />
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
    <div className="relative flex flex-col h-[clamp(280px,calc(100dvh-545px),420px)] p-3">
      <PlayersPill n={players} color={accent} testid={`${testid}-players`} />
      <div className="mt-auto text-center">
        {title}
        <div className="mt-2 text-[11px] tracking-[0.35em] font-semibold" style={{ color: accent }}>{tagline}</div>
        <div className="mt-2.5 h-12 rounded-full flex items-center justify-between px-3 text-black font-extrabold text-[clamp(13px,3.8vw,17px)] whitespace-nowrap"
          style={{ background: `linear-gradient(180deg, #fff6, transparent 60%), ${accent}`, boxShadow: `0 0 18px ${glow}` }} data-testid={`${testid}-play`}>
          <Gamepad2 size={20} /> PLAY NOW <ChevronRight size={18} />
        </div>
      </div>
    </div>
  </Link>
);

const LiveWins = ({ wins, nowMs, failed }) => (
  <Link to="/history" className="block rounded-[20px] border border-[#00F58A]/30 bg-[#0b1110] px-3.5 py-2.5 shadow-[0_0_18px_rgba(0,245,138,0.08)]" data-testid="live-wins">
    <div className="flex items-center gap-2 text-[14px] font-bold">
      <Zap size={17} className="text-[#00F58A]" fill="#00F58A" /><span className="h-2 w-2 rounded-full bg-[#00F58A] animate-pulse" /> LIVE WINS
      <ChevronRight size={17} className="ml-auto text-neutral-400" />
    </div>
    <div className="mt-2 flex gap-0 overflow-x-auto no-scrollbar" data-testid="live-wins-list">
      {wins === null && [0, 1, 2].map((i) => <div key={i} className="h-11 w-32 shrink-0 mr-3 rounded-xl bg-white/5 animate-pulse" />)}
      {wins && wins.length === 0 && <div className="text-xs text-neutral-500 py-2">{failed ? "Live wins unavailable — retrying…" : "No wins yet. Be the first!"}</div>}
      {wins && wins.map((w, i) => (
        <div key={`${w.at}-${i}`} className="flex items-center gap-2.5 shrink-0 pr-4 mr-4 border-r border-white/10 last:border-0" data-testid={`live-win-${i}`}>
          <img src={avatarFor(w.name)} alt="" className="h-11 w-11 rounded-full object-cover border border-white/20" />
          <div className="leading-tight">
            <div className="text-[16px] font-bold">{inr(w.amount)}</div>
            <div className="text-[11px] text-neutral-400">{w.name} · {w.game === "PULSE" ? "Pulse" : "Oddy"} · {ago(w.at, nowMs)}</div>
          </div>
        </div>
      ))}
    </div>
  </Link>
);

export default function Home() {
  const { user } = useSession();
  const [lobby, setLobby] = useState(null);
  const [failed, setFailed] = useState(false);
  const [balance, setBalance] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    let off = false;
    const load = () => api.get("/lobby").then(({ data }) => { if (!off) { setLobby(data); setFailed(false); } }).catch(() => !off && setFailed(true));
    load();
    const t = setInterval(() => { load(); setNowMs(Date.now()); }, 5000);
    return () => { off = true; clearInterval(t); };
  }, []);
  useEffect(() => { if (user) api.get("/wallet").then(({ data }) => setBalance(data.balance)).catch(() => {}); }, [user]);
  return (
    <div className="relative z-10 mx-auto max-w-[480px] min-h-[100dvh] bg-[#050606] pb-28" data-testid="home-page">
      <AppHeader balance={balance} />
      <section className="relative h-[clamp(160px,24dvh,250px)] overflow-hidden" data-testid="home-hero">
        <img src={ART.hero} alt="" className="absolute right-[-18%] top-0 h-full w-[100%] object-cover object-right [mask-image:linear-gradient(to_right,transparent,black_35%)]" />
        <div className="relative px-5 pt-3">
          <h1 className="italic font-black leading-[0.95] text-[clamp(34px,10.5vw,54px)] tracking-tight">
            <span className="block silver-text">PLAY.</span><span className="block silver-text">WATCH.</span>
            <span className="block text-[#00F58A] drop-shadow-[0_0_18px_rgba(0,245,138,0.5)]">WIN BIG.</span>
          </h1>
          <p className="mt-2.5 text-[11px] tracking-[0.3em] text-neutral-400 max-w-[260px]">REAL GAMES. REAL PLAYERS. REAL WINS.</p>
        </div>
      </section>
      <div className="px-4 space-y-3">
        <LiveWins wins={lobby ? lobby.wins : failed ? [] : null} nowMs={nowMs} failed={failed} />
        <div className="grid grid-cols-2 gap-3">
          <GameCard to="/pulse" art={ART.pulseCard} accent="#00F58A" glow="rgba(0,245,138,0.35)" players={lobby?.pulse.players} testid="pulse-card" tagline="FEEL THE PULSE"
            title={<div><div className="italic font-black text-[clamp(34px,10vw,46px)] leading-none silver-text">PULSE</div><div className="text-[#00F58A] font-black tracking-[0.4em] text-[clamp(14px,4vw,18px)]">ARENA</div></div>} />
          <GameCard to="/oddy-nacho" art={ART.oddyCard} accent="#FFC52E" glow="rgba(255,197,46,0.35)" players={lobby?.oddeven.players} testid="oddy-card" tagline="PREDICT. WIN. REPEAT."
            title={<div className="italic font-black text-[clamp(30px,9vw,42px)] leading-[0.95]"><div className="text-[#FFC52E]">ODDY</div><div className="silver-text">NACHO</div></div>} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
