import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise, newKey } from "@/lib/api";
import { MobileShell, Field, SilverButton, Badge, Empty } from "@/components/common";

export default function Withdraw() {
  const [w, setW] = useState(null);
  const [bank, setBank] = useState(undefined);
  const [amount, setAmount] = useState("");
  const [upi, setUpi] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const load = () => {
    api.get("/wallet").then(({ data }) => setW(data));
    api.get("/withdrawals").then(({ data }) => setList(data));
  };
  useEffect(() => {
    load();
    api.get("/bank").then(({ data }) => { setBank(data); setUpi(data?.upi_id || ""); });
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/withdrawals", { amount: toPaise(amount), upi_id: upi.trim(), client_key: newKey() });
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
        {w?.wager_remaining > 0 && (
          <div className="text-xs text-amber-200/90 border border-amber-200/20 rounded-xl p-3" data-testid="withdraw-wager-warning">
            Wagering requirement pending: place {inr(w.wager_remaining)} more in bets to unlock withdrawals.
          </div>
        )}
        {bank === null && (
          <div className="text-sm text-neutral-300 border border-white/15 rounded-xl p-3">
            Save your UPI ID first. <Link to="/settings?bank=1" className="underline" data-testid="add-upi-link">Add UPI details</Link>
          </div>
        )}
        <Field label="UPI ID" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" testid="withdraw-upi-input" />
        <p className="text-[11px] text-neutral-500 -mt-2">
          Must match your saved UPI ID. <Link to="/settings?bank=1" className="underline" data-testid="edit-upi-link">Edit destination</Link>
        </p>
        <Field label={`Amount (min ₹${min})`} prefix="₹" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} testid="withdraw-amount-input" />
        <SilverButton onClick={submit} disabled={busy || !amount || !upi} data-testid="submit-withdrawal-button">REQUEST WITHDRAWAL</SilverButton>
      </div>
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Withdrawal requests</h3>
      <div className="space-y-2" data-testid="withdrawal-history">
        {list.length === 0 && <Empty>No withdrawals yet</Empty>}
        {list.map((x) => (
          <div key={x.id} className="panel !rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold mono">{inr(x.amount)}</div>
              <div className="text-[11px] text-neutral-500">
                {dt(x.created_at)} · {x.destination?.upi_id || "—"} {x.reference ? `· Ref ${x.reference}` : ""}
              </div>
            </div>
            <Badge status={x.status} testid={`withdrawal-status-${x.id.slice(0, 8)}`} />
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
