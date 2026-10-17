import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Share2 } from "lucide-react";
import { api, inr0, dt } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { MobileShell, Badge, Empty, SilverButton } from "@/components/common";

const Split = ({ who, amount, testid }) => (
  <div className="flex-1 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-transparent px-3 py-4" data-testid={testid}>
    <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">{who}</div>
    <div className="text-[28px] leading-none font-black silver-text mt-2">{inr0(amount)}</div>
    <div className="text-[10px] text-neutral-500 mt-1.5">bonus coupon</div>
  </div>
);

const Step = ({ n, title, text }) => (
  <div className="flex gap-3">
    <span className="h-6 w-6 shrink-0 rounded-full border border-[#d4af37]/60 text-[11px] font-bold gold-text flex items-center justify-center">{n}</span>
    <div><div className="text-[13px] font-semibold text-white">{title}</div><div className="text-[11px] text-neutral-400 leading-relaxed">{text}</div></div>
  </div>
);

const WagerRow = ({ label, amount, mult, testid }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0" data-testid={testid}>
    <div><div className="text-[13px] font-semibold text-white">{label}</div>
      <div className="text-[11px] text-neutral-500">{amount ? `Bet ${inr0(amount * mult)} in total before withdrawing` : "Bet the deposited amount once"}</div></div>
    <span className="mono text-sm font-extrabold silver-text px-2.5 py-1 rounded-full border border-white/15 bg-white/5">{mult}×</span>
  </div>
);

export default function Refer() {
  const [d, setD] = useState(null);
  const brand = useBrand();
  useEffect(() => { api.get("/referrals").then(({ data }) => setD(data)); }, []);
  const r = d?.rules || {};
  const link = d ? `${window.location.origin}/register?ref=${d.code}` : "";
  const share = async () => {
    const text = `Join ${brand} with my code ${d.code} and get a ${inr0(r.friend_bonus)} welcome bonus on your first deposit of ${inr0(r.min_deposit)}: ${link}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); toast.success("Invite copied"); }
  };
  return (
    <MobileShell title="Refer & Earn" testid="refer-page">
      <div className="panel p-5 rise relative overflow-hidden" data-testid="refer-hero">
        <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#d4af37]/10 blur-3xl" />
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.35em] gold-text font-bold">Refer &amp; Earn</div>
          <h2 className="text-2xl font-black gold-text mt-1 leading-tight" data-testid="refer-headline">Both of you get paid</h2>
          <p className="text-[12px] text-neutral-300 mt-2 leading-relaxed">
            When your friend makes a <b className="text-white">first deposit of {inr0(r.min_deposit)} or more</b>, you get {inr0(r.bonus)} and your friend gets {inr0(r.friend_bonus)}.
          </p>
        </div>
        <div className="flex gap-2.5 mt-4 text-center">
          <Split who="You get" amount={r.bonus} testid="refer-you-get" />
          <Split who="Friend gets" amount={r.friend_bonus} testid="refer-friend-gets" />
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(d.code); toast.success("Code copied"); }}
          className="mt-4 w-full h-14 rounded-2xl border border-dashed border-[#d4af37]/50 bg-black/60 flex items-center justify-center gap-3" data-testid="referral-code">
          <span className="mono text-lg tracking-[0.3em] font-bold text-white">{d?.code}</span><Copy size={15} className="text-neutral-400" />
        </button>
        <SilverButton className="mt-3 flex items-center justify-center gap-2" onClick={share} data-testid="share-referral-button">
          <Share2 size={17} /> SHARE INVITE
        </SilverButton>
      </div>

      <div className="panel !rounded-3xl p-5 mt-4 space-y-3.5" data-testid="refer-steps">
        <div className="text-[11px] uppercase tracking-[0.25em] gold-text font-bold">How it works</div>
        <Step n="1" title="Share your code" text="Send your invite link or code to a friend." />
        <Step n="2" title="Friend signs up" text="They register with your referral code." />
        <Step n="3" title="First deposit" text={`Their very first verified deposit is ${inr0(r.min_deposit)} or more. Later deposits do not count.`} />
        <Step n="4" title="Claim your coupons" text="Both coupons arrive in Messages. Tap Claim, or they are credited automatically after 72 hours." />
      </div>

      <div className="panel !rounded-3xl p-5 mt-4" data-testid="refer-wagering">
        <div className="flex items-baseline justify-between">
          <div className="text-[13px] font-bold text-white">Wagering requirements</div>
          <div className="text-[10px] text-neutral-500">before you can withdraw</div>
        </div>
        <div className="mt-2">
          <WagerRow label={`Referral bonus · ${inr0(r.bonus)}`} amount={r.bonus} mult={r.wager} testid="wager-referral" />
          <WagerRow label={`Friend welcome bonus · ${inr0(r.friend_bonus)}`} amount={r.friend_bonus} mult={r.wager} testid="wager-welcome" />
          <WagerRow label={`Daily bonus · ${inr0(r.daily_bonus)}`} amount={r.daily_bonus} mult={r.daily_wager} testid="wager-daily" />
          <WagerRow label="Deposits" mult={r.deposit_wager} testid="wager-deposit" />
        </div>
      </div>

      <div className="flex justify-between items-baseline mt-6 mb-3">
        <h3 className="font-semibold text-neutral-200">Your referrals</h3>
        <span className="text-sm" data-testid="referral-earned"><span className="text-neutral-500">Earned </span><b className="silver-text">{inr0(d?.rewards_earned)}</b></span>
      </div>
      <div className="space-y-2" data-testid="referral-list">
        {d?.referrals?.length === 0 && <Empty>No referrals yet</Empty>}
        {d?.referrals?.map((x) => (
          <div key={x.username} className="panel !rounded-2xl px-4 py-3 flex justify-between items-center">
            <div><div className="font-semibold">{x.username}</div><div className="text-[11px] text-neutral-500">{dt(x.created_at)}</div></div>
            <Badge status={x.referral_rewarded ? "completed" : "pending"} />
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
