import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { api, errMsg, inr, dt, blobUrl } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Field, SilverButton, Stat, Badge, Empty, GhostButton } from "@/components/common";
import { Switch } from "@/components/ui/switch";
import { VerifierTickets } from "./VerifierTickets";

function ChangeTemp({ onDone }) {
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const save = async () => {
    try { await api.post("/verifier/auth/change-password", f); toast.success("Password updated"); onDone(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="panel p-6 max-w-md mx-auto space-y-4" data-testid="verifier-change-password">
      <h2 className="font-bold text-lg">Set your own password</h2>
      <p className="text-sm text-neutral-400">You signed in with a temporary password. Change it to continue.</p>
      <Field label="Temporary password" type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} testid="verifier-temp-password-input" />
      <Field label="New password" type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} testid="verifier-new-password-input" />
      <SilverButton onClick={save} data-testid="verifier-change-password-submit">SAVE PASSWORD</SilverButton>
    </div>
  );
}

const AccountCard = ({ a }) => {
  const [qr, setQr] = useState(null);
  useEffect(() => { if (a.has_qr) blobUrl(`/verifier/accounts/${a.id}/qr`).then(setQr).catch(() => {}); }, [a.id, a.has_qr]);
  return (
    <div className="panel !rounded-2xl p-4 flex gap-4" data-testid={`verifier-account-${a.id.slice(0, 8)}`}>
      <div className="w-24 h-24 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center text-[10px] text-neutral-500">
        {qr ? <img src={qr} alt="QR" className="w-full h-full object-contain" /> : "No QR"}
      </div>
      <div className="text-sm space-y-1">
        <div className="font-bold">{a.name} <Badge status={a.status} /></div>
        <div className="mono text-neutral-300">{a.upi_id}</div>
        <div className="text-xs text-neutral-500">Available {inr(a.available_funds)} · Reserved {inr(a.committed)}</div>
      </div>
    </div>
  );
};

function DepositRow({ d, reload }) {
  const act = async (kind) => {
    try {
      if (kind === "verify") await api.post(`/verifier/deposits/${d.id}/verify`);
      else {
        const reason = window.prompt("Reason for rejection");
        if (!reason) return;
        await api.post(`/verifier/deposits/${d.id}/reject`, { reason });
      }
      toast.success(`Deposit ${kind === "verify" ? "verified & credited" : "rejected"}`);
      reload();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <tr className="border-t border-white/5" data-testid={`verifier-deposit-${d.id.slice(0, 8)}`}>
      <td className="py-3 pr-3">{d.username}</td><td className="mono pr-3">{inr(d.amount)}</td><td className="mono pr-3">{d.utr || "—"}</td>
      <td className="pr-3"><Badge status={d.status} /></td><td className="text-xs text-neutral-500 pr-3">{dt(d.created_at)}</td>
      <td className="whitespace-nowrap">
        {d.status === "pending" && (<>
          <button onClick={() => act("verify")} className="silver-btn rounded-full px-3 h-8 text-xs font-bold mr-2" data-testid={`verify-deposit-${d.id.slice(0, 8)}`}>Verify</button>
          <button onClick={() => act("reject")} className="ghost-chip rounded-full px-3 h-8 text-xs" data-testid={`reject-deposit-${d.id.slice(0, 8)}`}>Reject</button>
        </>)}
      </td>
    </tr>
  );
}

function WithdrawalRow({ w, reload }) {
  const call = async (path, body) => {
    try { const { data } = await api.post(`/verifier/withdrawals/${w.id}/${path}`, body); toast.success(data.reassigned === false ? "No other account available; admin notified" : "Updated"); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const sid = w.id.slice(0, 8);
  return (
    <tr className="border-t border-white/5 align-top" data-testid={`verifier-withdrawal-${sid}`}>
      <td className="py-3 pr-3">{w.username}</td><td className="mono pr-3 font-bold">{inr(w.amount)}</td>
      <td className="pr-3 text-xs">
        <div className="mono text-sm text-white" data-testid={`withdrawal-upi-${sid}`}>{w.destination?.upi_id || "—"}</div>
        <div className="text-neutral-500">{w.destination?.holder_name}</div>
      </td>
      <td className="pr-3"><Badge status={w.status} />{w.reference && <div className="text-[10px] mono text-neutral-500 mt-1">{w.reference}</div>}</td>
      <td className="whitespace-nowrap space-x-1.5">
        {w.status === "pending" && <button onClick={() => call("approve")} className="silver-btn rounded-full px-3 h-8 text-xs font-bold" data-testid={`approve-withdrawal-${sid}`}>Approve</button>}
        {w.status === "approved" && <button onClick={() => { const r = window.prompt("Transfer reference / UTR"); r && call("processing", { reference: r }); }} className="silver-btn rounded-full px-3 h-8 text-xs font-bold" data-testid={`processing-withdrawal-${sid}`}>Record transfer</button>}
        {w.status === "processing" && <button onClick={() => window.confirm("Confirm the transfer is verified in your bank statement?") && call("complete")} className="silver-btn rounded-full px-3 h-8 text-xs font-bold" data-testid={`complete-withdrawal-${sid}`}>Mark verified & complete</button>}
        {["pending", "approved"].includes(w.status) && (<>
          <button onClick={() => call("insufficient")} className="ghost-chip rounded-full px-3 h-8 text-xs" data-testid={`insufficient-withdrawal-${sid}`}>Insufficient funds</button>
          <button onClick={() => { const r = window.prompt("Reason for rejection"); r && call("reject", { reason: r }); }} className="ghost-chip rounded-full px-3 h-8 text-xs" data-testid={`reject-withdrawal-${sid}`}>Reject</button>
        </>)}
      </td>
    </tr>
  );
}

const Table = ({ head, children, testid }) => (
  <div className="panel !rounded-2xl p-4 overflow-x-auto admin-scroll" data-testid={testid}>
    <table className="w-full text-sm text-left min-w-[640px]">
      <thead><tr className="text-[11px] uppercase tracking-wider text-neutral-500">{head.map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

export default function VerifierDashboard() {
  const [d, setD] = useState(null);
  const { user, setUser, refresh } = useSession();
  const nav = useNavigate();
  const load = useCallback(() => api.get("/verifier/dashboard").then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  if (user?.must_change_password) return <div className="relative z-10 px-5 py-16"><ChangeTemp onDone={refresh} /></div>;
  if (!d) return <div className="p-10 text-neutral-500">Loading…</div>;
  const s = d.stats;
  const toggle = async (online) => {
    try { await api.post("/verifier/online", { online }); load(); toast.success(online ? "You are ONLINE for new deposits" : "You are OFFLINE. Existing obligations remain."); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const logout = async () => { await api.post("/verifier/auth/logout").catch(() => {}); setUser(false); nav("/verifier/login"); };
  return (
    <div className="relative z-10 max-w-6xl mx-auto px-5 py-8 space-y-6" data-testid="verifier-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-neutral-500 uppercase tracking-[0.2em]">Payment verifier</div>
          <h1 className="text-3xl font-black silver-text">{d.verifier.display_name}</h1>
          <div className="text-xs text-neutral-500 mono">{d.verifier.username} · commission {d.verifier.commission_bps / 100}%</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="panel !rounded-full px-5 h-12 flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${d.verifier.online ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-neutral-600"}`} />
            <span className="text-sm font-semibold" data-testid="verifier-online-status">{d.verifier.online ? "ONLINE" : "OFFLINE"}</span>
            <Switch checked={d.verifier.online} onCheckedChange={toggle} data-testid="verifier-online-toggle" />
          </div>
          <GhostButton onClick={logout} data-testid="verifier-logout-button"><LogOut size={16} /></GhostButton>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Available processing funds" value={inr(s.available_funds)} testid="v-stat-available" />
        <Stat label="Reserved funds" value={inr(s.reserved_funds)} testid="v-stat-reserved" />
        <Stat label="Deposits completed" value={inr(s.deposits_total)} sub={`${s.deposits_count} verified`} testid="v-stat-deposits" />
        <Stat label="Withdrawals completed" value={inr(s.withdrawals_total)} sub={`${s.withdrawals_count} completed`} testid="v-stat-withdrawals" />
        <Stat label="Commission accrued" value={inr(s.accrued)} testid="v-stat-accrued" />
        <Stat label="Commission paid" value={inr(s.paid)} testid="v-stat-paid" />
        <Stat label="Pending commission" value={inr(s.pending)} testid="v-stat-pending" />
        <Stat label="Outstanding withdrawals" value={inr(s.outstanding_withdrawals)} sub={`${s.outstanding_count} open`} testid="v-stat-outstanding" />
      </div>
      <div className="grid md:grid-cols-2 gap-3">{d.accounts.map((a) => <AccountCard key={a.id} a={a} />)}</div>
      <VerifierTickets />
      <h2 className="font-bold text-lg">Deposit requests</h2>
      <Table head={["User", "Amount", "UTR", "Status", "Created", ""]} testid="verifier-deposits-table">
        {d.deposits.filter((x) => x.status !== "initiated").map((x) => <DepositRow key={x.id} d={x} reload={load} />)}
      </Table>
      <h2 className="font-bold text-lg">Withdrawal requests</h2>
      <Table head={["User", "Amount", "UPI ID", "Status", "Actions"]} testid="verifier-withdrawals-table">
        {d.withdrawals.map((x) => <WithdrawalRow key={x.id} w={x} reload={load} />)}
      </Table>
      {d.withdrawals.length === 0 && <Empty>No withdrawals assigned</Empty>}
      <h2 className="font-bold text-lg">Commission ledger</h2>
      <Table head={["Type", "Basis", "Amount", "Date"]} testid="verifier-commission-table">
        {d.commission_ledger.map((c) => (
          <tr key={c.id} className="border-t border-white/5"><td className="py-2.5 capitalize">{c.type}</td><td className="mono">{inr(c.basis_amount)}</td>
            <td className="mono">{inr(c.amount)}</td><td className="text-xs text-neutral-500">{dt(c.created_at)}</td></tr>
        ))}
      </Table>
    </div>
  );
}
