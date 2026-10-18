import { useEffect, useState } from "react";
import { api, dt } from "@/lib/api";
import { MobileShell, Empty } from "@/components/common";
import { ResultChip } from "@/components/game/GameParts";

export default function History() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get("/game/history").then(({ data }) => setRows(data)); }, []);
  return (
    <MobileShell title="All Results" testid="history-page">
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
    </MobileShell>
  );
}
