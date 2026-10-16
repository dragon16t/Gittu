import { dt } from "@/lib/api";

const LABELS = {
  created: "Ticket raised", assigned: "Shared with payment agent", deposit_approved: "Deposit approved & credited",
  withdrawal_processed: "Withdrawal processed · proof uploaded", agent_note: "Agent note", admin_reply: "Support reply",
  user_reply: "Your reply", resolved: "Resolved", reopened: "Reopened", closed: "Closed",
};

export const STATUS_TEXT = {
  open: "Open", assigned: "With agent", agent_actioned: "Action taken", reopened: "Reopened", resolved: "Resolved", closed: "Closed",
};

export const Timeline = ({ events, viewer }) => (
  <ol className="relative border-l border-white/15 ml-2 space-y-4" data-testid="ticket-timeline">
    {events.map((e) => (
      <li key={e.id} className="ml-4">
        <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-white/80" />
        <div className="text-xs text-neutral-500">{dt(e.at)} · {viewer === "user" && e.role !== "user" ? "Support" : `${e.by} (${e.role})`}</div>
        <div className="text-sm font-semibold">{viewer === "user" && e.type === "user_reply" ? LABELS.user_reply : (LABELS[e.type] || e.type).replace("Your reply", "User reply")}</div>
        {e.note && <div className="text-xs text-neutral-300 mt-0.5 whitespace-pre-wrap">{e.note}</div>}
        {e.reference && <div className="text-[11px] mono text-neutral-400">Ref {e.reference}</div>}
      </li>
    ))}
  </ol>
);
