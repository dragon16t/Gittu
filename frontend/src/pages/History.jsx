import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, dt, inr } from "@/lib/api";
import { MobileShell, Empty } from "@/components/common";
import { ResultChip } from "@/components/game/GameParts";
import { BottomNav } from "@/components/lobby/BottomNav";

const Tab = ({ on, onClick, children, testid }) => (
  <button onClick={onClick} data-testid={testid}
    className={`flex-1 h-10 rounded-full text-sm font-bold transition-colors ${on ? "bg-[#00F58A]/15 text-[#00F58A] border border-[#00F58A]/50" : "text-neutral-400 border border-white/10"}`}>{children}</button>
);

const OddRows = ({ rows }) => (
  <div className="space-y-2" data-testid="round-history">
    {rows.length === 0 && <Empty>No rounds yet</Empty>}
    {rows.map((r) => (
      <div key={r.id} className="panel !rounded-2xl px-4 py-3 flex items-center gap-4">
        <ResultChip r={r.result} size={46} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Round #{r.number} · Dice {r.dice}</div>
          <div className="text-[11px] text-neutral-500">{dt(r.settled_at)}</div>
          {r.salt && <div className="text-[10px] text-neutral-600 mono truncate" title="sha256(round_id:dice:salt)">hash {r.result_hash} · salt {r.salt}</div>}
        </div>
      </div>
    ))}
  </div>
);

const PulseRows = ({ rows, mine }) => (
  <div className="space-y-4" data-testid="pulse-history">
    {mine.length > 0 && (
      <div className="space-y-2" data-testid="pulse-my-bets">
        <div className="text-xs uppercase tracking-widest text-neutral-500">My Pulse bets</div>
        {mine.slice(0, 20).map((b) => (
          <div key={b.id} className="panel !rounded-2xl px-4 py-2.5 flex items-center justify-between text-sm">
            <span>#{b.round_number} · Bet {b.slot} · {inr(b.stake)}</span>
            <span className={b.status === "collected" ? "text-[#00F58A] font-bold" : "text-[#ff6b77]"}>
              {b.status === "collected" ? `+${inr(b.payout)} @ ${b.multiplier.toFixed(2)}x` : b.status === "active" ? "Live" : "Lost"}</span>
          </div>
        ))}
      </div>
    )}
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-neutral-500">All Pulse rounds</div>
      {rows.length === 0 && <Empty>No rounds yet</Empty>}
      {rows.map((r) => (
        <div key={r.number} className="panel !rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Round #{r.number}{r.simulated && <span className="ml-2 text-[10px] text-neutral-500">PRACTICE</span>}</span>
            <span className={`font-extrabold ${r.result >= 100 ? "text-[#ff6b77]" : "text-[#00F58A]"}`}>{r.result.toFixed(2)}x</span>
          </div>
          <div className="text-[11px] text-neutral-500">{dt(r.crashed_at)}</div>
          <div className="text-[10px] text-neutral-600 mono truncate" title="sha256(seed) published before the round">seed {r.seed}</div>
        </div>
      ))}
    </div>
  </div>
);

export default function History() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "pulse" ? "pulse" : "oddy";
  const [odd, setOdd] = useState([]);
  const [pulse, setPulse] = useState([]);
  const [mine, setMine] = useState([]);
  useEffect(() => {
    api.get("/game/history").then(({ data }) => setOdd(data)).catch(() => {});
    api.get("/pulse/history").then(({ data }) => setPulse(data)).catch(() => {});
    api.get("/pulse/my-bets").then(({ data }) => setMine(data)).catch(() => {});
  }, []);
  return (
    <MobileShell title="History" testid="history-page">
      <div className="pb-24 space-y-3">
        <div className="flex gap-2">
          <Tab on={tab === "oddy"} onClick={() => setParams({})} testid="history-tab-oddy">Oddy Nacho</Tab>
          <Tab on={tab === "pulse"} onClick={() => setParams({ tab: "pulse" })} testid="history-tab-pulse">Pulse Arena</Tab>
        </div>
        {tab === "oddy" ? <OddRows rows={odd} /> : <PulseRows rows={pulse} mine={mine} />}
      </div>
      <BottomNav />
    </MobileShell>
  );
}
