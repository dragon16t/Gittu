import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthCard, Field, SilverButton } from "@/components/common";

export default function VerifierLogin() {
  const [f, setF] = useState({ username: "", password: "" });
  const { setUser } = useSession();
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/verifier/auth/login", f);
      setUser(data.user);
      nav("/verifier");
    } catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <AuthCard testid="verifier-login-page" title="Verifier login" subtitle="Payment verifier portal">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Verifier ID" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} testid="verifier-username-input" />
        <Field label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} testid="verifier-password-input" />
        <SilverButton type="submit" data-testid="verifier-login-button">LOGIN</SilverButton>
      </form>
    </AuthCard>
  );
}
