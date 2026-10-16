import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, dt } from "@/lib/api";
import { DataTable, Section, Input, Btn } from "./ui";
import { BackupCodes } from "./AdminLogin";

export default function SecurityTab() {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ password: "", code: "", new_password: "", confirm_code: "" });
  const [codes, setCodes] = useState(null);
  const [rot, setRot] = useState(null);
  const load = () => api.get("/admin/security/overview").then(({ data }) => setD(data));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const call = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } };
  if (!d) return <div className="text-neutral-500">Loading…</div>;
  return (
    <>
      <Section title="Security settings" testid="admin-security">
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="panel !rounded-2xl p-4">MFA<div className="text-lg font-bold" data-testid="mfa-status">{d.mfa_enabled ? "Enabled (TOTP)" : "Not configured"}</div></div>
          <div className="panel !rounded-2xl p-4">Backup codes remaining<div className="text-lg font-bold" data-testid="backup-remaining">{d.backup_codes_remaining}</div></div>
          <div className="panel !rounded-2xl p-4">Active sessions<div className="text-lg font-bold">{d.sessions.length}</div></div>
        </div>
        <div className="panel !rounded-2xl p-5 space-y-3">
          <div className="text-sm text-neutral-400">Re-authenticate for sensitive changes</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Input label="Current password" type="password" value={f.password} onChange={set("password")} testid="sec-password" />
            <Input label="Authenticator code" value={f.code} onChange={set("code")} testid="sec-code" />
            <Input label="New admin password (12+ chars)" type="password" value={f.new_password} onChange={set("new_password")} testid="sec-new-password" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn primary onClick={() => call(() => api.post("/admin/security/change-password", { current_password: f.password, code: f.code, new_password: f.new_password }), "Password changed")} data-testid="sec-change-password">Change password</Btn>
            <Btn onClick={async () => { try { const { data } = await api.post("/admin/security/backup-codes", { password: f.password, code: f.code }); setCodes(data.backup_codes); load(); } catch (e) { toast.error(errMsg(e)); } }} data-testid="sec-regenerate-codes">Regenerate backup codes</Btn>
            <Btn onClick={async () => { try { const { data } = await api.post("/admin/security/mfa/rotate", { password: f.password, code: f.code }); setRot(data); } catch (e) { toast.error(errMsg(e)); } }} data-testid="sec-rotate-mfa">Configure new authenticator</Btn>
            <Btn onClick={() => call(() => api.post("/admin/security/sessions/revoke-others"), "Other sessions revoked")} data-testid="sec-revoke-others">Revoke other sessions</Btn>
          </div>
          {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}
          {rot && (
            <div className="flex flex-wrap gap-4 items-end" data-testid="mfa-rotate-box">
              <img src={rot.qr} alt="New TOTP" className="w-36 h-36 bg-white rounded-lg p-1" />
              <div className="space-y-2">
                <div className="mono text-xs text-neutral-400 break-all">{rot.secret}</div>
                <Input label="Code from new authenticator" value={f.confirm_code} onChange={set("confirm_code")} testid="sec-confirm-code" />
                <Btn primary onClick={() => call(async () => { await api.post("/admin/security/mfa/confirm", { code: f.confirm_code }); setRot(null); }, "Authenticator updated")} data-testid="sec-confirm-mfa">Confirm</Btn>
              </div>
            </div>
          )}
        </div>
      </Section>
      <Section title="Sessions" testid="admin-sessions">
        <DataTable rows={d.sessions} cols={[
          { label: "Created", render: (r) => dt(r.created_at) }, { label: "IP", key: "ip" },
          { label: "Device", render: (r) => <span className="text-[11px] text-neutral-400">{r.ua?.slice(0, 60)}</span> },
          { label: "", render: (r) => r.current ? <span className="text-emerald-400 text-xs">current</span>
            : <Btn onClick={() => call(() => api.post("/admin/security/sessions/revoke", { session_id: r.id }), "Session revoked")} data-testid={`revoke-session-${r.id.slice(0, 6)}`}>Revoke</Btn> },
        ]} />
      </Section>
      <Section title="Login history & suspicious attempts" testid="admin-login-history">
        <DataTable rows={d.login_history} cols={[
          { label: "When", render: (r) => dt(r.created_at) }, { label: "User", key: "username" }, { label: "Stage", render: (r) => r.stage || "password" },
          { label: "Result", render: (r) => <span className={r.success ? "text-emerald-400" : "text-red-400"}>{r.success ? "success" : "FAILED"}</span> },
          { label: "IP", key: "ip" },
        ]} />
      </Section>
    </>
  );
}
