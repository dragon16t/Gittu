import { useEffect, useState } from "react";
import { ShieldCheck, Clock, ShieldAlert } from "lucide-react";
import { api, dt } from "@/lib/api";
import { MobileShell } from "@/components/common";
import { KycForm } from "@/components/kyc/KycForm";
import { PayoutAccounts } from "@/components/kyc/PayoutAccounts";

const STATE = {
  verified: [ShieldCheck, "Aadhaar verified", "text-emerald-300 border-emerald-400/40"],
  pending: [Clock, "Under review", "text-amber-300 border-amber-400/40"],
  rejected: [ShieldAlert, "Rejected — please resubmit", "text-red-300 border-red-400/40"],
};

const StatusCard = ({ k }) => {
  const [Icon, label, cls] = STATE[k.status];
  return (
    <div className={`panel p-5 border ${cls} rise`} data-testid="kyc-status-card">
      <div className="flex items-center gap-2 font-bold" data-testid="kyc-status"><Icon size={18} />{label}</div>
      <div className="mt-3 text-sm text-neutral-300 space-y-1">
        <div>{k.aadhaar_name} · <span className="mono">{k.aadhaar_masked}</span></div>
        {k.pan_masked && <div>PAN <span className="mono">{k.pan_masked}</span> · {k.pan_name}</div>}
        <div className="text-[11px] text-neutral-500">Submitted {dt(k.submitted_at)}</div>
        {k.reject_reason && <div className="text-xs text-red-300" data-testid="kyc-reject-reason">Reason: {k.reject_reason}</div>}
      </div>
    </div>
  );
};

export default function Kyc() {
  const [k, setK] = useState(null);
  const load = () => api.get("/kyc").then(({ data }) => setK(data));
  useEffect(() => { load(); }, []);
  if (!k) return <MobileShell title="KYC & Accounts" testid="kyc-page" />;
  const showForm = k.status === "none" || k.status === "rejected";
  return (
    <MobileShell title="KYC & Accounts" testid="kyc-page" back="/withdraw">
      <div className="space-y-5">
        {k.status !== "none" && <StatusCard k={k} />}
        {k.status === "none" && <p className="text-sm text-neutral-400">Verify your identity with Aadhaar to unlock withdrawals. Accounts you add must be in your own name.</p>}
        {showForm && <KycForm onDone={load} />}
        <PayoutAccounts accounts={k.accounts} max={k.max_accounts} canAdd={["pending", "verified"].includes(k.status)} reload={load} />
      </div>
    </MobileShell>
  );
}
