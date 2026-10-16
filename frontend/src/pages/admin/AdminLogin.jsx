import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthCard, Field, SilverButton } from "@/components/common";

export const BackupCodes = ({ codes, onDone }) => (
  <div className="space-y-4" data-testid="backup-codes-box">
    <p className="text-sm text-neutral-300">Store these backup codes offline. Each works once and they will not be shown again.</p>
    <div className="grid grid-cols-2 gap-2 mono text-sm">
      {codes.map((c) => <div key={c} className="field px-3 py-2 text-center" data-testid="backup-code">{c}</div>)}
    </div>
    <SilverButton onClick={onDone} data-testid="backup-codes-done">I STORED THEM</SilverButton>
  </div>
);

export default function AdminLogin() {
  const [f, setF] = useState({ username: "", password: "" });
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const { setUser } = useSession();
  const nav = useNavigate();

  const login = async (e) => {
    e.preventDefault();
    try { const { data } = await api.post("/admin/auth/login", f); setMfa(data); }
    catch (err) { toast.error(errMsg(err)); }
  };
  const verify = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/admin/auth/mfa", { mfa_token: mfa.mfa_token, code });
      if (data.backup_codes) { setCodes(data.backup_codes); setUser(data.user); return; }
      setUser(data.user);
      nav("/admin");
    } catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <AuthCard testid="admin-login-page" title={codes ? "Backup codes" : mfa ? "Two-factor verification" : "Admin sign in"} subtitle="Restricted administrative console">
      {codes ? <BackupCodes codes={codes} onDone={() => nav("/admin")} /> : !mfa ? (
        <form onSubmit={login} className="space-y-4">
          <Field label="Admin username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} testid="admin-username-input" />
          <Field label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} testid="admin-password-input" />
          <SilverButton type="submit" data-testid="admin-login-button">CONTINUE</SilverButton>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          {mfa.mfa_setup_required && (
            <div className="space-y-3 text-center" data-testid="mfa-setup">
              <p className="text-sm text-neutral-300">MFA is mandatory. Scan with Google Authenticator or enter the key manually.</p>
              <img src={mfa.qr} alt="TOTP QR" className="mx-auto w-44 h-44 rounded-xl bg-white p-2" />
              <div className="mono text-xs break-all text-neutral-400" data-testid="mfa-secret">{mfa.secret}</div>
            </div>
          )}
          <Field label="6-digit code or backup code" value={code} onChange={(e) => setCode(e.target.value)} testid="admin-mfa-code-input" autoFocus />
          <SilverButton type="submit" data-testid="admin-mfa-submit">VERIFY</SilverButton>
        </form>
      )}
    </AuthCard>
  );
}
