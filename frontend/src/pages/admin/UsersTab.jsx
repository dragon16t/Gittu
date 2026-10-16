import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { Badge } from "@/components/common";
import { DataTable, Section, Modal, Input, Select, Btn } from "./ui";

function AdjustModal({ user, onClose, onDone }) {
  const [f, setF] = useState({ amount: "", action: "credit", reason: "", reference: "", password: "", code: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      const { data } = await api.post(`/admin/users/${user.id}/adjust`, { ...f, amount: toPaise(f.amount) });
      toast.success(`Wallet updated. New balance ${inr(data.balance)}`);
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Add funds / adjust wallet · ${user.username}`} testid="adjust-wallet-modal">
      <div className="space-y-3">
        <Input label="User ID" value={user.id} readOnly testid="adjust-user-id" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount (₹)" type="number" value={f.amount} onChange={set("amount")} testid="adjust-amount-input" />
          <Select label="Action" value={f.action} onChange={set("action")} options={[["credit", "Credit"], ["debit", "Debit"]]} testid="adjust-action-select" />
        </div>
        <Input label="Reason (required)" value={f.reason} onChange={set("reason")} testid="adjust-reason-input" />
        <Input label="Internal reference" value={f.reference} onChange={set("reference")} testid="adjust-reference-input" />
        <div className="text-xs text-neutral-400 pt-2">Re-authenticate to confirm</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Admin password" type="password" value={f.password} onChange={set("password")} testid="adjust-password-input" />
          <Input label="Authenticator code" value={f.code} onChange={set("code")} testid="adjust-code-input" />
        </div>
        <Btn primary className="w-full h-11" onClick={submit} data-testid="adjust-submit-button">Confirm adjustment</Btn>
      </div>
    </Modal>
  );
}

function UserDetail({ id, onBack }) {
  const [d, setD] = useState(null);
  const [adj, setAdj] = useState(false);
  const load = () => api.get(`/admin/users/${id}`).then(({ data }) => setD(data));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="text-neutral-500">Loading…</div>;
  const status = async (s) => {
    try { await api.post(`/admin/users/${id}/status`, { status: s }); toast.success(`User ${s}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const u = d.user;
  return (
    <div className="space-y-6" data-testid="admin-user-detail">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <Btn onClick={onBack} data-testid="user-detail-back">← Users</Btn>
          <h2 className="text-xl font-black mt-3">{u.username} <Badge status={u.status} testid="user-detail-status" /></h2>
          <div className="text-xs mono text-neutral-500">{u.id}</div>
        </div>
        <div className="flex gap-2">
          <Btn primary onClick={() => setAdj(true)} data-testid="add-funds-button">Add funds / adjust wallet</Btn>
          {u.status === "active"
            ? <Btn onClick={() => status("suspended")} data-testid="suspend-user-button">Suspend</Btn>
            : <Btn onClick={() => status("active")} data-testid="reactivate-user-button">Reactivate</Btn>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="panel !rounded-2xl p-4">Balance<div className="mono text-lg font-bold" data-testid="user-detail-balance">{inr(d.wallet?.balance)}</div></div>
        <div className="panel !rounded-2xl p-4">Reserved<div className="mono text-lg font-bold">{inr(d.wallet?.reserved)}</div></div>
        <div className="panel !rounded-2xl p-4">Wagering left<div className="mono text-lg font-bold">{inr(d.wallet?.wager_remaining)}</div></div>
        <div className="panel !rounded-2xl p-4">UPI / Bank<div className="text-xs mt-1">{d.bank ? `${d.bank.upi_id || "—"} · ${d.bank.account_number || ""} ${d.bank.ifsc || ""}` : "Not added"}</div></div>
      </div>
      <Section title="Manual wallet adjustments"><DataTable rows={d.adjustments} cols={[
        { label: "When", render: (r) => dt(r.created_at) }, { label: "Action", key: "action" }, { label: "Amount", render: (r) => inr(r.amount) },
        { label: "Reason", key: "reason" }, { label: "Ref", key: "reference" }, { label: "By", key: "by" }, { label: "Balance after", render: (r) => inr(r.balance_after) }]} /></Section>
      <Section title="Deposits"><DataTable rows={d.deposits} cols={[
        { label: "When", render: (r) => dt(r.created_at) }, { label: "Amount", render: (r) => inr(r.amount) }, { label: "UTR", key: "utr" },
        { label: "Status", render: (r) => <Badge status={r.status} /> }]} /></Section>
      <Section title="Withdrawals"><DataTable rows={d.withdrawals} cols={[
        { label: "When", render: (r) => dt(r.created_at) }, { label: "Amount", render: (r) => inr(r.amount) }, { label: "Reference", key: "reference" },
        { label: "Status", render: (r) => <Badge status={r.status} /> }]} /></Section>
      <Section title="Bets & settlements"><DataTable rows={d.bets} cols={[
        { label: "Round", key: "round_number" }, { label: "Side", key: "side" }, { label: "Stake", render: (r) => inr(r.amount) },
        { label: "Status", render: (r) => <Badge status={r.status} /> }, { label: "Return", render: (r) => inr(r.payout) },
        { label: "Net", render: (r) => inr(r.net) }, { label: "Settlement txn", render: (r) => <span className="mono text-[11px]">{r.settlement_txn?.slice(0, 20) || "—"}</span> }]} /></Section>
      <Section title="Ledger"><DataTable rows={d.ledger} cols={[
        { label: "When", render: (r) => dt(r.created_at) }, { label: "Type", key: "type" }, { label: "Amount", render: (r) => inr(r.amount) },
        { label: "Balance after", render: (r) => inr(r.balance_after) }]} /></Section>
      {adj && <AdjustModal user={u} onClose={() => setAdj(false)} onDone={() => { setAdj(false); load(); }} />}
    </div>
  );
}

export default function UsersTab() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const search = () => api.get("/admin/users", { params: { q } }).then(({ data }) => setRows(data));
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (sel) return <UserDetail id={sel} onBack={() => { setSel(null); search(); }} />;
  return (
    <Section title="User management" testid="admin-users"
      actions={<div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Username or user ID"
          className="h-9 px-3 rounded-full bg-black border border-white/15 text-sm outline-none" data-testid="user-search-input" />
        <Btn primary onClick={search} data-testid="user-search-button">Search</Btn></div>}>
      <DataTable rows={rows} cols={[
        { label: "Username", render: (r) => <button className="underline underline-offset-4" onClick={() => setSel(r.id)} data-testid={`open-user-${r.username}`}>{r.username}</button> },
        { label: "User ID", render: (r) => <span className="mono text-[11px] text-neutral-400">{r.id}</span> },
        { label: "Status", render: (r) => <Badge status={r.status} /> }, { label: "Balance", render: (r) => inr(r.balance) },
        { label: "Reserved", render: (r) => inr(r.reserved) }, { label: "Joined", render: (r) => dt(r.created_at) },
      ]} />
    </Section>
  );
}
