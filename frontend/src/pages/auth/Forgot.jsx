import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { AuthCard, Field, SilverButton, TextLink } from "@/components/common";
import { RecoveryCodeBox } from "./Register";

export default function Forgot() {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ username: "", recovery_code: "", dob: "", bank_last4: "", password: "", confirm_password: "" });
  const [method, setMethod] = useState("dob");
  const [token, setToken] = useState("");
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/forgot/verify", { username: f.username, bank_last4: f.bank_last4, ...(method === "dob" ? { dob: f.dob } : { recovery_code: f.recovery_code }) });
      setToken(data.reset_token);
      setStep(2);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/forgot/reset", { reset_token: token, password: f.password, confirm_password: f.confirm_password });
      toast.success("Password updated. All sessions signed out.");
      setCode(data.recovery_code);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard testid="forgot-page" title="Recover access" subtitle="Verify ownership to reset your password"
      footer={<TextLink to="/login" testid="back-to-login">Back to login</TextLink>}>
      {code ? (
        <RecoveryCodeBox code={code} onDone={() => nav("/login")} />
      ) : step === 1 ? (
        <form onSubmit={verify} className="space-y-4">
          <Field label="Username or mobile number" testid="forgot-username-input" value={f.username} onChange={set("username")} required />
          <div className="grid grid-cols-2 gap-2">
            {[["dob", "Date of birth"], ["code", "Recovery code"]].map(([k, l]) => (
              <button type="button" key={k} onClick={() => setMethod(k)} data-testid={`forgot-method-${k}`}
                className={`h-9 rounded-full text-xs font-semibold ${method === k ? "silver-btn" : "ghost-chip"}`}>{l}</button>
            ))}
          </div>
          {method === "dob" ? (
            <Field label="Date of birth" type="date" testid="forgot-dob-input" value={f.dob} onChange={set("dob")} required className="[&_input]:[color-scheme:dark]" />
          ) : (
            <Field label="Recovery code" testid="forgot-recovery-input" placeholder="XXXX-XXXX-XXXX-XXXX" value={f.recovery_code}
              onChange={set("recovery_code")} required />
          )}
          <Field label="Last 4 digits of bank account (if added)" testid="forgot-last4-input" maxLength={4} value={f.bank_last4}
            onChange={set("bank_last4")} />
          <SilverButton type="submit" disabled={busy} data-testid="forgot-verify-button">VERIFY</SilverButton>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4">
          <p className="text-xs text-neutral-400">Reset authorization is single-use and expires in 15 minutes.</p>
          <Field label="New password" type="password" testid="forgot-new-password" value={f.password} onChange={set("password")} required />
          <Field label="Confirm password" type="password" testid="forgot-confirm-password" value={f.confirm_password}
            onChange={set("confirm_password")} required />
          <SilverButton type="submit" disabled={busy} data-testid="forgot-reset-button">SET NEW PASSWORD</SilverButton>
        </form>
      )}
    </AuthCard>
  );
}
