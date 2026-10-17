import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise, blobUrl } from "@/lib/api";
import { Badge } from "@/components/common";
import { DataTable, Section, Modal, Input, Select, Btn } from "./ui";

function AccountModal({ acc, verifiers, onClose, onDone }) {
  const [f, setF] = useState(acc ? { name: acc.name, payment_details: acc.payment_details, upi_id: acc.upi_id, verifier_id: acc.verifier_id,
    deposit_limit: acc.deposit_limit / 100, withdrawal_limit: acc.withdrawal_limit / 100 }
    : { name: "", payment_details: "", upi_id: "", verifier_id: verifiers[0]?.id || "", deposit_limit: 100000, withdrawal_limit: 50000, opening_funds: 0 });
  const [qr, setQr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f, deposit_limit: toPaise(f.deposit_limit), withdrawal_limit: toPaise(f.withdrawal_limit), opening_funds: toPaise(f.opening_funds) };
    try {
      const id = acc ? (await api.put(`/admin/accounts/${acc.id}`, body), acc.id) : (await api.post("/admin/accounts", body)).data.id;
      if (qr) { const fd = new FormData(); fd.append("file", qr); await api.post(`/admin/accounts/${id}/qr`, fd); }
      toast.success("Account saved");
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={acc ? "Edit payment account" : "New payment account"} testid="account-modal">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Account name" value={f.name} onChange={set("name")} testid="acc-name" />
        <Input label="UPI ID" value={f.upi_id} onChange={set("upi_id")} testid="acc-upi" />
        <div className="col-span-2"><Input label="Payment details" value={f.payment_details} onChange={set("payment_details")} testid="acc-details" /></div>
        <Select label="Assigned verifier" value={f.verifier_id} onChange={set("verifier_id")} options={verifiers.map((v) => [v.id, `${v.display_name} (${v.username})`])} testid="acc-verifier" />
        <Input label="Max single deposit (₹)" type="number" value={f.deposit_limit} onChange={set("deposit_limit")} testid="acc-deposit-limit" />
        <Input label="Withdrawal limit (₹)" type="number" value={f.withdrawal_limit} onChange={set("withdrawal_limit")} testid="acc-withdrawal-limit" />
        {!acc && <Input label="Opening funds (₹)" type="number" value={f.opening_funds} onChange={set("opening_funds")} testid="acc-opening" />}
        <label className="block text-xs text-neutral-400 col-span-2">QR code image
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setQr(e.target.files[0])} className="mt-1 text-xs block" data-testid="acc-qr-upload" />
        </label>
      </div>
      <Btn primary className="w-full h-10" onClick={save} data-testid="acc-save">Save</Btn>
    </Modal>
  );
}

function FundsModal({ acc, onClose, onDone }) {
  const [f, setF] = useState({ amount: "", reason: "" });
  const save = async () => {
    try { await api.post(`/admin/accounts/${acc.id}/funds`, { amount: toPaise(f.amount), reason: f.reason }); toast.success("Funds adjusted"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Processing funds · ${acc.name}`} testid="funds-modal">
      <p className="text-xs text-neutral-400">Available {inr(acc.available_funds)} · committed {inr(acc.committed)}. Use negative values to reduce.</p>
      <Input label="Amount (₹, ±)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} testid="funds-amount" />
      <Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} testid="funds-reason" />
      <Btn primary className="w-full h-10" onClick={save} data-testid="funds-save">Apply</Btn>
    </Modal>
  );
}

function TxModal({ acc, onClose }) {
  const [t, setT] = useState(null);
  const [qr, setQr] = useState(null);
  useEffect(() => {
    api.get(`/admin/accounts/${acc.id}/transactions`).then(({ data }) => setT(data));
    if (acc.has_qr) blobUrl(`/admin/accounts/${acc.id}/qr`).then(setQr).catch(() => {});
  }, [acc.id, acc.has_qr]);
  return (
    <Modal open onClose={onClose} title={`Transactions · ${acc.name}`} testid="account-tx-modal">
      {qr && <img src={qr} alt="QR" className="w-32 h-32 bg-white rounded-lg object-contain" />}
      <div className="text-xs space-y-1">
        {t?.deposits.map((d) => <div key={d.id} className="flex justify-between border-b border-white/5 py-1"><span>Deposit · {d.username} · {d.status}</span><span className="mono">{inr(d.amount)}</span></div>)}
        {t?.withdrawals.map((w) => <div key={w.id} className="flex justify-between border-b border-white/5 py-1"><span>Withdrawal · {w.username} · {w.status}</span><span className="mono">{inr(w.amount)}</span></div>)}
        {t?.adjustments.map((a) => <div key={a.id} className="flex justify-between border-b border-white/5 py-1"><span>Funds · {a.reason} · {dt(a.created_at)}</span><span className="mono">{inr(a.amount)}</span></div>)}
      </div>
    </Modal>
  );
}

export default function AccountsTab() {
  const [rows, setRows] = useState([]);
  const [verifiers, setVerifiers] = useState([]);
  const [modal, setModal] = useState(null);
  const load = () => {
    api.get("/admin/accounts").then(({ data }) => setRows(data));
    api.get("/admin/verifiers").then(({ data }) => setVerifiers(data));
  };
  useEffect(() => { load(); }, []);
  const vname = (id) => verifiers.find((v) => v.id === id)?.display_name || "—";
  const toggle = async (a) => {
    try { await api.put(`/admin/accounts/${a.id}`, { status: a.status === "active" ? "inactive" : "active" }); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const done = () => { setModal(null); load(); };
  return (
    <Section title="Payment accounts" testid="admin-accounts"
      actions={<Btn primary onClick={() => setModal({ kind: "edit" })} disabled={!verifiers.length} data-testid="add-account-button">+ Add account</Btn>}>
      <DataTable rows={rows} minW={1000} cols={[
        { label: "Account", render: (r) => <><div className="font-semibold">{r.name}</div><div className="text-[11px] text-neutral-500">{r.payment_details}</div></> },
        { label: "UPI", key: "upi_id" }, { label: "QR", render: (r) => (r.has_qr ? "✓" : r.qr_missing ? <span className="text-red-400 font-semibold" data-testid={`qr-missing-${r.id}`}>Missing · re-upload</span> : "—") }, { label: "Verifier", render: (r) => vname(r.verifier_id) },
        { label: "Deposit / Wd limit", render: (r) => `${inr(r.deposit_limit)} / ${inr(r.withdrawal_limit)}` },
        { label: "Available", render: (r) => inr(r.available_funds) }, { label: "Committed", render: (r) => inr(r.committed) },
        { label: "Status", render: (r) => <Badge status={r.status} /> },
        { label: "Actions", render: (r) => <div className="flex flex-wrap gap-1">
          <Btn onClick={() => setModal({ kind: "edit", acc: r })} data-testid={`edit-account-${r.id.slice(0, 8)}`}>Edit / reassign</Btn>
          <Btn onClick={() => toggle(r)} data-testid={`toggle-account-${r.id.slice(0, 8)}`}>{r.status === "active" ? "Deactivate" : "Activate"}</Btn>
          <Btn onClick={() => setModal({ kind: "funds", acc: r })} data-testid={`funds-account-${r.id.slice(0, 8)}`}>Funds</Btn>
          <Btn onClick={() => setModal({ kind: "tx", acc: r })} data-testid={`tx-account-${r.id.slice(0, 8)}`}>History</Btn></div> },
      ]} />
      {modal?.kind === "edit" && <AccountModal acc={modal.acc} verifiers={verifiers} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "funds" && <FundsModal acc={modal.acc} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "tx" && <TxModal acc={modal.acc} onClose={() => setModal(null)} />}
    </Section>
  );
}
