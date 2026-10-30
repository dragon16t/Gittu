import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, dt, blobUrl } from "@/lib/api";
import { Badge } from "@/components/common";
import { Section, Btn } from "./ui";

const DocImg = ({ userId, kind }) => {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let u;
    blobUrl(`/admin/kyc/${userId}/file/${kind}`).then((x) => { u = x; setSrc(x); }).catch(() => setSrc(""));
    return () => u && URL.revokeObjectURL(u);
  }, [userId, kind]);
  if (src === "") return <div className="text-[11px] text-neutral-600">{kind} unavailable</div>;
  return src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={kind} className="h-28 w-44 object-cover rounded-lg border border-white/10" data-testid={`kyc-doc-${kind}`} /></a>
    : <div className="h-28 w-44 rounded-lg bg-white/5 animate-pulse" />;
};

const decide = async (url, approve, done) => {
  const reason = approve ? "" : window.prompt("Reason for rejection");
  if (!approve && !reason) return;
  try { await api.post(url, { approve, reason }); toast.success(approve ? "Approved" : "Rejected"); done(); } catch (e) { toast.error(errMsg(e)); }
};

const AccountLine = ({ a, done }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs border-t border-white/5 pt-2" data-testid={`admin-account-${a.id.slice(0, 8)}`}>
    <span className="uppercase text-neutral-500 w-10">{a.kind}</span>
    <span className="mono">{a.kind === "bank" ? `${a.account_number} · ${a.ifsc}` : a.upi_id}</span>
    <span className="text-neutral-400">{a.holder_name}</span><Badge status={a.status} />
    {a.status === "pending" && (<>
      <Btn primary onClick={() => decide(`/admin/payout-accounts/${a.id}/decision`, true, done)} data-testid={`approve-account-${a.id.slice(0, 8)}`}>Approve</Btn>
      <Btn onClick={() => decide(`/admin/payout-accounts/${a.id}/decision`, false, done)} data-testid={`reject-account-${a.id.slice(0, 8)}`}>Reject</Btn>
    </>)}
  </div>
);

const KycCard = ({ k, done }) => (
  <div className="panel !rounded-2xl p-4 space-y-3" data-testid={`kyc-card-${k.user_id.slice(0, 8)}`}>
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-bold">{k.username}</span><Badge status={k.status} />
      <span className="text-[11px] text-neutral-500">Submitted {dt(k.submitted_at)} {k.reviewed_by ? `· by ${k.reviewed_by}` : ""}</span>
    </div>
    <div className="grid sm:grid-cols-2 gap-2 text-xs">
      <div>Aadhaar name: <b>{k.aadhaar_name}</b></div><div>Aadhaar: <span className="mono" data-testid="kyc-full-aadhaar">{k.aadhaar_number}</span></div>
      {k.pan_number && <><div>PAN name: <b>{k.pan_name}</b></div><div>PAN: <span className="mono">{k.pan_number}</span></div></>}
    </div>
    <div className="flex flex-wrap gap-2">
      <DocImg userId={k.user_id} kind="aadhaar_front" /><DocImg userId={k.user_id} kind="aadhaar_back" />
      {k.has_pan && <DocImg userId={k.user_id} kind="pan" />}
    </div>
    {k.accounts.map((a) => <AccountLine key={a.id} a={a} done={done} />)}
    {k.status !== "rejected" && (
      <div className="flex gap-2">
        {k.status === "pending" && <Btn primary onClick={() => decide(`/admin/kyc/${k.user_id}/decision`, true, done)} data-testid={`approve-kyc-${k.user_id.slice(0, 8)}`}>Verify Aadhaar</Btn>}
        <Btn onClick={() => decide(`/admin/kyc/${k.user_id}/decision`, false, done)} data-testid={`reject-kyc-${k.user_id.slice(0, 8)}`}>{k.status === "verified" ? "Revoke" : "Reject"}</Btn>
      </div>
    )}
  </div>
);

export default function KycTab() {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const load = () => api.get("/admin/kyc", { params: { status } }).then(({ data }) => setRows(data));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title="KYC verification" testid="admin-kyc"
      actions={["pending", "verified", "rejected", ""].map((s) => (
        <Btn key={s || "all"} primary={status === s} onClick={() => setStatus(s)} data-testid={`kyc-filter-${s || "all"}`}>{s || "all"}</Btn>))}>
      <div className="space-y-3">
        {rows.length === 0 && <div className="text-neutral-500 text-sm" data-testid="kyc-empty">No KYC submissions</div>}
        {rows.map((k) => <KycCard key={k.user_id} k={k} done={load} />)}
      </div>
    </Section>
  );
}
