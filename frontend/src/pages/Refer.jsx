import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Share2 } from "lucide-react";
import { api, inr, dt } from "@/lib/api";
import { MobileShell, Badge, Empty, SilverButton } from "@/components/common";

export default function Refer() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/referrals").then(({ data }) => setD(data)); }, []);
  const link = d ? `${window.location.origin}/register?ref=${d.code}` : "";
  const share = async () => {
    const text = `Join BLACKBA with my code ${d.code}: ${link}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); toast.success("Invite copied"); }
  };
  return (
    <MobileShell title="Refer & Earn" testid="refer-page">
      <div className="panel p-6 text-center rise relative overflow-hidden">
        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="text-neutral-400 text-sm">Earn per friend</div>
        <div className="text-3xl font-black silver-text mt-1">{inr(d?.rules?.bonus)}</div>
        <p className="text-xs text-neutral-400 mt-3 leading-relaxed">
          Your friend signs up with your code and makes a first verified deposit of {inr(d?.rules?.min_deposit)} or more.
          You get a {inr(d?.rules?.bonus)} coupon with a {d?.rules?.wager}× wagering requirement.
        </p>
        <button onClick={() => { navigator.clipboard?.writeText(d.code); toast.success("Code copied"); }}
          className="field mt-5 w-full h-16 flex items-center justify-center gap-3" data-testid="referral-code">
          <span className="mono text-lg tracking-[0.3em] font-bold">{d?.code}</span><Copy size={16} />
        </button>
        <SilverButton className="mt-4 flex items-center justify-center gap-2" onClick={share} data-testid="share-referral-button">
          <Share2 size={18} /> SHARE INVITE
        </SilverButton>
      </div>
      <div className="flex justify-between mt-6 mb-3">
        <h3 className="font-semibold text-neutral-300">Your referrals</h3>
        <span className="text-sm text-neutral-400" data-testid="referral-earned">Earned {inr(d?.rewards_earned)}</span>
      </div>
      <div className="space-y-2" data-testid="referral-list">
        {d?.referrals?.length === 0 && <Empty>No referrals yet</Empty>}
        {d?.referrals?.map((r) => (
          <div key={r.username} className="panel !rounded-2xl px-4 py-3 flex justify-between items-center">
            <div><div className="font-semibold">{r.username}</div><div className="text-[11px] text-neutral-500">{dt(r.created_at)}</div></div>
            <Badge status={r.referral_rewarded ? "completed" : "pending"} />
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
