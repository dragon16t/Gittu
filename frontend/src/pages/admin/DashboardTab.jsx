import { useEffect, useState } from "react";
import { api, inr, dt } from "@/lib/api";
import { Stat } from "@/components/common";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";
import { useBrand, setBrand } from "@/lib/brand";
import { DataTable, Section, Btn } from "./ui";
import LiveVisitors from "./LiveVisitors";

function BrandEditor() {
  const brand = useBrand();
  const [v, setV] = useState(brand);
  useEffect(() => setV(brand), [brand]);
  const save = async () => {
    try {
      const { data } = await api.put("/admin/branding", { name: v });
      setBrand(data.name);
      toast.success(`Platform name updated to ${data.name}`);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="panel !rounded-2xl p-4 flex flex-wrap items-end gap-3" data-testid="platform-name-editor">
      <label className="flex-1 min-w-[200px]">
        <span className="block text-xs text-neutral-400 mb-1">Platform name (shown on login, user app and admin panel)</span>
        <input value={v} onChange={(e) => setV(e.target.value)} maxLength={24} data-testid="platform-name-input"
          className="w-full h-10 px-3 rounded-lg bg-black border border-white/15 focus:border-white/50 outline-none text-sm font-semibold tracking-wider" />
      </label>
      <Btn primary className="h-10" onClick={save} disabled={!v.trim() || v.trim() === brand} data-testid="platform-name-save">Update name</Btn>
    </div>
  );
}

export default function DashboardTab() {
  const [d, setD] = useState(null);
  const [v, setV] = useState([]);
  const load = () => {
    api.get("/admin/dashboard").then(({ data }) => setD(data));
    api.get("/admin/verifiers").then(({ data }) => setV(data));
  };
  useEffect(() => { load(); }, []);
  if (!d) return <div className="text-neutral-500">Loading…</div>;
  const resolve = async (id) => { await api.post(`/admin/alerts/${id}/resolve`); load(); };
  const stats = [
    ["Total verified deposits", d.total_deposits], ["Total completed withdrawals", d.total_withdrawals],
    ["Pending deposits", d.pending_deposits], ["Pending withdrawals", d.pending_withdrawals],
    ["User wallet liabilities", d.wallet_liabilities], ["Total stakes", d.total_stakes], ["Total payouts", d.total_payouts],
    ["Gross gaming revenue", d.ggr], ["Company net result", d.company_net], ["Commission accrued", d.commission_accrued],
    ["Commission paid", d.commission_paid], ["Promotional expenditure", d.promo_expenditure],
  ];
  return (
    <>
      <BrandEditor />
      <LiveVisitors />
      <Section title="Financial overview" testid="admin-financial-overview"
        actions={<span className="text-xs text-neutral-500">{d.users} users · {d.discrepancies} ledger discrepancies</span>}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {stats.map(([l, val]) => <Stat key={l} label={l} value={inr(val)} testid={`admin-stat-${l.toLowerCase().replace(/\s+/g, "-")}`} />)}
          <Stat label="Outstanding discrepancies" value={d.discrepancies} testid="admin-stat-discrepancies" />
        </div>
      </Section>
      <Section title="Risk & operational alerts" testid="admin-alerts">
        <DataTable rows={d.alerts} empty="No open alerts" cols={[
          { label: "Type", key: "kind" }, { label: "Message", key: "message" },
          { label: "When", render: (r) => dt(r.created_at) },
          { label: "", render: (r) => <Btn onClick={() => resolve(r.id)} data-testid={`resolve-alert-${r.id.slice(0, 8)}`}>Resolve</Btn> },
        ]} />
      </Section>
      <Section title="Payment-account balances" testid="admin-account-balances">
        <DataTable rows={d.accounts} cols={[
          { label: "Account", key: "name" }, { label: "UPI", key: "upi_id" },
          { label: "Available", render: (r) => inr(r.available_funds) }, { label: "Committed to withdrawals", render: (r) => inr(r.committed) },
          { label: "Status", key: "status" },
        ]} />
      </Section>
      <Section title="Staff monitoring" testid="admin-staff-monitoring">
        <DataTable rows={v} cols={[
          { label: "Verifier", render: (r) => <><div className="font-semibold">{r.display_name}</div><div className="text-[11px] mono text-neutral-500">{r.username}</div></> },
          { label: "Status", render: (r) => <span className={r.online ? "text-emerald-400" : "text-neutral-500"}>{r.online ? "Online" : "Offline"}</span> },
          { label: "Assigned account", render: (r) => r.accounts.map((a) => a.name).join(", ") || "—" },
          { label: "Deposit workload", key: "deposit_workload" },
          { label: "Withdrawal workload", render: (r) => r.summary.outstanding_count },
          { label: "Outstanding obligations", render: (r) => inr(r.summary.outstanding_withdrawals) },
          { label: "Capacity", render: (r) => `${r.deposit_capacity} deposits` },
          { label: "Commission accrued", render: (r) => inr(r.summary.accrued) },
          { label: "Commission paid", render: (r) => inr(r.summary.paid) },
        ]} minW={1000} />
      </Section>
    </>
  );
}
