import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { api, errMsg, inr, dt, toPaise, blobUrl } from "@/lib/api";
import { MobileShell, Field, SilverButton, Badge, Empty } from "@/components/common";

const PRESETS = [500, 1000, 2000, 5000];

export default function Deposit() {
  const [amount, setAmount] = useState("500");
  const [dep, setDep] = useState(null);
  const [qr, setQr] = useState(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const [unavailable, setUnavailable] = useState("");
  const load = () => api.get("/deposits").then(({ data }) => setList(data));
  useEffect(() => { load(); }, []);

  const assign = async () => {
    setBusy(true);
    setUnavailable("");
    try {
      const { data } = await api.post("/deposits/assign", { amount: toPaise(amount) });
      setDep(data);
      setQr(data.has_qr ? await blobUrl(`/deposits/${data.id}/qr`).catch(() => null) : null);
    } catch (e) {
      if (e?.response?.status === 503) setUnavailable(errMsg(e));
      else toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/deposits/${dep.id}/submit`, { utr });
      toast.success("Deposit request submitted. It will be credited after verification.");
      setDep(null); setUtr(""); setQr(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MobileShell title="Deposit" testid="deposit-page">
      {!dep ? (
        <div className="panel p-5 space-y-4 rise">
          <Field label="Deposit amount (₹)" prefix="₹" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} testid="deposit-amount-input" />
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setAmount(String(p))} data-testid={`deposit-preset-${p}`}
                className={`h-11 rounded-xl font-bold text-sm ${amount === String(p) ? "silver-btn" : "ghost-chip"}`}>₹{p.toLocaleString("en-IN")}</button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">Minimum ₹100. Deposits carry a 1× wagering requirement before withdrawal.</p>
          {unavailable && <div className="text-sm text-red-300 border border-red-500/30 rounded-xl p-3" data-testid="deposit-unavailable">{unavailable}</div>}
          <SilverButton onClick={assign} disabled={busy} data-testid="deposit-continue-button">{busy ? "ASSIGNING…" : "CONTINUE"}</SilverButton>
        </div>
      ) : (
        <div className="panel p-5 space-y-4 rise" data-testid="deposit-assigned">
          <div className="text-center">
            <div className="text-neutral-400 text-sm">Pay exactly</div>
            <div className="text-3xl font-black silver-text" data-testid="deposit-assigned-amount">{inr(dep.amount)}</div>
          </div>
          <div className="mx-auto w-56 h-56 rounded-2xl bg-white flex items-center justify-center overflow-hidden" data-testid="deposit-qr">
            {qr ? <img src={qr} alt="UPI QR" className="w-full h-full object-contain" /> : <span className="text-neutral-500 text-sm px-6 text-center">Pay using the UPI ID below</span>}
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(dep.upi_id); toast.success("UPI ID copied"); }}
            className="field w-full h-14 px-4 flex items-center justify-between" data-testid="deposit-upi-id">
            <span className="mono">{dep.upi_id}</span><Copy size={16} />
          </button>
          <div className="text-xs text-neutral-500">Account: {dep.account_name}</div>
          <Field label="UTR / Reference number" value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} testid="deposit-utr-input" />
          <SilverButton onClick={submit} disabled={busy || utr.length < 6} data-testid="submit-deposit-button">SUBMIT DEPOSIT REQUEST</SilverButton>
          <button onClick={() => setDep(null)} className="w-full text-sm text-neutral-400" data-testid="deposit-cancel-button">Cancel</button>
        </div>
      )}
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Deposit history</h3>
      <div className="space-y-2" data-testid="deposit-history">
        {list.length === 0 && <Empty>No deposits yet</Empty>}
        {list.map((d) => (
          <div key={d.id} className="panel !rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold mono">{inr(d.amount)}</div>
              <div className="text-[11px] text-neutral-500">{dt(d.created_at)} {d.utr ? `· UTR ${d.utr}` : ""}</div>
              {d.reject_reason && <div className="text-[11px] text-red-300">{d.reject_reason}</div>}
            </div>
            <Badge status={d.status} />
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
