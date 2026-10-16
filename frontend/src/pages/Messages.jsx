import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { api, errMsg, inr, dt } from "@/lib/api";
import { MobileShell, Badge, Empty } from "@/components/common";

const Coupon = ({ c, onClaim }) => (
  <div className="panel !rounded-3xl p-5 flex items-center gap-4" data-testid={`coupon-${c.id.slice(0, 8)}`}>
    <div className="h-12 w-12 shrink-0 rounded-full silver-btn flex items-center justify-center"><Ticket size={20} /></div>
    <div className="flex-1 min-w-0">
      <div className="font-bold">{c.title}</div>
      <div className="text-xs text-neutral-400">{inr(c.amount)} bonus · {c.wager_multiplier}× wagering ({inr(c.amount * c.wager_multiplier)} in bets)</div>
      <div className="text-[11px] text-neutral-500">
        {c.status === "available" ? `Auto-credited if unclaimed by ${dt(c.expires_at)}` : dt(c.claimed_at || c.created_at)}
      </div>
    </div>
    {c.status === "available" ? (
      <button onClick={() => onClaim(c)} className="silver-btn rounded-full h-10 px-5 font-bold text-sm" data-testid={`claim-coupon-${c.id.slice(0, 8)}`}>Claim</button>
    ) : <Badge status={c.status} />}
  </div>
);

export default function Messages() {
  const [coupons, setCoupons] = useState([]);
  const [notes, setNotes] = useState([]);
  const load = () => {
    api.get("/coupons").then(({ data }) => setCoupons(data));
    api.get("/notifications").then(({ data }) => setNotes(data));
  };
  useEffect(() => { load(); }, []);
  const claim = async (c) => {
    try {
      const { data } = await api.post(`/coupons/${c.id}/claim`);
      toast.success(`${inr(c.amount)} added to wallet. Balance ${inr(data.balance)}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <MobileShell title="Messages" testid="messages-page">
      <h3 className="mb-3 font-semibold text-neutral-300">Coupons</h3>
      <div className="space-y-3" data-testid="coupon-list">
        {coupons.length === 0 && <Empty>No coupons yet. A ₹10 daily bonus arrives every day.</Empty>}
        {coupons.map((c) => <Coupon key={c.id} c={c} onClaim={claim} />)}
      </div>
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Notifications</h3>
      <div className="space-y-2" data-testid="notification-list">
        {notes.length === 0 && <Empty>No messages</Empty>}
        {notes.map((n) => (
          <div key={n.id} className="panel !rounded-2xl px-4 py-3">
            <div className="flex justify-between"><span className="font-semibold text-sm">{n.title}</span><span className="text-[11px] text-neutral-500">{dt(n.created_at)}</span></div>
            <div className="text-xs text-neutral-400 mt-1">{n.body}</div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
