import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, blobUrl } from "@/lib/api";
import { Badge } from "@/components/common";
import { Timeline, STATUS_TEXT } from "@/components/Timeline";
import { DataTable, Section, Modal, Btn } from "./ui";

function Proofs({ t }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    Promise.all(Array.from({ length: t.proof_count }, (_, i) => blobUrl(`/admin/tickets/${t.id}/proof/${i}`).catch(() => null))).then(setUrls);
  }, [t.id, t.proof_count]);
  if (!t.proof_count) return null;
  return (
    <div data-testid="ticket-proofs">
      <div className="text-xs text-neutral-400 mb-2">Payment proof uploaded by agent</div>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => u && <a key={i} href={u} target="_blank" rel="noreferrer" data-testid={`ticket-proof-${i}`}>
          <img src={u} alt="proof" className="w-40 h-40 object-contain bg-white rounded-lg" onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement("span"), { textContent: "Open PDF proof", className: "underline text-sm" })); }} />
        </a>)}
      </div>
    </div>
  );
}

function TicketModal({ t, verifiers, onClose, reload }) {
  const [vid, setVid] = useState(t.verifier_id || t.ref_verifier_id || "");
  const [note, setNote] = useState("");
  const run = async (fn, ok) => { try { await fn(); toast.success(ok); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const ref = t.ref;
  return (
    <Modal open onClose={onClose} title={`${t.number} · ${t.kind} ticket`} testid="admin-ticket-modal">
      <div className="text-sm space-y-1">
        <div>User <b>{t.username}</b> · status <Badge status={t.status} testid="admin-ticket-status" /></div>
        {ref && <div className="text-xs text-neutral-400">{t.kind}: {inr(ref.amount)} · current status <b>{ref.status}</b>{ref.utr ? ` · UTR ${ref.utr}` : ""}{ref.reference ? ` · Ref ${ref.reference}` : ""}</div>}
        <div className="text-xs text-neutral-400">Routed agent: {t.ref_verifier_name || "—"} · Shared with: {t.verifier_name || "not yet"}</div>
      </div>
      <Timeline events={t.events} viewer="admin" />
      <Proofs t={t} />
      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex gap-2">
          <select value={vid} onChange={(e) => setVid(e.target.value)} className="flex-1 h-9 px-3 rounded-lg bg-black border border-white/15 text-sm" data-testid="ticket-agent-select">
            <option value="">Select agent</option>
            {verifiers.filter((v) => v.status === "active").map((v) => <option key={v.id} value={v.id}>{v.display_name} {v.online ? "(online)" : "(offline)"}{v.id === t.ref_verifier_id ? " · routed agent" : ""}</option>)}
          </select>
          <Btn primary onClick={() => run(() => api.post(`/admin/tickets/${t.id}/assign`, { verifier_id: vid }), "Ticket shared with agent")} data-testid="ticket-share-button">Share with agent</Btn>
        </div>
        <div className="flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reply to user" className="flex-1 h-9 px-3 rounded-lg bg-black border border-white/15 text-sm outline-none" data-testid="ticket-admin-note" />
          <Btn onClick={() => run(async () => { await api.post(`/admin/tickets/${t.id}/note`, { message: note }); setNote(""); }, "Reply sent")} disabled={!note.trim()} data-testid="ticket-admin-note-send">Reply</Btn>
        </div>
        <div className="flex flex-wrap gap-2">
          {!["resolved", "closed"].includes(t.status) && <Btn primary onClick={() => run(() => api.post(`/admin/tickets/${t.id}/status`, { message: "resolved" }), "Marked resolved")} data-testid="ticket-resolve-button">Mark resolved</Btn>}
          {["resolved", "closed"].includes(t.status) && <Btn onClick={() => run(() => api.post(`/admin/tickets/${t.id}/status`, { message: "reopened" }), "Reopened")} data-testid="ticket-reopen-button">Reopen</Btn>}
          {t.status !== "closed" && <Btn onClick={() => run(() => api.post(`/admin/tickets/${t.id}/status`, { message: "closed" }), "Closed")} data-testid="ticket-close-button">Close</Btn>}
        </div>
      </div>
    </Modal>
  );
}

export default function TicketsTab() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("active");
  const [sel, setSel] = useState(null);
  const [verifiers, setVerifiers] = useState([]);
  const load = () => Promise.all([api.get("/admin/tickets", { params: { status } }), sel ? api.get("/admin/tickets") : null]).then(([r, all]) => {
    setRows(r.data);
    if (all) setSel((s) => s && all.data.find((x) => x.id === s.id));
  });
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get("/admin/verifiers").then(({ data }) => setVerifiers(data)); }, []);
  return (
    <Section title="Support tickets" testid="admin-tickets"
      actions={<select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 px-3 rounded-full bg-black border border-white/15 text-xs" data-testid="ticket-status-filter">
        {[["active", "Active"], ["", "All"], ["open", "Open"], ["assigned", "With agent"], ["agent_actioned", "Action taken"], ["resolved", "Resolved"], ["closed", "Closed"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>}>
      <DataTable rows={rows} minW={1000} empty="No tickets" cols={[
        { label: "Ticket", render: (r) => <button className="underline mono" onClick={() => setSel(r)} data-testid={`open-ticket-${r.number}`}>{r.number}</button> },
        { label: "User", key: "username" }, { label: "Type", key: "kind" },
        { label: "Amount", render: (r) => (r.ref ? inr(r.ref.amount) : "—") },
        { label: "Txn status", render: (r) => r.ref?.status || "—" },
        { label: "Routed agent", render: (r) => r.ref_verifier_name || "—" },
        { label: "Shared with", render: (r) => r.verifier_name || "—" },
        { label: "Status", render: (r) => <span title={STATUS_TEXT[r.status]}><Badge status={r.status} /></span> },
        { label: "Proof", render: (r) => (r.proof_count ? `${r.proof_count} file(s)` : "—") },
        { label: "Updated", render: (r) => dt(r.updated_at) },
      ]} />
      {sel && <TicketModal t={sel} verifiers={verifiers} onClose={() => setSel(null)} reload={load} />}
    </Section>
  );
}
