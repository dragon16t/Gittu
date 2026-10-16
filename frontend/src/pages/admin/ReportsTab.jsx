import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { DataTable, Section, Input, Select, Btn } from "./ui";

export default function ReportsTab() {
  const [f, setF] = useState({ start: "", end: "", user: "", type: "", status: "", verifier: "", account: "", round: "" });
  const [data, setData] = useState({ rows: [], count: 0, total_amount: 0 });
  const [verifiers, setVerifiers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [recon, setRecon] = useState(null);
  const run = () => api.get("/admin/reports", { params: f }).then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    run();
    api.get("/admin/verifiers").then(({ data }) => setVerifiers(data));
    api.get("/admin/accounts").then(({ data }) => setAccounts(data));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exportCsv = async () => {
    try {
      const r = await api.get("/admin/reports/export", { params: f, responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.data);
      a.download = `report-${f.type || "ledger"}.csv`;
      a.click();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cols = Object.keys(data.rows[0] || {}).filter((k) => !["meta", "totals", "user_id", "client_key"].includes(k)).slice(0, 9).map((k) => ({
    label: k, render: (r) => (["amount", "payout", "net", "balance_after"].includes(k) ? inr(r[k]) : k.endsWith("_at") ? dt(r[k]) : String(r[k] ?? "—").slice(0, 24)),
  }));
  return (
    <>
      <Section title="Financial reports" testid="admin-reports"
        actions={<><Btn primary onClick={run} data-testid="run-report-button">Run report</Btn><Btn onClick={exportCsv} data-testid="export-report-button">Export CSV</Btn></>}>
        <div className="panel !rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input label="From" type="date" value={f.start} onChange={set("start")} testid="report-start" />
          <Input label="To" type="date" value={f.end} onChange={set("end")} testid="report-end" />
          <Input label="User (username or ID)" value={f.user} onChange={set("user")} testid="report-user" />
          <Select label="Transaction type" value={f.type} onChange={set("type")} testid="report-type" options={[["", "Wallet ledger"], ["deposits", "Deposits"], ["withdrawals", "Withdrawals"], ["bets", "Bets"]]} />
          <Input label="Status / ledger type" value={f.status} onChange={set("status")} placeholder="e.g. verified, bet_win" testid="report-status" />
          <Select label="Verifier" value={f.verifier} onChange={set("verifier")} testid="report-verifier" options={[["", "Any"], ...verifiers.map((v) => [v.id, v.display_name])]} />
          <Select label="Payment account" value={f.account} onChange={set("account")} testid="report-account" options={[["", "Any"], ...accounts.map((a) => [a.id, a.name])]} />
          <Input label="Game round #" value={f.round} onChange={set("round")} testid="report-round" />
        </div>
        <div className="text-sm text-neutral-400" data-testid="report-summary">{data.count} rows · total {inr(data.total_amount)}</div>
        <DataTable rows={data.rows.slice(0, 300)} cols={cols.length ? cols : [{ label: "No data", render: () => "" }]} minW={1000} />
      </Section>
      <Section title="Financial reconciliation" testid="admin-reconcile"
        actions={<Btn primary onClick={() => api.get("/admin/reconcile").then(({ data }) => setRecon(data))} data-testid="run-reconcile-button">Reconcile wallets vs ledger</Btn>}>
        {recon && (recon.discrepancies.length === 0
          ? <div className="text-emerald-400 text-sm" data-testid="reconcile-ok">All wallets match the ledger · {dt(recon.checked_at)}</div>
          : <DataTable rows={recon.discrepancies} cols={[{ label: "User", key: "user_id" }, { label: "Wallet", render: (r) => inr(r.wallet_balance) },
            { label: "Ledger", render: (r) => inr(r.ledger_balance) }, { label: "Reserved (w/l)", render: (r) => `${inr(r.wallet_reserved)} / ${inr(r.ledger_reserved)}` }]} />)}
      </Section>
    </>
  );
}
