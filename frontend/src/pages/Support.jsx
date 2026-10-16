import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { MobileShell, SilverButton, Badge, Empty } from "@/components/common";
import { Timeline, STATUS_TEXT } from "@/components/Timeline";

function NewTicket({ onCreated }) {
  const [params] = useSearchParams();
  const [kind, setKind] = useState(params.get("kind") || "deposit");
  const [ref, setRef] = useState(params.get("ref") || "");
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState({ deposit: [], withdrawal: [] });
  useEffect(() => {
    api.get("/deposits").then(({ data }) => setItems((x) => ({ ...x, deposit: data.filter((d) => d.status !== "cancelled") })));
    api.get("/withdrawals").then(({ data }) => setItems((x) => ({ ...x, withdrawal: data })));
  }, []);
  const submit = async () => {
    try {
      await api.post("/tickets", { kind, ref_id: kind === "other" ? "" : ref, message: msg });
      toast.success("Ticket raised. Our team will update you here.");
      setMsg("");
      onCreated();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const sel = "w-full h-12 px-3 rounded-2xl bg-black border border-white/15 text-sm outline-none";
  return (
    <div className="panel p-5 space-y-3 rise" data-testid="new-ticket-form">
      <div className="grid grid-cols-3 gap-2">
        {["deposit", "withdrawal", "other"].map((k) => (
          <button key={k} onClick={() => { setKind(k); setRef(""); }} data-testid={`ticket-kind-${k}`}
            className={`h-10 rounded-full text-sm font-semibold capitalize ${kind === k ? "silver-btn" : "ghost-chip"}`}>{k}</button>
        ))}
      </div>
      {kind !== "other" && (
        <select value={ref} onChange={(e) => setRef(e.target.value)} className={sel} data-testid="ticket-ref-select">
          <option value="">Select the {kind}</option>
          {items[kind].map((x) => <option key={x.id} value={x.id}>{inr(x.amount)} · {x.status} · {dt(x.created_at)}{x.utr ? ` · UTR ${x.utr}` : ""}</option>)}
        </select>
      )}
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder="Describe the issue, e.g. paid via UPI but not credited"
        className="w-full p-3 rounded-2xl bg-black border border-white/15 text-sm outline-none" data-testid="ticket-message-input" />
      <SilverButton onClick={submit} disabled={msg.trim().length < 5 || (kind !== "other" && !ref)} data-testid="submit-ticket-button">RAISE TICKET</SilverButton>
    </div>
  );
}

function TicketCard({ t, reload }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const send = async () => {
    try { await api.post(`/tickets/${t.id}/reply`, { message: reply }); setReply(""); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="panel !rounded-2xl p-4" data-testid={`ticket-${t.number}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left">
        <div>
          <div className="font-bold mono text-sm">{t.number}</div>
          <div className="text-xs text-neutral-400 capitalize">{t.kind}{t.ref_amount ? ` · ${inr(t.ref_amount)}` : ""} · {dt(t.created_at)}</div>
        </div>
        <Badge status={["resolved", "closed"].includes(t.status) ? "completed" : t.status} testid={`ticket-status-${t.number}`} />
      </button>
      <div className="text-[11px] text-neutral-500 mt-1">{STATUS_TEXT[t.status]}</div>
      {open && (
        <div className="mt-4 space-y-4">
          <Timeline events={t.events} viewer="user" />
          {t.status !== "closed" && (
            <div className="flex gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a reply" data-testid={`ticket-reply-input-${t.number}`}
                className="flex-1 h-10 px-3 rounded-full bg-black border border-white/15 text-sm outline-none" />
              <button onClick={send} disabled={!reply.trim()} className="silver-btn rounded-full px-4 text-sm font-bold" data-testid={`ticket-reply-send-${t.number}`}>Send</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Support() {
  const [rows, setRows] = useState(null);
  const load = () => api.get("/tickets").then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []);
  return (
    <MobileShell title="Customer Support" testid="support-page">
      <NewTicket onCreated={load} />
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">My tickets</h3>
      <div className="space-y-3" data-testid="ticket-list">
        {rows === null ? <Empty>Loading…</Empty> : rows.length === 0 && <Empty>No tickets yet</Empty>}
        {(rows || []).map((t) => <TicketCard key={t.id} t={t} reload={load} />)}
      </div>
    </MobileShell>
  );
}
