import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Landmark, KeyRound, History, LogOut, ChevronRight, Mail, Gift, Headset, FileText } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useSession } from "@/lib/session";
import { MobileShell, Field, SilverButton } from "@/components/common";
import { TermsBody } from "@/components/Terms";

const Row = ({ icon: Icon, label, to, onClick, testid }) => {
  const cls = "panel !rounded-2xl h-14 px-4 flex items-center justify-between w-full hover:border-white/25 transition-colors";
  const inner = (<><span className="flex items-center gap-3"><Icon size={18} className="text-neutral-400" />{label}</span><ChevronRight size={16} className="text-neutral-500" /></>);
  return to ? <Link to={to} className={cls} data-testid={testid}>{inner}</Link> : <button onClick={onClick} className={cls} data-testid={testid}>{inner}</button>;
};

function PasswordForm({ onDone }) {
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const save = async () => {
    try {
      await api.post("/auth/change-password", f);
      toast.success("Password changed. Other sessions signed out.");
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="panel p-5 space-y-3 rise" data-testid="password-form">
      <Field label="Current password" type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} testid="current-password-input" />
      <Field label="New password" type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} testid="new-password-input" />
      <SilverButton onClick={save} data-testid="change-password-submit">UPDATE PASSWORD</SilverButton>
    </div>
  );
}

export default function Settings() {
  const [params] = useSearchParams();
  const [panel, setPanel] = useState(params.get("bank") ? "bank" : null);
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    setUser(false);
    nav("/login");
  };
  return (
    <MobileShell title="Settings" testid="settings-page">
      <div className="text-sm text-neutral-400 mb-5">Signed in as <span className="text-white font-semibold" data-testid="settings-username">{user?.username}</span></div>
      <div className="space-y-2.5">
        <Row icon={Wallet} label="Wallet & balance" to="/wallet" testid="settings-wallet" />
        <Row icon={ArrowDownToLine} label="Deposit" to="/deposit" testid="settings-deposit" />
        <Row icon={ArrowUpFromLine} label="Withdraw" to="/withdraw" testid="settings-withdraw" />
        <Row icon={Mail} label="Messages & coupons" to="/messages" testid="settings-messages" />
        <Row icon={Gift} label="Refer & earn" to="/refer" testid="settings-refer" />
        <Row icon={Headset} label="Customer support" to="/support" testid="settings-support" />
        <Row icon={FileText} label="Terms & Conditions" onClick={() => setPanel(panel === "terms" ? null : "terms")} testid="settings-terms" />
        {panel === "terms" && <div className="panel p-5"><TermsBody /></div>}
        <Row icon={Landmark} label="KYC & withdrawal accounts" to="/kyc" testid="settings-bank" />
        <Row icon={KeyRound} label="Change password" onClick={() => setPanel(panel === "pw" ? null : "pw")} testid="settings-password" />
        {panel === "pw" && <PasswordForm onDone={() => setPanel(null)} />}
        <Row icon={History} label="Transaction history" to="/wallet" testid="settings-history" />
        <Row icon={LogOut} label="Logout" onClick={logout} testid="settings-logout" />
      </div>
    </MobileShell>
  );
}
