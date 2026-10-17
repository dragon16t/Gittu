import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, inr, dt } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthCard, Field, SilverButton, Badge, Empty } from "@/components/common";

export function PartnerLogin() {
  const [f, setF] = useState({ username: "", password: "" });
  const { setUser } = useSession();
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    try { const { data } = await api.post("/partner/auth/login", f); setUser(data.user); nav("/partner"); } catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <AuthCard testid="partner-login-page" title="Partner Login" subtitle="Franchisee partner portal">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" testid="partner-username-input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <Field label="Password" type="password" testid="partner-password-input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <SilverButton type="submit" data-testid="partner-login-button">LOGIN</SilverButton>
      </form>
    </AuthCard>
  );
}

export function PartnerSetup() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState({ a: "", b: "" });
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return toast.error("Passwords do not match");
    try { await api.post("/partner/auth/setup", { token: params.get("token") || "", password: pw.a }); toast.success("Password set. Please log in."); nav("/partner/login"); }
    catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <AuthCard testid="partner-setup-page" title="Set your password" subtitle="This one-time link expires in 72 hours">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password (min 8 characters)" type="password" testid="partner-setup-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required />
        <Field label="Confirm password" type="password" testid="partner-setup-confirm" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required />
        <SilverButton type="submit" data-testid="partner-setup-button">SET PASSWORD</SilverButton>
      </form>
    </AuthCard>
  );
}

const Card = ({ label, value, testid }) => (
  <div className="panel !rounded-2xl p-4" data-testid={testid}><div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div><div className="text-xl font-black mt-1">{value}</div></div>
);
const Table = ({ cols, rows, testid }) => (
  <div className="panel !rounded-2xl overflow-x-auto" data-testid={testid}>
    {rows.length === 0 ? <div className="p-4"><Empty>No records</Empty></div> : (
      <table className="w-full text-xs min-w-[640px]"><thead><tr className="text-neutral-500 text-left">{cols.map((c) => <th key={c[0]} className="px-3 py-2 font-medium">{c[0]}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id || i} className="border-t border-white/5">{cols.map((c) => <td key={c[0]} className="px-3 py-2 align-top">{c[1](r)}</td>)}</tr>)}</tbody></table>)}
  </div>
);
const TABS = ["overview", "users", "statements", "withdrawals", "settings"];

export function PartnerDashboard() {
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [d, setD] = useState(null);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [ledger, setLedger] = useState([]);
  const [wds, setWds] = useState([]);
  const [sess, setSess] = useState([]);
  const [amt, setAmt] = useState("");
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const load = () => {
    api.get("/partner/dashboard").then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e)));
    api.get("/partner/ledger").then(({ data }) => setLedger(data)).catch(() => {});
    api.get("/partner/withdrawals").then(({ data }) => setWds(data)).catch(() => {});
    api.get("/partner/sessions").then(({ data }) => setSess(data)).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => { api.get("/partner/users", { params: { q } }).then(({ data }) => setUsers(data)).catch(() => {}); }, [q]);
  const s = d?.stats || {};
  const link = d ? `${window.location.origin}/register?p=${d.partner.partner_code}` : "";
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } };
  const logout = async () => { await api.post("/partner/auth/logout").catch(() => {}); setUser(false); nav("/partner/login"); };
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-5" data-testid="partner-dashboard">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black silver-text">Partner Dashboard</h1><div className="text-xs text-neutral-500">{d?.partner.name} · ID {d?.partner.partner_code}</div></div>
        <button onClick={logout} className="ghost-chip rounded-full h-9 px-4 text-xs" data-testid="partner-logout-button">Logout</button>
      </div>
      <div className="flex gap-2 overflow-x-auto">{TABS.map((t) => <button key={t} onClick={() => setTab(t)} data-testid={`partner-tab-${t}`} className={`h-9 px-4 rounded-full text-xs font-semibold capitalize ${tab === t ? "silver-btn" : "ghost-chip text-neutral-300"}`}>{t}</button>)}</div>
      {tab === "overview" && <>
        <div className="panel !rounded-2xl p-4 flex flex-wrap items-center gap-3" data-testid="partner-referral-link">
          <div className="flex-1 min-w-0"><div className="text-[11px] uppercase tracking-wider text-neutral-500">Your referral link</div><div className="mono text-sm truncate">{link}</div></div>
          <button onClick={() => { navigator.clipboard?.writeText(link); toast.success("Link copied"); }} className="silver-btn rounded-full h-9 px-4 text-xs font-bold" data-testid="partner-copy-link">Copy Link</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Registered users" value={s.registered_users ?? "—"} testid="pstat-registered" />
          <Card label="Verified depositors" value={s.verified_users ?? "—"} testid="pstat-verified" />
          <Card label="Active users (30 days)" value={s.active_users_30d ?? "—"} testid="pstat-active" />
          <Card label="Referral rewards" value={inr(s.referral_rewards)} testid="pstat-rewards" />
          <Card label="Approved commissions" value={inr(s.commissions)} testid="pstat-commissions" />
          <Card label="Total earnings" value={inr(s.total_earnings)} testid="pstat-earnings" />
          <Card label="Available balance" value={inr(s.available)} testid="pstat-available" />
          <Card label="Pending earnings" value={inr(s.pending_earnings)} testid="pstat-pending" />
          <Card label="Pending withdrawals" value={inr(s.pending_withdrawals)} testid="pstat-pending-wd" />
          <Card label="Withdrawals completed" value={inr(s.withdrawn)} testid="pstat-withdrawn" />
        </div>
        <p className="text-[11px] text-neutral-500">Commission plans are disabled until approved for your jurisdiction. Balances come from the audited partner ledger and are not proof of settlement.</p>
      </>}
      {tab === "users" && <>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by user ID" className="w-full h-11 rounded-xl bg-white/5 border border-white/10 px-4 text-sm" data-testid="partner-users-search" />
        <Table testid="partner-users-table" rows={users} cols={[["User ID", (r) => <span className="mono">{r.user_id}</span>], ["Registered", (r) => dt(r.registered_at)], ["Registration", (r) => r.registration],
          ["Deposit verified", (r) => (r.deposit_verified ? "Yes" : "No")], ["Reward", (r) => r.reward_status], ["Partner ID", (r) => r.partner_id]]} />
      </>}
      {tab === "statements" && <Table testid="partner-ledger-table" rows={ledger} cols={[["Txn ID", (r) => <span className="mono">{r.id.slice(0, 10)}</span>], ["Type", (r) => r.type.replace(/_/g, " ")],
        ["Amount", (r) => <b className={r.amount < 0 ? "text-red-300" : "text-emerald-300"}>{inr(r.amount)} {r.currency}</b>], ["Created", (r) => dt(r.created_at)], ["Status", (r) => r.status],
        ["Reference", (r) => <span className="mono">{(r.ref || "—").slice(0, 10)}</span>], ["Reason", (r) => r.reason || "—"]]} />}
      {tab === "withdrawals" && <>
        <div className="panel !rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]"><div className="text-xs text-neutral-400 mb-1">Amount (₹) · available {inr(s.available)} · payout {d?.partner.payout_method} {d?.partner.payout_masked}</div>
            <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} className="w-full h-11 rounded-xl bg-white/5 border border-white/10 px-4 text-sm" data-testid="partner-wd-amount" /></div>
          <button onClick={() => act(() => api.post("/partner/withdrawals", { amount: Math.round(Number(amt) * 100) }), "Withdrawal requested")} className="silver-btn rounded-full h-11 px-5 text-sm font-bold" data-testid="partner-wd-submit">Request withdrawal</button>
        </div>
        <Table testid="partner-wd-table" rows={wds} cols={[["Reference", (r) => <span className="mono">{r.reference}</span>], ["Amount", (r) => inr(r.amount)], ["Method", (r) => `${r.method} ${r.destination_masked}`],
          ["Requested", (r) => dt(r.created_at)], ["Status", (r) => <Badge status={r.status} />], ["Processed", (r) => (r.processed_at ? dt(r.processed_at) : "—")],
          ["Txn ref", (r) => r.txn_ref || "—"], ["Reason", (r) => r.reason || "—"],
          ["", (r) => (r.status === "requested" ? <button onClick={() => act(() => api.post(`/partner/withdrawals/${r.id}/cancel`), "Cancelled")} className="text-red-300" data-testid={`partner-wd-cancel-${r.reference}`}>Cancel</button> : null)]]} />
      </>}
      {tab === "settings" && <div className="grid md:grid-cols-2 gap-4">
        <div className="panel !rounded-2xl p-4 text-sm space-y-1.5" data-testid="partner-profile">
          {[["Name", d?.partner.name], ["Partner ID", d?.partner.partner_code], ["Username", user?.username], ["Email", d?.partner.email], ["Phone", d?.partner.phone || "—"],
            ["Status", d?.partner.status], ["Payout account", `${d?.partner.payout_method || ""} ${d?.partner.payout_masked || ""}`]].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-neutral-500">{k}</span><span>{v}</span></div>)}
          <p className="text-[11px] text-neutral-500 pt-2">Two-factor login for partners is not available yet. Ask the admin to change payout details.</p>
        </div>
        <div className="panel !rounded-2xl p-4 space-y-3">
          <div className="font-semibold text-sm">Change password</div>
          <Field label="Current password" type="password" testid="partner-current-pw" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          <Field label="New password" type="password" testid="partner-new-pw" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <SilverButton onClick={() => act(() => api.post("/partner/auth/password", pw), "Password changed. Other sessions logged out.")} data-testid="partner-change-pw">UPDATE PASSWORD</SilverButton>
        </div>
        <div className="md:col-span-2 space-y-2">
          <div className="flex justify-between items-center"><div className="font-semibold text-sm">Sessions &amp; login history</div>
            <button onClick={() => act(() => api.post("/partner/sessions/revoke-others"), "Other sessions logged out")} className="ghost-chip rounded-full h-8 px-3 text-xs" data-testid="partner-revoke-sessions">Log out other sessions</button></div>
          <Table testid="partner-sessions-table" rows={sess} cols={[["When", (r) => dt(r.created_at)], ["IP", (r) => r.ip], ["Device", (r) => <span className="truncate block max-w-[260px]">{r.ua}</span>], ["Status", (r) => (r.current ? "This device" : r.revoked ? "Logged out" : "Active")]]} />
        </div>
      </div>}
      <div className="text-center text-[11px] text-neutral-600"><Link to="/partner/login">Partner portal</Link></div>
    </div>
  );
}
