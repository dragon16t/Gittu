import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { DataTable, Section, Input, Select, Btn, Modal } from "./ui";

const EMPTY = { name: "", username: "", email: "", phone: "", business_details: "", internal_ref: "", plan_id: "", payout_method: "UPI", payout_account: "" };
const WD_ACTIONS = { requested: ["review", "approve", "reject"], under_review: ["approve", "reject"], approved: ["processing", "reject"], processing: ["complete", "fail"] };

const Detail = ({ pid, onClose }) => {
  const [d, setD] = useState(null);
  const [note, setNote] = useState("");
  const [adj, setAdj] = useState({ direction: "credit", amount: "", reason: "" });
  const [pay, setPay] = useState({ payout_method: "UPI", payout_account: "" });
  const load = () => api.get(`/admin/partners/${pid}`).then(({ data }) => setD(data));
  useEffect(() => { if (pid) load(); }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } };
  const status = (st) => { const reason = window.prompt(`Reason to set ${st}:`); if (reason) act(() => api.post(`/admin/partners/${pid}/status`, { status: st, reason }), `Partner ${st}`); };
  if (!pid) return null;
  const p = d?.partner;
  return (
    <Modal open={!!pid} onClose={onClose} title={p ? `${p.name} · ${p.partner_code}` : "Partner"} testid="partner-detail-modal">
      {d && <div className="space-y-4 max-h-[70vh] overflow-y-auto text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[["Username", p.username], ["Email", p.email], ["Phone", p.phone || "—"], ["Status", p.status], ["Payout", `${p.payout_method} ${p.payout_masked}`], ["Plan", d.plan ? `${d.plan.name} v${d.plan.version} (${d.plan.status})` : "None"],
            ["Registered users", d.stats.registered_users], ["Verified users", d.stats.verified_users], ["Available", inr(d.stats.available)], ["Reserved", inr(d.stats.reserved)], ["Total earned", inr(d.stats.total_earnings)], ["Paid out", inr(d.stats.withdrawn)]]
            .map(([k, v]) => <div key={k}><span className="text-neutral-500">{k}: </span>{v}</div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.status === "active" && <Btn onClick={() => status("suspended")} data-testid="partner-suspend-button">Suspend</Btn>}
          {p.status === "suspended" && <Btn onClick={() => status("active")} data-testid="partner-reactivate-button">Reactivate</Btn>}
          {p.status === "invited" && <Btn onClick={() => act(async () => { const { data } = await api.post(`/admin/partners/${pid}/invite`); window.prompt("New one-time setup link (valid 72h):", window.location.origin + data.setup_path); }, "New setup link created")} data-testid="partner-reinvite-button">New setup link</Btn>}
        </div>
        <div className="grid grid-cols-3 gap-2 items-end">
          <Select label="Adjustment" value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })} options={[["credit", "Credit"], ["debit", "Debit"]]} testid="partner-adj-direction" />
          <Input label="Amount (₹)" type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} testid="partner-adj-amount" />
          <Input label="Reason (required)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} testid="partner-adj-reason" />
        </div>
        <Btn primary onClick={() => act(() => api.post(`/admin/partners/${pid}/adjust`, { ...adj, amount: toPaise(adj.amount) }), "Ledger entry posted")} data-testid="partner-adj-submit">Post adjustment (append-only)</Btn>
        <div className="grid grid-cols-3 gap-2 items-end">
          <Input label="Payout method" value={pay.payout_method} onChange={(e) => setPay({ ...pay, payout_method: e.target.value })} testid="partner-payout-method" />
          <Input label="Payout account / UPI" value={pay.payout_account} onChange={(e) => setPay({ ...pay, payout_account: e.target.value })} testid="partner-payout-account" />
          <Btn onClick={() => act(() => api.post(`/admin/partners/${pid}/payout`, pay), "Payout method saved")} data-testid="partner-payout-save">Save payout</Btn>
        </div>
        <div className="flex gap-2"><Input label="Admin note" value={note} onChange={(e) => setNote(e.target.value)} testid="partner-note-input" />
          <Btn onClick={() => act(() => api.post(`/admin/partners/${pid}/notes`, { text: note }), "Note added")} data-testid="partner-note-submit">Add</Btn></div>
        {p.notes?.map((n, i) => <div key={i} className="text-xs text-neutral-400">{dt(n.at)} · {n.by}: {n.text}</div>)}
        <div className="font-semibold">Wallet ledger</div>
        <DataTable minW={520} rows={d.ledger} cols={[{ label: "Date", render: (r) => dt(r.created_at) }, { label: "Type", key: "type" }, { label: "Amount", render: (r) => inr(r.amount) }, { label: "Reason", render: (r) => r.reason || "—" }]} />
        <div className="font-semibold">Withdrawals</div>
        <DataTable minW={520} rows={d.withdrawals} cols={[{ label: "Ref", key: "reference" }, { label: "Amount", render: (r) => inr(r.amount) }, { label: "Status", key: "status" }, { label: "Txn", render: (r) => r.txn_ref || "—" }]} />
        <div className="font-semibold">Audit history</div>
        <DataTable minW={520} rows={d.audit} cols={[{ label: "When", render: (r) => dt(r.created_at) }, { label: "Action", key: "action" }, { label: "By", key: "actor" }]} />
      </div>}
    </Modal>
  );
};

export default function FranchiseeTab() {
  const [list, setList] = useState({ rows: [], total: 0 });
  const [q, setQ] = useState({ q: "", status: "", page: 1 });
  const [f, setF] = useState(EMPTY);
  const [created, setCreated] = useState(null);
  const [open, setOpen] = useState(null);
  const [plans, setPlans] = useState([]);
  const [pl, setPl] = useState({ name: "", event: "", basis: "", rate: "", conditions: "", start: "", end: "", jurisdiction: "", reversal_rules: "" });
  const [wds, setWds] = useState([]);
  const load = () => {
    api.get("/admin/partners", { params: q }).then(({ data }) => setList(data));
    api.get("/admin/partner-plans").then(({ data }) => setPlans(data));
    api.get("/admin/partner-withdrawals").then(({ data }) => setWds(data));
  };
  useEffect(load, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } };
  const create = () => act(async () => { const { data } = await api.post("/admin/partners", f); setCreated(data); setF(EMPTY); }, "Partner created");
  const wdAction = (w, action) => {
    const body = { action };
    if (action === "reject" || action === "fail") { body.reason = window.prompt("Reason:") || ""; if (!body.reason) return; }
    if (action === "complete") {
      body.txn_ref = window.prompt("Bank/UPI transaction reference (8-30 letters/numbers):") || "";
      if (!body.txn_ref) return;
      body.payment_verified = window.confirm("Have you verified this payment in the bank/provider statement?");
    }
    act(() => api.post(`/admin/partner-withdrawals/${w.id}/action`, body), `Withdrawal ${action}`);
  };
  return (
    <>
      <Section title="Franchisee partners" testid="franchisee-list" actions={<span className="text-xs text-neutral-500">Partner portal: /partner/login</span>}>
        <div className="grid md:grid-cols-3 gap-2">
          <Input label="Search name / username / partner ID" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value, page: 1 })} testid="franchisee-search" />
          <Select label="Status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 1 })} options={[["", "All"], ["active", "Active"], ["invited", "Invited"], ["suspended", "Suspended"]]} testid="franchisee-status-filter" />
          <div className="flex items-end gap-2 text-xs text-neutral-400">
            <Btn onClick={() => setQ({ ...q, page: Math.max(1, q.page - 1) })} data-testid="franchisee-prev">Prev</Btn>
            <span>Page {q.page} · {list.total} total</span>
            <Btn onClick={() => setQ({ ...q, page: q.page + 1 })} disabled={q.page * 20 >= list.total} data-testid="franchisee-next">Next</Btn>
          </div>
        </div>
        <DataTable rows={list.rows} cols={[{ label: "Partner ID", key: "partner_code" }, { label: "Name", key: "name" }, { label: "Username", key: "username" },
          { label: "Created", render: (r) => dt(r.created_at) }, { label: "Status", key: "status" }, { label: "Referral ID", render: (r) => `?p=${r.partner_code}` },
          { label: "Users", key: "registered_users" }, { label: "Verified", key: "verified_users" }, { label: "Earnings", render: (r) => inr(r.total_earnings) },
          { label: "Available", render: (r) => inr(r.available) }, { label: "Pending WD", render: (r) => inr(r.pending_withdrawals) },
          { label: "", render: (r) => <Btn onClick={() => setOpen(r.id)} data-testid={`franchisee-open-${r.partner_code}`}>Open</Btn> }]} />
      </Section>
      <Section title="Create franchisee" testid="franchisee-create">
        <div className="grid md:grid-cols-3 gap-3">
          {[["name", "Partner name *"], ["username", "Unique username *"], ["email", "Email *"], ["phone", "Phone"], ["business_details", "Approved business details"], ["internal_ref", "Internal partner reference"],
            ["payout_method", "Payout method"], ["payout_account", "Payout account / UPI"]].map(([k, l]) => <Input key={k} label={l} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} testid={`franchisee-${k}`} />)}
          <Select label="Compensation plan" value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })} options={[["", "None"], ...plans.map((p) => [p.id, `${p.name} v${p.version} (${p.status})`])]} testid="franchisee-plan" />
        </div>
        <div className="flex justify-end"><Btn primary onClick={create} data-testid="franchisee-create-button">Create partner &amp; invite link</Btn></div>
        {created && <div className="panel !rounded-xl p-3 text-xs space-y-1" data-testid="franchisee-created">
          <div>Partner ID <b>{created.partner_code}</b> created. Send this <b>one-time setup link</b> (valid 72h). No password is ever shown:</div>
          <div className="mono break-all text-emerald-300">{window.location.origin + created.setup_path}</div>
          <div>Partner login URL: <span className="mono">{window.location.origin + created.login_path}</span></div>
        </div>}
      </Section>
      <Section title="Partner withdrawal queue" testid="franchisee-withdrawals">
        <DataTable rows={wds} cols={[{ label: "Ref", key: "reference" }, { label: "Partner", key: "partner_name" }, { label: "Amount", render: (r) => inr(r.amount) },
          { label: "To", render: (r) => `${r.method} ${r.destination_masked}` }, { label: "Requested", render: (r) => dt(r.created_at) }, { label: "Status", key: "status" },
          { label: "Txn ref", render: (r) => r.txn_ref || "—" },
          { label: "Actions", render: (r) => <div className="flex gap-1 flex-wrap">{(WD_ACTIONS[r.status] || []).map((a) => <Btn key={a} onClick={() => wdAction(r, a)} data-testid={`pwd-${a}-${r.reference}`}>{a}</Btn>)}</div> }]} />
      </Section>
      <Section title="Compensation plans (disabled until compliance approval)" testid="franchisee-plans">
        <div className="grid md:grid-cols-3 gap-3">
          {[["name", "Plan name"], ["event", "Eligible event / service"], ["basis", "Calculation basis"], ["rate", "Rate or fixed amount"], ["conditions", "Eligibility conditions"], ["jurisdiction", "Jurisdiction"],
            ["start", "Effective start (YYYY-MM-DD)"], ["end", "Effective end"], ["reversal_rules", "Reversal & adjustment rules"]].map(([k, l]) => <Input key={k} label={l} value={pl[k]} onChange={(e) => setPl({ ...pl, [k]: e.target.value })} testid={`plan-${k}`} />)}
        </div>
        <div className="flex justify-end"><Btn primary onClick={() => act(() => api.post("/admin/partner-plans", pl), "Plan version saved as draft")} data-testid="plan-create-button">Save plan version</Btn></div>
        <DataTable rows={plans} cols={[{ label: "Plan", render: (r) => `${r.name} v${r.version}` }, { label: "Event", key: "event" }, { label: "Rate", key: "rate" }, { label: "Jurisdiction", key: "jurisdiction" },
          { label: "Compliance", render: (r) => r.compliance_ref || "Not approved" }, { label: "Status", key: "status" },
          { label: "", render: (r) => <div className="flex gap-1">
            {!r.compliance_ref && <Btn onClick={() => { const ref = window.prompt("Legal/compliance approval reference:"); if (ref) act(() => api.post(`/admin/partner-plans/${r.id}/compliance`, { approval_ref: ref }), "Approval recorded"); }} data-testid={`plan-approve-${r.id}`}>Record approval</Btn>}
            {r.status !== "active" && <Btn onClick={() => act(() => api.post(`/admin/partner-plans/${r.id}/activate`), "Plan activated")} data-testid={`plan-activate-${r.id}`}>Activate</Btn>}
          </div> }]} />
        <p className="text-[11px] text-neutral-500">The automatic commission engine is OFF. No commission is ever calculated on wagers, losses or deposits. Earnings are posted only as audited admin ledger entries.</p>
      </Section>
      <Detail pid={open} onClose={() => { setOpen(null); load(); }} />
    </>
  );
}
