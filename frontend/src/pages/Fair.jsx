import { useEffect, useState } from "react";
import { ShieldCheck, Check, X, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { MobileShell, Empty } from "@/components/common";
import { ResultChip } from "@/components/game/GameParts";

const sha256 = async (s) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const Revealed = ({ s }) => {
  const [ok, setOk] = useState(null);
  useEffect(() => { sha256(`${s.number}:${s.dice}:${s.salt}`).then((h) => setOk(h === s.hash)); }, [s]);
  return (
    <div className="panel !rounded-2xl px-3 py-2.5 flex items-center gap-3" data-testid={`fair-revealed-${s.number}`}>
      <ResultChip r={s.result} size={40} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">Round #{s.number} · Dice {s.dice}{s.status === "void" && <span className="ml-2 text-[10px] text-neutral-500">(unused)</span>}</div>
        <div className="text-[10px] text-neutral-500 mono truncate">hash {s.hash}</div>
        <div className="text-[10px] text-neutral-600 mono truncate">salt {s.salt}</div>
      </div>
      <span className={`text-[10px] font-bold flex items-center gap-1 ${ok ? "text-emerald-400" : ok === false ? "text-red-400" : "text-neutral-500"}`} data-testid={`fair-verify-${s.number}`}>
        {ok ? <Check size={12} /> : ok === false ? <X size={12} /> : null}{ok ? "VERIFIED" : ok === false ? "MISMATCH" : "…"}
      </span>
    </div>
  );
};

export default function Fair() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api.get("/game/fair").then(({ data }) => setD(data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <MobileShell title="Fair Proof" testid="fair-page">
      <div className="panel !rounded-2xl p-4 text-xs text-neutral-300 space-y-1.5" data-testid="fair-explainer">
        <div className="flex items-center gap-2 font-semibold text-sm text-white"><ShieldCheck size={15} className="text-emerald-400" />Provably fair results</div>
        <p>The results for the next 10 rounds are fixed in advance. We publish only their hashes, so the result cannot be changed after you bet.</p>
        <p>After each round, the dice and salt are revealed. Your browser checks <span className="mono text-white">{d?.formula || "SHA256(round_number:dice:salt)"}</span> against the published hash.</p>
      </div>
      <h3 className="mt-5 mb-2 text-xs uppercase tracking-widest text-neutral-500">Next 10 committed rounds</h3>
      <div className="space-y-1.5" data-testid="fair-upcoming">
        {d && !d.active && <Empty>Fair Proof mode is not active right now</Empty>}
        {d?.upcoming.map((u) => (
          <div key={u.number} className="panel !rounded-xl px-3 py-2 flex items-center gap-3" data-testid={`fair-upcoming-${u.number}`}>
            <Lock size={13} className="text-neutral-500 shrink-0" />
            <span className="text-xs font-semibold w-16 shrink-0">#{u.number}</span>
            <span className="text-[10px] mono text-neutral-400 truncate">{u.hash}</span>
          </div>
        ))}
      </div>
      <h3 className="mt-5 mb-2 text-xs uppercase tracking-widest text-neutral-500">Revealed &amp; verified</h3>
      <div className="space-y-2" data-testid="fair-revealed">
        {d && d.revealed.length === 0 && <Empty>No revealed rounds yet</Empty>}
        {d?.revealed.map((s) => <Revealed key={s.number} s={s} />)}
      </div>
    </MobileShell>
  );
}
