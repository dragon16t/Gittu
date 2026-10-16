import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { Badge } from "@/components/common";
import { DataTable, Section, Modal, Input, Btn } from "./ui";

const LOGIN_URL = `${window.location.origin}/verifier/login`;
const copyLink = () => { navigator.clipboard?.writeText(LOGIN_URL); toast.success("Verifier login link copied"); };

const LoginLink = () => (
  <div className="panel !rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="verifier-login-link-box">
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">Verifier login link</div>
      <a href={LOGIN_URL} target="_blank" rel="noreferrer" className="mono text-sm underline break-all" data-testid="verifier-login-link">{LOGIN_URL}</a>
    </div>
    <Btn onClick={copyLink} data-testid="copy-verifier-login-link">Copy link</Btn>
  </div>
);

const Creds = ({ c, onClose }) => (
  <Modal open onClose={onClose} title="Verifier credentials" testid="verifier-credentials-modal">
    <p className="text-sm text-neutral-400">Shown once. Share securely; the verifier must change it at first login.</p>
    <div className="space-y-2 mono">
      <div className="field px-3 py-2" data-testid="generated-verifier-username">ID: {c.username}</div>
      <div className="field px-3 py-2" data-testid="generated-verifier-password">Temp password: {c.temporary_password}</div>
      <div className="field px-3 py-2 break-all" data-testid="generated-verifier-login-url">Login: {LOGIN_URL}</div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Btn className="h-10" onClick={() => { navigator.clipboard?.writeText(`Login: ${LOGIN_URL}\nID: ${c.username}\nTemporary password: ${c.temporary_password}`); toast.success("Credentials copied"); }} data-testid="copy-credentials">Copy all</Btn>
      <Btn primary className="h-10" onClick={onClose} data-testid="credentials-close">Done</Btn>
    </div>
  </Modal>
);

function CreateModal({ onClose, onCreated }) {
  const [f, setF] = useState({ display_name: "", account_name: "", payment_details: "", upi_id: "", deposit_capacity: 10, deposit_limit: 100000,
    withdrawal_limit: 50000, commission: 10, opening_funds: 0, perm_deposit: true, perm_withdraw: true });
  const [qr, setQr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    try {
      const { data } = await api.post("/admin/verifiers", {
        ...f, deposit_capacity: parseInt(f.deposit_capacity, 10), deposit_limit: toPaise(f.deposit_limit), withdrawal_limit: toPaise(f.withdrawal_limit),
        commission_bps: Math.round(parseFloat(f.commission) * 100), opening_funds: toPaise(f.opening_funds),
      });
      if (qr) {
        const fd = new FormData(); fd.append("file", qr);
        await api.post(`/admin/accounts/${data.account.id}/qr`, fd).catch((e) => toast.error(`QR upload failed: ${errMsg(e)}`));
      }
      onCreated(data.credentials);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Add payment verifier" testid="create-verifier-modal">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Display name" value={f.display_name} onChange={set("display_name")} testid="v-display-name" />
        <Input label="Account name" value={f.account_name} onChange={set("account_name")} testid="v-account-name" />
        <Input label="UPI ID" value={f.upi_id} onChange={set("upi_id")} testid="v-upi-id" />
        <Input label="Bank / payment details" value={f.payment_details} onChange={set("payment_details")} testid="v-payment-details" />
        <Input label="Deposit capacity (open requests)" type="number" value={f.deposit_capacity} onChange={set("deposit_capacity")} testid="v-capacity" />
        <Input label="Max single deposit (₹)" type="number" value={f.deposit_limit} onChange={set("deposit_limit")} testid="v-deposit-limit" />
        <Input label="Withdrawal limit (₹)" type="number" value={f.withdrawal_limit} onChange={set("withdrawal_limit")} testid="v-withdrawal-limit" />
        <Input label="Commission (%)" type="number" value={f.commission} onChange={set("commission")} testid="v-commission" />
        <Input label="Opening processing funds (₹)" type="number" value={f.opening_funds} onChange={set("opening_funds")} testid="v-opening-funds" />
        <label className="block text-xs text-neutral-400">QR code image
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setQr(e.target.files[0])} className="mt-1 text-xs" data-testid="v-qr-upload" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.perm_deposit} onChange={(e) => setF({ ...f, perm_deposit: e.target.checked })} data-testid="v-perm-deposit" />Deposit permission</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.perm_withdraw} onChange={(e) => setF({ ...f, perm_withdraw: e.target.checked })} data-testid="v-perm-withdraw" />Withdrawal permission</label>
      </div>
      <Btn primary className="w-full h-11 mt-2" onClick={create} data-testid="create-verifier-submit">CREATE ACCOUNT</Btn>
    </Modal>
  );
}

function CommissionModal({ v, onClose, onDone }) {
  const [f, setF] = useState({ amount: "", type: "release", note: "", account_id: v.accounts[0]?.id || "" });
  const submit = async () => {
    try { await api.post(`/admin/verifiers/${v.id}/commission`, { ...f, amount: toPaise(f.amount) }); toast.success("Commission entry recorded"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const s = v.summary;
  return (
    <Modal open onClose={onClose} title={`Commission · ${v.display_name}`} testid="commission-modal">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[["Deposits processed", s.deposits_total], ["Withdrawals processed", s.withdrawals_total], ["Eligible basis", s.commission_basis],
          ["Accrued", s.accrued], ["Paid", s.paid], ["Reversals", s.reversals], ["Adjustments", s.adjustments], ["Net payable", s.pending]].map(([l, x]) => (
          <div key={l} className="field px-3 py-2"><div className="text-neutral-500">{l}</div><div className="mono font-bold">{inr(x)}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Amount (₹)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} testid="commission-amount" />
        <label className="block"><span className="block text-xs text-neutral-400 mb-1">Type</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-full h-10 px-3 rounded-lg bg-black border border-white/15 text-sm" data-testid="commission-type">
            <option value="release">Release (pay)</option><option value="adjustment">Adjustment (+)</option><option value="reversal">Reversal (−)</option>
          </select></label>
        {f.type === "release" && <label className="block col-span-2"><span className="block text-xs text-neutral-400 mb-1">Pay from account</span>
          <select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} className="w-full h-10 px-3 rounded-lg bg-black border border-white/15 text-sm" data-testid="commission-account">
            {v.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · free {inr(a.available_funds - a.committed)}</option>)}
          </select></label>}
        <div className="col-span-2"><Input label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} testid="commission-note" /></div>
      </div>
      <Btn primary className="w-full h-10" onClick={submit} data-testid="commission-submit">Record</Btn>
    </Modal>
  );
}

function Activity({ v, onClose }) {
  const [a, setA] = useState(null);
  useEffect(() => { api.get(`/admin/verifiers/${v.id}/activity`).then(({ data }) => setA(data)); }, [v.id]);
  return (
    <Modal open onClose={onClose} title={`Activity · ${v.display_name}`} testid="verifier-activity-modal">
      <div className="space-y-1 text-xs max-h-[60vh] overflow-y-auto">
        {a?.audit.map((x) => <div key={x.id} className="flex justify-between border-b border-white/5 py-1.5"><span>{x.action}</span><span className="text-neutral-500">{dt(x.created_at)}</span></div>)}
        {a && a.audit.length === 0 && <div className="text-neutral-500">No activity</div>}
      </div>
    </Modal>
  );
}

export default function VerifiersTab() {
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);
  const load = () => api.get("/admin/verifiers").then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []);
  const upd = async (v, body) => {
    try { await api.put(`/admin/verifiers/${v.id}`, body); toast.success("Verifier updated"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const reset = async (v) => {
    if (!window.confirm(`Reset credentials for ${v.username}?`)) return;
    try { const { data } = await api.post(`/admin/verifiers/${v.id}/reset-credentials`); setModal({ kind: "creds", c: data }); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Section title="Payment verifier management" testid="admin-verifiers"
      actions={<Btn primary onClick={() => setModal({ kind: "create" })} data-testid="add-verifier-button">+ Add verifier</Btn>}>
      <LoginLink />
      <DataTable rows={rows} minW={1100} cols={[
        { label: "Verifier", render: (r) => <><div className="font-semibold">{r.display_name}</div><div className="mono text-[11px] text-neutral-500">{r.username}</div></> },
        { label: "Status", render: (r) => <><Badge status={r.status} /><div className={`text-[11px] mt-1 ${r.online ? "text-emerald-400" : "text-neutral-500"}`}>{r.online ? "online" : "offline"}</div></> },
        { label: "Accounts", render: (r) => r.accounts.map((a) => <div key={a.id} className="text-xs">{a.name} · {a.upi_id}</div>) },
        { label: "Commission", render: (r) => `${r.commission_bps / 100}%` },
        { label: "Permissions", render: (r) => <div className="flex gap-1">
          <Btn onClick={() => upd(r, { perm_deposit: !r.perm_deposit })} data-testid={`perm-deposit-${r.username}`}>Dep {r.perm_deposit ? "✓" : "✕"}</Btn>
          <Btn onClick={() => upd(r, { perm_withdraw: !r.perm_withdraw })} data-testid={`perm-withdraw-${r.username}`}>Wd {r.perm_withdraw ? "✓" : "✕"}</Btn></div> },
        { label: "Pending comm.", render: (r) => inr(r.summary.pending) },
        { label: "Outstanding", render: (r) => inr(r.summary.outstanding_withdrawals) },
        { label: "Actions", render: (r) => <div className="flex flex-wrap gap-1">
          <Btn onClick={() => upd(r, { status: r.status === "active" ? "disabled" : "active" })} data-testid={`toggle-verifier-${r.username}`}>{r.status === "active" ? "Disable" : "Reactivate"}</Btn>
          <Btn onClick={() => reset(r)} data-testid={`reset-verifier-${r.username}`}>Reset credentials</Btn>
          <Btn onClick={() => setModal({ kind: "comm", v: r })} data-testid={`commission-verifier-${r.username}`}>Commission</Btn>
          <Btn onClick={() => setModal({ kind: "act", v: r })} data-testid={`activity-verifier-${r.username}`}>Activity</Btn></div> },
      ]} />
      {modal?.kind === "create" && <CreateModal onClose={() => setModal(null)} onCreated={(c) => { setModal({ kind: "creds", c }); load(); }} />}
      {modal?.kind === "creds" && <Creds c={modal.c} onClose={() => setModal(null)} />}
      {modal?.kind === "comm" && <CommissionModal v={modal.v} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === "act" && <Activity v={modal.v} onClose={() => setModal(null)} />}
    </Section>
  );
}
