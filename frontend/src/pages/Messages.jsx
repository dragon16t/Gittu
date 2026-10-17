import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { MobileShell, Badge, Empty } from "@/components/common";

const KIND = { referral: "Referral bonus", welcome: "Welcome bonus", daily: "Daily bonus" };

const Coupon = ({ c, onClaim, busy }) => (
  <div className={`panel !rounded-3xl p-4 relative overflow-hidden ${c.status === "available" ? "border-white/25" : "opacity-80"}`} data-testid={`coupon-${c.id.slice(0, 8)}`}>
    {c.status === "available" && <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-3xl" />}
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">{KIND[c.kind] || "Bonus"}</div>
        <div className="text-[26px] font-black silver-text leading-tight">{inr(c.amount)}</div>
        <div className="text-[12px] text-neutral-300 truncate">{c.title}</div>
      </div>
      {c.status === "available" ? (
        <button onClick={() => onClaim(c)} disabled={busy} className="silver-btn rounded-full h-10 px-6 font-extrabold text-sm tracking-wide shrink-0" data-testid={`claim-coupon-${c.id.slice(0, 8)}`}>
          {busy ? "…" : "CLAIM"}
        </button>
      ) : <Badge status={c.status} />}
    </div>
    <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[11px]">
      <span className="text-neutral-400"><b className="text-white">{c.wager_multiplier}× wagering</b> · bet {inr(c.amount * c.wager_multiplier)}</span>
      <span className="text-neutral-500">{c.status === "available" ? `Auto-credit ${dt(c.expires_at)}` : dt(c.claimed_at || c.created_at)}</span>
    </div>
  </div>
);

export default function Messages() {
  const [coupons, setCoupons] = useState(null);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => {
    api.get("/coupons").then(({ data }) => setCoupons(data));
    api.get("/notifications").then(({ data }) => setNotes(data));
  };
  useEffect(() => { load(); }, []);
  const claim = async (c) => {
    setBusy(c.id);
    setCoupons((list) => list.map((x) => (x.id === c.id ? { ...x, status: "claimed", claimed_at: new Date().toISOString() } : x)));
    try {
      const { data } = await api.post(`/coupons/${c.id}/claim`);
      toast.success(`${inr(c.amount)} added to wallet. Balance ${inr(data.balance)}`);
    } catch (e) { toast.error(errMsg(e)); load(); } finally { setBusy(null); }
  };
  return (
    <MobileShell title="Messages" testid="messages-page">
      <h3 className="mb-3 font-semibold text-neutral-300">Coupons</h3>
      <div className="space-y-3" data-testid="coupon-list">
        {coupons === null ? <Empty>Loading…</Empty> : coupons.length === 0 && <Empty>No coupons yet. A ₹10 daily bonus arrives every day.</Empty>}
        {(coupons || []).map((c) => <Coupon key={c.id} c={c} onClaim={claim} busy={busy === c.id} />)}
      </div>
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Notifications</h3>
      <div className="space-y-2" data-testid="notification-list">
        {notes === null ? <Empty>Loading…</Empty> : notes.length === 0 && <Empty>No messages</Empty>}
        {(notes || []).map((n) => (
          <div key={n.id} className="panel !rounded-2xl px-4 py-3">
            <div className="flex justify-between"><span className="font-semibold text-sm">{n.title}</span><span className="text-[11px] text-neutral-500">{dt(n.created_at)}</span></div>
            <div className="text-xs text-neutral-400 mt-1">{n.body}</div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
