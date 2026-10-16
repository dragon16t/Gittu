import { useEffect, useState } from "react";
import { api, dt } from "@/lib/api";
import { DataTable, Section, Btn } from "./ui";

export function AuditTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const load = () => api.get("/admin/audit", { params: { action: q } }).then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title="Audit logs" testid="admin-audit-log"
      actions={<><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter action e.g. wallet" onKeyDown={(e) => e.key === "Enter" && load()}
        className="h-9 px-3 rounded-full bg-black border border-white/15 text-sm outline-none" data-testid="audit-filter-input" />
        <Btn primary onClick={load} data-testid="audit-filter-button">Filter</Btn></>}>
      <DataTable rows={rows} minW={900} cols={[
        { label: "When", render: (r) => dt(r.created_at) }, { label: "Actor", render: (r) => `${r.actor || "—"} (${r.role || "?"})` },
        { label: "Action", key: "action" }, { label: "Target", render: (r) => <span className="mono text-[11px]">{r.target?.slice(0, 12)}</span> },
        { label: "Details", render: (r) => <span className="mono text-[11px] text-neutral-400">{JSON.stringify(r.details).slice(0, 120)}</span> },
        { label: "IP", key: "ip" },
      ]} />
    </Section>
  );
}
