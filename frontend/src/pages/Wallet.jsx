import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, inr, dt } from "@/lib/api";
import { MobileShell, Stat, Badge, Empty } from "@/components/common";
import { WagerProgress } from "@/components/WagerProgress";

const TABS = [["", "All"], ["bet_stake", "Bets"], ["bet_win", "Wins"], ["deposit", "Deposits"],
  ["withdraw_reserve,withdraw_complete,withdraw_refund", "Withdrawals"], ["withdraw_refund", "Refunds"], ["promotion", "Bonuses"],
  ["manual_credit,manual_debit", "Adjustments"]];
const LABEL = { bet_stake: "Bet stake", bet_win: "Winning return", deposit: "Deposit", withdraw_reserve: "Withdrawal requested (moved to reserved)",
  withdraw_complete: "Withdrawal paid out (from reserved)", withdraw_refund: "Withdrawal refund", manual_credit: "Admin credit",
  manual_debit: "Admin debit", promotion: "Bonus" };

export default function Wallet() {
  const [w, setW] = useState(null);
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState([]);
  const [bets, setBets] = useState([]);
  useEffect(() => {
    api.get("/wallet").then(({ data }) => setW(data));
    api.get("/game/my-bets").then(({ data }) => setBets(data));
  }, []);
  useEffect(() => { api.get("/wallet/ledger", { params: { type: tab } }).then(({ data }) => setRows(data)); }, [tab]);
  return (
    <MobileShell title="Wallet" testid="wallet-page">
      <div className="panel p-6 mb-4 rise">
        <div className="text-neutral-400 text-sm">Available balance</div>
        <div className="text-3xl font-black silver-text mt-1" data-testid="wallet-balance">{inr(w?.balance)}</div>
        <WagerProgress w={w} />
        <div className="flex gap-3 mt-5">
          <Link to="/deposit" className="silver-btn rounded-full h-11 flex-1 flex items-center justify-center font-bold" data-testid="wallet-deposit-link">Deposit</Link>
          <Link to="/withdraw" className="ghost-chip rounded-full h-11 flex-1 flex items-center justify-center font-bold" data-testid="wallet-withdraw-link">Withdraw</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Stat label="Pending deposits" value={inr(w?.pending_deposits)} testid="stat-pending-deposits" />
        <Stat label="Pending withdrawals" value={inr(w?.pending_withdrawals)} testid="stat-pending-withdrawals" />
        <Stat label="Verified deposits" value={inr(w?.total_deposits)} testid="stat-total-deposits" />
        <Stat label="Completed withdrawals" value={inr(w?.total_withdrawals)} testid="stat-total-withdrawals" />
        <Stat label="Winning returns" value={inr(w?.total_winnings)} testid="stat-winnings" />
        <Stat label="Reserved" value={inr(w?.reserved)} testid="stat-reserved" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 admin-scroll">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`ledger-tab-${l.toLowerCase()}`}
            className={`shrink-0 h-9 px-4 rounded-full text-sm font-semibold ${tab === k ? "silver-btn" : "ghost-chip"}`}>{l}</button>
        ))}
      </div>
      <div className="mt-3 space-y-2" data-testid="ledger-list">
        {rows.length === 0 && <Empty>No transactions</Empty>}
        {rows.map((r) => (
          <div key={r.id} className="panel !rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{LABEL[r.type] || r.type}</div>
              <div className="text-[11px] text-neutral-500">{dt(r.created_at)} · {r.id.slice(0, 8)}</div>
            </div>
            <div className="text-right">
              <div className={`mono font-bold ${r.amount > 0 ? "text-emerald-400" : r.amount < 0 ? "text-neutral-200" : "text-neutral-500"}`}>
                {r.amount > 0 ? "+" : r.amount < 0 ? "−" : ""}{r.amount ? inr(Math.abs(r.amount)) : `${inr(-(r.reserved_change || 0))} paid`}
              </div>
              {r.balance_after != null && <div className="text-[10px] text-neutral-500 mono">Bal {inr(r.balance_after)}</div>}
            </div>
          </div>
        ))}
      </div>
      <h3 className="mt-8 mb-3 font-semibold text-neutral-300">Betting history</h3>
      <div className="space-y-2" data-testid="bet-history">
        {bets.length === 0 && <Empty>No bets yet</Empty>}
        {bets.map((b) => (
          <div key={b.id} className="panel !rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Round #{b.round_number} · {b.side} · {inr(b.amount)}</div>
              <div className="text-[11px] text-neutral-500">{dt(b.created_at)} · Bet {b.id.slice(0, 8)}</div>
            </div>
            <div className="text-right">
              <Badge status={b.status} />
              {b.status === "won" && <div className="text-xs text-emerald-400 mono mt-1">+{inr(b.payout)}</div>}
            </div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
