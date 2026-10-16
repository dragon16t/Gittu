import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { Badge } from "@/components/common";
import { DataTable, Section, Btn } from "./ui";

const STATUSES = { deposits: ["", "initiated", "pending", "verified", "rejected"], withdrawals: ["", "pending", "approved", "processing", "completed", "rejected"] };

export default function PaymentsTab() {
  const [kind, setKind] = useState("deposits");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const load = () => api.get(`/admin/${kind}`, { params: { status } }).then(({ data }) => setRows(data));
  useEffect(() => { load(); }, [kind, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (w, path) => {
    try { const { data } = await api.post(`/admin/withdrawals/${w.id}/${path}`); toast.success(data.reassigned === false ? "No eligible account with funds; stays pending" : "Done"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const common = [
    { label: "When", render: (r) => dt(r.created_at) }, { label: "User", key: "username" }, { label: "Amount", render: (r) => <span className="mono">{inr(r.amount)}</span> },
    { label: "Status", render: (r) => <Badge status={r.status} /> },
    { label: "Account", render: (r) => <span className="mono text-[11px]">{r.account_id?.slice(0, 8) || "unassigned"}</span> },
  ];
  const cols = kind === "deposits" ? [...common, { label: "UTR", key: "utr" }, { label: "Verified", render: (r) => dt(r.verified_at) }]
    : [...common, { label: "Reference", key: "reference" }, { label: "Actions", render: (r) => ["pending", "approved"].includes(r.status) && (
      <div className="flex gap-1">
        <Btn onClick={() => act(r, "reassign")} data-testid={`reassign-withdrawal-${r.id.slice(0, 8)}`}>Reassign</Btn>
        <Btn onClick={() => window.confirm("Reject and refund?") && act(r, "reject")} data-testid={`admin-reject-withdrawal-${r.id.slice(0, 8)}`}>Reject</Btn>
      </div>) }];
  return (
    <Section title="Deposits & withdrawals" testid="admin-payments"
      actions={<>
        {["deposits", "withdrawals"].map((k) => <Btn key={k} primary={kind === k} onClick={() => { setKind(k); setStatus(""); }} data-testid={`payments-kind-${k}`}>{k}</Btn>)}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 px-3 rounded-full bg-black border border-white/15 text-xs" data-testid="payments-status-filter">
          {STATUSES[kind].map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
        </select>
      </>}>
      <DataTable rows={rows} cols={cols} />
    </Section>
  );
}
