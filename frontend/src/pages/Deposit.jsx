import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Headset, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { api, errMsg, inr, dt, toPaise, blobUrl } from "@/lib/api";
import { MobileShell, Field, SilverButton, Badge, Empty } from "@/components/common";

const PRESETS = [500, 1000, 2000, 5000];

const upiQuery = (dep) => new URLSearchParams({
  pa: dep.upi_id, pn: dep.account_name || "Payee", am: (dep.amount / 100).toFixed(2), cu: "INR", tn: `Deposit ${dep.id.slice(0, 8)}`,
}).toString().replace(/\+/g, "%20");

const APPS = [
  ["GPay", "tez://upi/pay"], ["PhonePe", "phonepe://pay"], ["Paytm", "paytmmp://pay"],
];

const UpiPay = ({ dep }) => {
  const q = upiQuery(dep);
  return (
    <div className="space-y-2" data-testid="upi-pay-section">
      <a href={`upi://pay?${q}`} className="silver-btn w-full h-12 rounded-2xl flex items-center justify-center gap-2 font-extrabold text-sm tracking-wide" data-testid="upi-pay-button">
        <Smartphone size={17} /> PAY WITH UPI APP · {inr(dep.amount)}
      </a>
      <div className="grid grid-cols-3 gap-2">
        {APPS.map(([n, base]) => (
          <a key={n} href={`${base}?${q}`} className="ghost-chip h-10 rounded-xl flex items-center justify-center text-xs font-bold text-neutral-200" data-testid={`upi-pay-${n.toLowerCase()}`}>{n}</a>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500 text-center">Amount and UPI ID are pre-filled. After paying, come back and enter the UTR below.</p>
    </div>
  );
};

export default function Deposit() {
  const [amount, setAmount] = useState("500");
  const [dep, setDep] = useState(null);
  const [qr, setQr] = useState(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const [unavailable, setUnavailable] = useState("");
  const load = () => api.get("/deposits").then(({ data }) => setList(data));
  const open = (data) => {
    setQr(data.has_qr ? "loading" : null);
    setDep(data);
    if (data.has_qr) blobUrl(`/deposits/${data.id}/qr`).then(setQr).catch(() => setQr(null));
  };
  const [pending, setPending] = useState(null);
  useEffect(() => {
    load();
    api.get("/deposits/active").then(({ data }) => setPending(data || null)).catch(() => {});
  }, []);
  const cancelDep = (d) => api.post(`/deposits/${d.id}/cancel`).catch(() => {});

  const assign = async () => {
    setBusy(true);
    setUnavailable("");
    try {
      if (pending) { await cancelDep(pending); setPending(null); }
      const { data } = await api.post("/deposits/assign", { amount: toPaise(amount) });
      open(data);
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
          {pending && (
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 flex items-center justify-between gap-3" data-testid="deposit-resume-card">
              <div className="text-xs text-neutral-300">Unfinished deposit of <b className="text-white">{inr(pending.amount)}</b></div>
              <button onClick={() => { open(pending); setPending(null); }} className="silver-btn rounded-full h-8 px-4 text-xs font-bold" data-testid="deposit-resume-button">Continue</button>
            </div>
          )}
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
            <div className="text-2xl font-black silver-text" data-testid="deposit-assigned-amount">{inr(dep.amount)}</div>
          </div>
          <div className="mx-auto w-56 h-56 rounded-2xl bg-white flex items-center justify-center overflow-hidden" data-testid="deposit-qr">
            {qr === "loading" ? <div className="w-40 h-40 rounded-xl bg-neutral-200 animate-pulse" data-testid="deposit-qr-loading" />
              : qr ? <img src={qr} alt="UPI QR" className="w-full h-full object-contain" /> : <span className="text-neutral-500 text-sm px-6 text-center">Pay using the UPI ID below</span>}
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(dep.upi_id); toast.success("UPI ID copied"); }}
            className="field w-full h-14 px-4 flex items-center justify-between" data-testid="deposit-upi-id">
            <span className="mono">{dep.upi_id}</span><Copy size={16} />
          </button>
          <div className="text-xs text-neutral-500">Account: {dep.account_name}</div>
          <UpiPay dep={dep} />
          <Field label="UTR / Reference number" value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} testid="deposit-utr-input" />
          <SilverButton onClick={submit} disabled={busy || utr.length < 6} data-testid="submit-deposit-button">SUBMIT DEPOSIT REQUEST</SilverButton>
          <button onClick={() => { cancelDep(dep); setAmount(String(dep.amount / 100)); setDep(null); setQr(null); load(); }} className="w-full text-sm text-neutral-400" data-testid="deposit-cancel-button">Change amount / Cancel</button>
        </div>
      )}
      <Link to="/support?kind=deposit" className="mt-5 panel !rounded-2xl h-14 px-4 flex items-center gap-3 text-sm" data-testid="deposit-support-link">
        <Headset size={18} className="text-neutral-400" />Customer support · deposit not credited? Raise a ticket
      </Link>
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
            <div className="text-right space-y-1">
              <Badge status={d.status} />
              {d.status !== "verified" && d.status !== "cancelled" && (
                <Link to={`/support?kind=deposit&ref=${d.id}`} className="block text-[11px] underline text-neutral-400" data-testid={`deposit-ticket-${d.id.slice(0, 8)}`}>Not credited? Raise ticket</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
