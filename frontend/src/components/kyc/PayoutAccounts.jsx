import { useState } from "react";
import { toast } from "sonner";
import { Landmark, Smartphone, Trash2 } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { Field, SilverButton, Badge } from "@/components/common";

const AddAccount = ({ onDone }) => {
  const [f, setF] = useState({ kind: "bank", holder_name: "", account_number: "", ifsc: "", upi_id: "", password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { await api.post("/payout-accounts", f); toast.success("Account added. Awaiting admin verification."); onDone(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="panel p-5 space-y-3 rise" data-testid="add-account-form">
      <div className="flex gap-2">
        {[["bank", "Bank account"], ["upi", "UPI ID"]].map(([k, l]) => (
          <button key={k} onClick={() => setF({ ...f, kind: k })} data-testid={`account-kind-${k}`}
            className={`flex-1 h-10 rounded-full text-sm font-semibold transition-colors ${f.kind === k ? "bg-white text-black" : "ghost-chip"}`}>{l}</button>
        ))}
      </div>
      <Field label="Account holder name (must match Aadhaar / PAN)" value={f.holder_name} onChange={set("holder_name")} testid="account-holder-input" />
      {f.kind === "bank" ? (<>
        <Field label="Account number" inputMode="numeric" value={f.account_number} onChange={set("account_number")} testid="account-number-input" />
        <Field label="IFSC" value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} testid="account-ifsc-input" />
      </>) : <Field label="UPI ID" placeholder="name@bank" value={f.upi_id} onChange={set("upi_id")} testid="account-upi-input" />}
      <Field label="Confirm with your password" type="password" value={f.password} onChange={set("password")} testid="account-password-input" />
      <SilverButton onClick={save} disabled={busy || !f.holder_name || !f.password} data-testid="account-save-button">ADD ACCOUNT</SilverButton>
    </div>
  );
};

const AccountRow = ({ a, onRemove }) => (
  <div className="panel !rounded-2xl px-4 py-3 flex items-center gap-3" data-testid={`payout-account-${a.id.slice(0, 8)}`}>
    {a.kind === "bank" ? <Landmark size={18} className="text-neutral-400" /> : <Smartphone size={18} className="text-neutral-400" />}
    <div className="flex-1 min-w-0">
      <div className="mono text-sm truncate">{a.kind === "bank" ? `${a.account_number} · ${a.ifsc}` : a.upi_id}</div>
      <div className="text-[11px] text-neutral-500 truncate">{a.holder_name}{a.reject_reason ? ` · ${a.reject_reason}` : ""}</div>
    </div>
    <Badge status={a.status} testid={`payout-account-status-${a.id.slice(0, 8)}`} />
    <button onClick={() => window.confirm("Remove this account?") && onRemove(a.id)} className="text-neutral-500 hover:text-red-400" data-testid={`payout-account-remove-${a.id.slice(0, 8)}`}><Trash2 size={15} /></button>
  </div>
);

export const PayoutAccounts = ({ accounts, max, canAdd, reload }) => {
  const [adding, setAdding] = useState(false);
  const remove = async (id) => {
    try { await api.delete(`/payout-accounts/${id}`); toast.success("Account removed"); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const active = accounts.filter((a) => a.status !== "rejected").length;
  return (
    <div className="space-y-2.5" data-testid="payout-accounts">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-300">Withdrawal accounts <span className="text-neutral-500 text-xs">({active}/{max})</span></h3>
        {canAdd && active < max && <button onClick={() => setAdding(!adding)} className="ghost-chip rounded-full px-4 h-9 text-xs font-semibold" data-testid="add-account-toggle">{adding ? "Cancel" : "+ Add account"}</button>}
      </div>
      {!canAdd && <p className="text-xs text-neutral-500">Submit your Aadhaar KYC to add withdrawal accounts.</p>}
      {adding && <AddAccount onDone={() => { setAdding(false); reload(); }} />}
      {accounts.map((a) => <AccountRow key={a.id} a={a} onRemove={remove} />)}
    </div>
  );
};
