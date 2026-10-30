import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headset, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise, newKey } from "@/lib/api";
import { MobileShell, Field, SilverButton, Badge, Empty } from "@/components/common";
import { WagerProgress } from "@/components/WagerProgress";

const KycGate = ({ kyc }) => {
  if (!kyc || kyc.status === "verified") return null;
  const msg = { none: "Complete Aadhaar KYC to unlock withdrawals.", pending: "Your KYC is under review. Withdrawals unlock once verified.", rejected: `KYC rejected: ${kyc.reject_reason || ""}. Please resubmit.` }[kyc.status];
  return (
    <div className="text-sm text-amber-200 border border-amber-400/30 rounded-xl p-3" data-testid="withdraw-kyc-gate">
      {msg} <Link to="/kyc" className="underline font-semibold" data-testid="withdraw-kyc-link">Open KYC</Link>
    </div>
  );
};

const AccountPicker = ({ kyc, value, onChange }) => {
  const ok = (kyc?.accounts || []).filter((a) => a.status === "approved");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span>Withdraw to</span>
        {kyc?.status === "verified" && <span className="flex items-center gap-1 text-emerald-300" data-testid="withdraw-kyc-verified"><ShieldCheck size={13} />Aadhaar verified</span>}
      </div>
      {ok.length === 0 ? <div className="text-xs text-neutral-500" data-testid="withdraw-no-accounts">No verified account yet. <Link to="/kyc" className="underline" data-testid="add-account-link">Add / manage accounts</Link></div> : (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="field !rounded-xl w-full h-11 px-3 bg-black text-sm" data-testid="withdraw-account-select">
          {ok.map((a) => <option key={a.id} value={a.id}>{a.kind === "bank" ? `Bank ${a.account_number} · ${a.ifsc}` : `UPI ${a.upi_id}`}</option>)}
        </select>
      )}
      {ok.length > 0 && <Link to="/kyc" className="text-[11px] underline text-neutral-500" data-testid="manage-accounts-link">Manage accounts</Link>}
    </div>
  );
};

export default function Withdraw() {
  const [w, setW] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [amount, setAmount] = useState("");
  const [acc, setAcc] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const load = () => {
    api.get("/wallet").then(({ data }) => setW(data));
    api.get("/withdrawals").then(({ data }) => setList(data));
  };
  useEffect(() => {
    load();
    api.get("/kyc").then(({ data }) => { setKyc(data); setAcc(data.accounts.find((a) => a.status === "approved")?.id || ""); });
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/withdrawals", { amount: toPaise(amount), account_id: acc, client_key: newKey() });
      toast.success("Withdrawal requested. Funds are reserved until it is processed.");
      setAmount("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const min = (w?.min_withdrawal || 30000) / 100;
  return (
    <MobileShell title="Withdraw" testid="withdraw-page">
      <div className="panel p-5 space-y-4 rise">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-400">Available</span><span className="mono font-bold" data-testid="withdraw-available">{inr(w?.balance)}</span>
        </div>
        <div data-testid="withdraw-wager-warning"><WagerProgress w={w} /></div>
        <KycGate kyc={kyc} />
        <AccountPicker kyc={kyc} value={acc} onChange={setAcc} />
        <Field label={`Amount (min ₹${min})`} prefix="₹" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} testid="withdraw-amount-input" />
        <SilverButton onClick={submit} disabled={busy || !amount || !acc} data-testid="submit-withdrawal-button">REQUEST WITHDRAWAL</SilverButton>
      </div>
      <Link to="/support?kind=withdrawal" className="mt-5 panel !rounded-2xl h-14 px-4 flex items-center gap-3 text-sm" data-testid="withdraw-support-link">
        <Headset size={18} className="text-neutral-400" />Customer support · withdrawal not received? Raise a ticket
      </Link>
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Withdrawal requests</h3>
      <div className="space-y-2" data-testid="withdrawal-history">
        {list.length === 0 && <Empty>No withdrawals yet</Empty>}
        {list.map((x) => (
          <div key={x.id} className="panel !rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold mono">{inr(x.amount)}</div>
              <div className="text-[11px] text-neutral-500">
                {dt(x.created_at)} · {x.destination?.label || x.destination?.upi_id || "—"} {x.reference ? `· Ref ${x.reference}` : ""}
              </div>
            </div>
            <div className="text-right space-y-1">
              <Badge status={x.status} testid={`withdrawal-status-${x.id.slice(0, 8)}`} />
              {!["completed", "rejected"].includes(x.status) && (
                <Link to={`/support?kind=withdrawal&ref=${x.id}`} className="block text-[11px] underline text-neutral-400" data-testid={`withdrawal-ticket-${x.id.slice(0, 8)}`}>Raise ticket</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
