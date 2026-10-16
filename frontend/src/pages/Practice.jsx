import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, dt } from "@/lib/api";
import { MobileShell, SilverButton, Empty } from "@/components/common";
import { ResultStage, ResultChip } from "@/components/game/GameParts";
import { useRevealAnimation } from "@/components/game/hooks";

export default function Practice() {
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const reveal = useRevealAnimation();
  const load = () => api.get("/practice/history").then(({ data }) => setHistory(data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/practice/generate");
      reveal.run(data.results[9], () => { setCurrent(data); setBusy(false); load(); });
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <MobileShell title="Practice Mode" testid="practice-page">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80 border border-amber-200/20 rounded-full px-3 py-1.5 inline-block mb-5"
        data-testid="practice-disclaimer">
        Free practice · no real money · does not predict live results
      </div>
      <ResultStage label={reveal.label || "?"} final={reveal.final} practice />
      <SilverButton className="mt-5" onClick={generate} disabled={busy} data-testid="generate-ten-results-button">
        {busy ? "GENERATING…" : "GENERATE TEN RESULTS"}
      </SilverButton>
      {current && (
        <div className="panel !rounded-3xl p-5 mt-5 rise" data-testid="practice-current">
          <div className="flex justify-between text-xs text-neutral-500 mb-3">
            <span className="mono" data-testid="practice-preview-id">{current.id}</span><span>PRACTICE RESULTS</span>
          </div>
          <div className="grid grid-cols-5 gap-2 justify-items-center">
            {current.results.map((r, i) => <ResultChip key={i} r={r} size={52} testid={`practice-result-${i}`} />)}
          </div>
        </div>
      )}
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Practice history</h3>
      <div className="space-y-3" data-testid="practice-history">
        {history.length === 0 && <Empty>No practice sequences yet</Empty>}
        {history.map((h) => (
          <div key={h.id} className="panel !rounded-2xl p-4">
            <div className="flex justify-between text-[11px] text-neutral-500 mb-2"><span className="mono">{h.id}</span><span>{dt(h.created_at)}</span></div>
            <div className="text-xs mono text-neutral-300">{h.results.join(" | ")}</div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
