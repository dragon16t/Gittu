import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthCard, Field, SilverButton, TextLink } from "@/components/common";

export default function Login() {
  const [f, setF] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const { setUser } = useSession();
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", f);
      setUser(data.user);
      nav("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard
      testid="login-page"
      title="Login"
      subtitle="30-second rounds · 1.95× total return"
      footer={<>New here? <TextLink to="/register" testid="signup-link">Create an account</TextLink></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" testid="login-username-input" value={f.username} autoComplete="username"
          onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <Field label="Password" type="password" testid="login-password-input" value={f.password} autoComplete="current-password"
          onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <div className="text-right text-sm">
          <TextLink to="/forgot" testid="forgot-password-link">Forgot password?</TextLink>
        </div>
        <SilverButton type="submit" disabled={busy} data-testid="login-submit-button">{busy ? "Signing in…" : "LOGIN"}</SilverButton>
      </form>
    </AuthCard>
  );
}
