import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const DataTable = ({ cols, rows, testid, empty = "No records", minW = 720 }) => (
  <div className="panel !rounded-2xl p-4 overflow-x-auto admin-scroll" data-testid={testid}>
    <table className="w-full text-[13px] text-left" style={{ minWidth: minW }}>
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
          {cols.map((c) => <th key={c.label} className="pb-2 pr-3 font-medium">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={cols.length} className="py-8 text-center text-neutral-500">{empty}</td></tr>}
        {rows.map((r, i) => (
          <tr key={r.id || i} className="border-t border-white/5 align-top">
            {cols.map((c) => <td key={c.label} className="py-2.5 pr-3">{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const Section = ({ title, actions, children, testid }) => (
  <section className="space-y-3" data-testid={testid}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
    {children}
  </section>
);

export const Modal = ({ open, onClose, title, children, testid }) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="bg-[#0b0b0b] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto" data-testid={testid}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

export const Input = ({ label, testid, ...p }) => (
  <label className="block">
    <span className="block text-xs text-neutral-400 mb-1">{label}</span>
    <input data-testid={testid} className="w-full h-10 px-3 rounded-lg bg-black border border-white/15 focus:border-white/50 outline-none text-sm" {...p} />
  </label>
);

export const Select = ({ label, options, testid, ...p }) => (
  <label className="block">
    <span className="block text-xs text-neutral-400 mb-1">{label}</span>
    <select data-testid={testid} className="w-full h-10 px-3 rounded-lg bg-black border border-white/15 outline-none text-sm" {...p}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

export const Btn = ({ children, primary, className = "", ...p }) => (
  <button className={`rounded-full h-9 px-4 text-xs font-bold ${primary ? "silver-btn" : "ghost-chip"} ${className}`} {...p}>{children}</button>
);
