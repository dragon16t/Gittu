import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthCard, Field, SilverButton, TextLink } from "@/components/common";

export const RecoveryCodeBox = ({ code, onDone }) => (
  <div className="space-y-4" data-testid="recovery-code-box">
    <p className="text-sm text-neutral-300">
      Save this recovery code somewhere safe. You will need it to reset your password. It is shown only once.
    </p>
    <div className="field px-4 py-4 text-center mono text-xl tracking-widest" data-testid="recovery-code-value">{code}</div>
    <SilverButton onClick={onDone} data-testid="recovery-code-continue">I SAVED IT — CONTINUE</SilverButton>
  </div>
);

export default function Register() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ username: "", password: "", confirm_password: "", referral_code: params.get("ref") || "" });
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);
  const { setUser } = useSession();
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm_password) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/register", f);
      setCode(data.recovery_code);
      setUser(data.user);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard
      testid="register-page"
      title={code ? "Account created" : "Sign up"}
      subtitle="Create your account in seconds"
      footer={!code && <>Have an account? <TextLink to="/login" testid="login-link">Login</TextLink></>}
    >
      {code ? (
        <RecoveryCodeBox code={code} onDone={() => nav("/")} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username" testid="register-username-input" value={f.username} onChange={set("username")} required />
          <Field label="Password" type="password" testid="register-password-input" value={f.password} onChange={set("password")} required />
          <Field label="Confirm password" type="password" testid="register-confirm-input" value={f.confirm_password}
            onChange={set("confirm_password")} required />
          <Field label="Referral code (optional)" testid="register-referral-input" value={f.referral_code}
            onChange={(e) => setF({ ...f, referral_code: e.target.value.toUpperCase() })} />
          <p className="text-xs text-neutral-500">Min 8 characters with letters and numbers.</p>
          <SilverButton type="submit" disabled={busy} data-testid="register-submit-button">{busy ? "Creating…" : "SIGN UP"}</SilverButton>
        </form>
      )}
    </AuthCard>
  );
}
