import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Share2, Clock, Users, Wallet } from "lucide-react";
import { api, errMsg, inr, inr0, dt, toPaise } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { MobileShell, Field, SilverButton } from "@/components/common";
import { EarnUnlimitedBadge, useCountdown } from "@/components/chain/ChainPromo";

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

const Stat = ({ label, value, testid, accent }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
    <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">{label}</div>
    <div className={`mt-1 text-lg font-black mono ${accent || "text-white"}`} data-testid={testid}>{value}</div>
  </div>
);

const Hero = ({ c }) => {
  const cd = useCountdown(c.next_payout_at);
  return (
    <div className="panel p-5 rise relative overflow-hidden border border-[#d4af37]/40" data-testid="chain-hero">
      <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(0,245,138,0.15),transparent_70%)]" />
      <EarnUnlimitedBadge />
      <h2 className="mt-2 text-2xl font-black gold-text leading-tight">Earn ₹5,000 – ₹10 Lakh a day</h2>
      <p className="text-[12px] text-neutral-300 mt-1.5 leading-relaxed">
        Everyone joined through your chain — your friends, their friends and so on with <b className="text-white">no level limit</b> — forms one pool.
        Every night at 12 AM, <b className="text-[#00F58A]">{c.pct}% of the pool's total deposits</b> is shared equally among members who have deposited.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Pool members" value={c.pool.members} testid="chain-pool-members" />
        <Stat label="Eligible (deposited)" value={c.pool.eligible} testid="chain-pool-eligible" />
        <Stat label="Pool deposits today" value={inr0(c.pool.today_deposits)} testid="chain-pool-today" />
        <Stat label="Your share tonight (est.)" value={inr(c.pool.my_estimate)} testid="chain-my-estimate" accent="text-[#00F58A]" />
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-neutral-400"><Clock size={13} />Next payout in</span>
        <span className="mono font-bold text-white" data-testid="chain-countdown">{cd}</span>
      </div>
      {!c.pool.i_am_eligible && <div className="mt-3 text-[11px] text-amber-200 border border-amber-400/30 rounded-xl p-2.5" data-testid="chain-not-eligible">
        Make your first deposit to start receiving your share. <Link to="/deposit" className="underline font-semibold">Deposit now</Link></div>}
    </div>
  );
};

const Invite = ({ code }) => {
  const brand = useBrand();
  const link = `${window.location.origin}/register?ref=${code}`;
  const text = `Join my ${brand} chain pool! Every night 10% of our whole chain's deposits is shared with everyone. No level limit. Join with my code ${code}: ${link}`;
  return (
    <div className="panel p-4 space-y-3" data-testid="chain-invite">
      <div className="text-sm font-bold text-white flex items-center gap-2"><Users size={15} className="text-[#d4af37]" />Grow your pool faster</div>
      <p className="text-[11px] text-neutral-400">Every new member who deposits — at any level below you — raises the pool for everyone. Ask your friends to share their link too.</p>
      <button onClick={() => { navigator.clipboard?.writeText(link); toast.success("Link copied"); }}
        className="w-full h-11 rounded-xl border border-dashed border-[#d4af37]/50 bg-black/60 flex items-center justify-center gap-2 text-xs mono" data-testid="chain-copy-link">
        <span className="truncate max-w-[80%]">{link}</span><Copy size={13} />
      </button>
      <div className="grid grid-cols-2 gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
          className="h-11 rounded-full bg-[#25D366] text-black font-extrabold text-xs flex items-center justify-center" data-testid="chain-share-whatsapp">Share on WhatsApp</a>
        <button onClick={() => (navigator.share ? navigator.share({ text }).catch(() => {}) : (navigator.clipboard?.writeText(text), toast.success("Invite copied")))}
          className="h-11 rounded-full ghost-chip font-bold text-xs flex items-center justify-center gap-1.5" data-testid="chain-share-more"><Share2 size={13} />More apps</button>
      </div>
    </div>
  );
};

const Funds = ({ c, reload }) => {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("withdraw");
  const [kyc, setKyc] = useState(null);
  const [acc, setAcc] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/kyc").then(({ data }) => { setKyc(data); setAcc(data.accounts.find((a) => a.status === "approved")?.id || ""); }); }, []);
  const ok = (kyc?.accounts || []).filter((a) => a.status === "approved");
  const go = async () => {
    setBusy(true);
    try {
      if (mode === "withdraw") await api.post("/chain/withdraw", { amount: toPaise(amount), account_id: acc, client_key: newKey() });
      else await api.post("/chain/transfer", { amount: toPaise(amount), client_key: newKey() });
      toast.success(mode === "withdraw" ? "Withdrawal requested" : "Moved to game wallet");
      setAmount(""); reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="panel p-4 space-y-3" data-testid="chain-funds">
      <div className="flex items-center justify-between">
        <div><div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Chain earnings</div>
          <div className="text-2xl font-black silver-text" data-testid="chain-balance">{inr(c.balance)}</div></div>
        <div className="text-right text-[11px] text-neutral-500">Total earned<div className="mono text-white" data-testid="chain-total-earned">{inr(c.total_earned)}</div></div>
      </div>
      <div className="flex gap-2">
        {[["withdraw", "Withdraw"], ["transfer", "Move to game wallet"]].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} data-testid={`chain-mode-${k}`}
            className={`flex-1 h-9 rounded-full text-xs font-semibold ${mode === k ? "bg-white text-black" : "ghost-chip"}`}>{l}</button>))}
      </div>
      <Field label={mode === "withdraw" ? `Amount (min ${inr0(c.min_withdraw)}, no wagering)` : "Amount"} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} testid="chain-amount-input" />
      {mode === "withdraw" && (kyc?.status !== "verified" || !ok.length
        ? <div className="text-xs text-amber-200" data-testid="chain-kyc-needed">Aadhaar KYC and a verified account are needed. <Link to="/kyc" className="underline">Open KYC</Link></div>
        : <select value={acc} onChange={(e) => setAcc(e.target.value)} className="field !rounded-xl w-full h-11 px-3 bg-black text-sm" data-testid="chain-account-select">
          {ok.map((a) => <option key={a.id} value={a.id}>{a.kind === "bank" ? `Bank ${a.account_number} · ${a.ifsc}` : `UPI ${a.upi_id}`}</option>)}</select>)}
      <SilverButton onClick={go} disabled={busy || !amount || toPaise(amount) > c.balance || (mode === "withdraw" && !acc)} data-testid="chain-submit-button">
        {toPaise(amount) > c.balance ? "LOW CHAIN BALANCE" : mode === "withdraw" ? "WITHDRAW" : "MOVE TO GAME WALLET"}</SilverButton>
    </div>
  );
};

const LABEL = { pool_share: "Pool payout", to_game_wallet: "Moved to game wallet", withdraw_reserve: "Withdrawal", withdraw_refund: "Withdrawal returned" };

export default function Chain() {
  const [c, setC] = useState(null);
  const [code, setCode] = useState("");
  const load = () => api.get("/chain").then(({ data }) => setC(data));
  useEffect(() => { load(); api.get("/referrals").then(({ data }) => setCode(data.code)); }, []);
  if (!c) return <MobileShell title="Chain Earnings" testid="chain-page" />;
  return (
    <MobileShell title="Chain Earnings" testid="chain-page">
      <div className="space-y-4">
        <Hero c={c} />
        <Funds c={c} reload={load} />
        {code && <Invite code={code} />}
        <div className="space-y-2" data-testid="chain-ledger">
          <h3 className="text-sm font-semibold text-neutral-300 flex items-center gap-2"><Wallet size={14} />History</h3>
          {c.ledger.length === 0 && <div className="text-xs text-neutral-500">No chain earnings yet. Payouts arrive every night at 12 AM.</div>}
          {c.ledger.map((l) => (
            <div key={l.id} className="panel !rounded-xl px-3.5 py-2.5 flex items-center justify-between text-sm">
              <div><div className="text-white text-[13px]">{LABEL[l.type] || l.type}</div><div className="text-[10px] text-neutral-500">{l.meta?.day || dt(l.created_at)}</div></div>
              <span className={`mono font-bold ${l.amount > 0 ? "text-[#00F58A]" : "text-neutral-300"}`}>{l.amount > 0 ? "+" : ""}{inr(l.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </MobileShell>
  );
}
