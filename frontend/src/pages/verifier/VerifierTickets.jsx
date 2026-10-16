import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { Badge, Empty } from "@/components/common";
import { Timeline } from "@/components/Timeline";

function TicketItem({ t, reload }) {
  const [open, setOpen] = useState(t.status === "assigned");
  const [note, setNote] = useState("");
  const [utr, setUtr] = useState("");
  const [ref, setRef] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setNote(""); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const done = ["resolved", "closed"].includes(t.status);
  const x = t.ref;
  const processWithdrawal = () => {
    const fd = new FormData();
    fd.append("reference", ref); fd.append("note", note); fd.append("file", file);
    return api.post(`/verifier/tickets/${t.id}/process-withdrawal`, fd);
  };
  const inp = "h-9 px-3 rounded-lg bg-black border border-white/15 text-sm outline-none";
  return (
    <div className="panel !rounded-2xl p-4" data-testid={`verifier-ticket-${t.number}`}>
      <button className="w-full flex flex-wrap justify-between items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <div>
          <span className="mono font-bold">{t.number}</span> <span className="text-xs text-neutral-400">· {t.kind} · {t.username}</span>
          {x && <div className="text-xs text-neutral-400">{inr(x.amount)} · txn {x.status}{x.utr ? ` · UTR ${x.utr}` : ""}{x.destination?.upi_id ? ` · to ${x.destination.upi_id}` : ""}</div>}
        </div>
        <Badge status={t.status} testid={`verifier-ticket-status-${t.number}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="text-sm text-neutral-300">“{t.message}”</div>
          <Timeline events={t.events} viewer="verifier" />
          {!done && (
            <div className="space-y-2 border-t border-white/10 pt-3">
              {t.kind === "deposit" && x && x.status !== "verified" && (
                <div className="flex flex-wrap gap-2">
                  {!x.utr && <input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} placeholder="UTR from your statement" className={inp} data-testid={`ticket-utr-${t.number}`} />}
                  <button disabled={busy} onClick={() => window.confirm(`Confirm ${inr(x.amount)} was received in your account?`) && run(() => api.post(`/verifier/tickets/${t.id}/approve-deposit`, { note, utr }), "Deposit approved & credited")}
                    className="silver-btn rounded-full px-4 h-9 text-xs font-bold" data-testid={`ticket-approve-deposit-${t.number}`}>Approve deposit</button>
                </div>
              )}
              {t.kind === "withdrawal" && x && !["completed", "rejected"].includes(x.status) && (
                <div className="flex flex-wrap gap-2 items-center">
                  <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transfer reference / UTR" className={inp} data-testid={`ticket-wd-ref-${t.number}`} />
                  <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0])} className="text-xs" data-testid={`ticket-wd-proof-${t.number}`} />
                  <button disabled={busy || !file || ref.length < 6} onClick={() => run(processWithdrawal, "Withdrawal processed, proof uploaded")}
                    className="silver-btn rounded-full px-4 h-9 text-xs font-bold" data-testid={`ticket-process-withdrawal-${t.number}`}>Process & upload proof</button>
                </div>
              )}
              <div className="flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for admin" className={`flex-1 ${inp}`} data-testid={`ticket-note-${t.number}`} />
                <button disabled={!note.trim() || busy} onClick={() => run(() => api.post(`/verifier/tickets/${t.id}/note`, { message: note }), "Note added")}
                  className="ghost-chip rounded-full px-4 h-9 text-xs" data-testid={`ticket-note-send-${t.number}`}>Add note</button>
              </div>
            </div>
          )}
          <div className="text-[11px] text-neutral-500">Raised {dt(t.created_at)}</div>
        </div>
      )}
    </div>
  );
}

export const VerifierTickets = ({ tick }) => {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.get("/verifier/tickets").then(({ data }) => setRows(data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load, tick]);
  const active = (rows || []).filter((t) => ["open", "assigned", "reopened"].includes(t.status)).length;
  return (
    <section className="space-y-3" data-testid="verifier-tickets">
      <h2 className="font-bold text-lg">Support tickets {active > 0 && <span className="ml-2 text-xs bg-white text-black rounded-full px-2 py-0.5">{active} active</span>}</h2>
      {rows === null ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No tickets shared with you</Empty> : rows.map((t) => <TicketItem key={t.id} t={t} reload={load} />)}
    </section>
  );
};
