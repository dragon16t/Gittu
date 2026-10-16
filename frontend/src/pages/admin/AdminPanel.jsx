import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Dice5, Users, ShieldCheck, Landmark, ArrowLeftRight, FlaskConical, FileBarChart, ScrollText, Lock, LogOut, Headset, Activity } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import DashboardTab from "./DashboardTab";
import GameTab from "./GameTab";
import UsersTab from "./UsersTab";
import VerifiersTab from "./VerifiersTab";
import AccountsTab from "./AccountsTab";
import PaymentsTab from "./PaymentsTab";
import { PracticeTab, AuditTab } from "./LogTabs";
import ReportsTab from "./ReportsTab";
import SecurityTab from "./SecurityTab";
import TicketsTab from "./TicketsTab";
import WorkloadTab from "./WorkloadTab";

const TABS = [
  ["dashboard", "Dashboard", LayoutDashboard, DashboardTab], ["game", "Game Configuration", Dice5, GameTab],
  ["users", "User Management", Users, UsersTab], ["verifiers", "Payment Verifiers", ShieldCheck, VerifiersTab],
  ["accounts", "Payment Accounts", Landmark, AccountsTab], ["payments", "Deposits & Withdrawals", ArrowLeftRight, PaymentsTab],
  ["tickets", "Support Tickets", Headset, TicketsTab],
  ["workload", "Agent Workload", Activity, WorkloadTab],
  ["practice", "Practice Preview Log", FlaskConical, PracticeTab], ["reports", "Reports", FileBarChart, ReportsTab],
  ["audit", "Audit Logs", ScrollText, AuditTab], ["security", "Security", Lock, SecurityTab],
];

export default function AdminPanel() {
  const [tab, setTab] = useState("dashboard");
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const Active = TABS.find((t) => t[0] === tab)[3];
  const logout = async () => { await api.post("/admin/auth/logout").catch(() => {}); setUser(false); nav("/admin/login"); };
  return (
    <div className="relative z-10 min-h-screen flex flex-col lg:flex-row" data-testid="admin-panel">
      <aside className="lg:w-64 lg:min-h-screen border-b lg:border-b-0 lg:border-r border-white/10 bg-black/60 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen">
        <div className="px-5 py-5 flex lg:block items-center justify-between">
          <div>
            <div className="text-2xl font-black silver-text tracking-widest">BLACKBA</div>
            <div className="text-[11px] text-neutral-500 uppercase tracking-[0.2em]">Admin · {user?.username}</div>
          </div>
          <button onClick={logout} className="lg:hidden ghost-chip rounded-full h-9 w-9 flex items-center justify-center" data-testid="admin-logout-mobile"><LogOut size={15} /></button>
        </div>
        <nav className="flex lg:flex-col gap-1 px-3 pb-3 overflow-x-auto admin-scroll">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} data-testid={`admin-tab-${k}`}
              className={`shrink-0 flex items-center gap-3 px-3 h-10 rounded-xl text-sm transition-colors ${tab === k ? "bg-white text-black font-semibold" : "text-neutral-400 hover:text-white hover:bg-white/5"}`}>
              <Icon size={16} />{label}
            </button>
          ))}
          <button onClick={logout} className="hidden lg:flex items-center gap-3 px-3 h-10 rounded-xl text-sm text-neutral-400 hover:text-white mt-4" data-testid="admin-logout-button">
            <LogOut size={16} />Logout
          </button>
        </nav>
      </aside>
      <main className="flex-1 min-w-0 px-4 sm:px-8 py-8 space-y-8">
        <Active />
      </main>
    </div>
  );
}
