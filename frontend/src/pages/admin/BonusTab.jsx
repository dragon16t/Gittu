import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, inr, dt, toPaise } from "@/lib/api";
import { DataTable, Section, Input, Btn } from "./ui";

export default function BonusTab() {
  const [d, setD] = useState(null);
  const [f, setF] = useState({});
  const [s, setS] = useState({ username: "", random_count: "", amount: "", wager: "1", title: "Surprise bonus", credit_now: true });
  const load = () => api.get("/admin/bonus").then(({ data }) => {
    setD(data);
    setF({ daily_bonus: data.daily_bonus / 100, referral_bonus: data.referral_bonus / 100, friend_bonus: data.friend_bonus / 100 });
  });
  useEffect(() => { load(); }, []);
  const save = async () => {
    try {
      await api.put("/admin/bonus", { daily_bonus: toPaise(f.daily_bonus), referral_bonus: toPaise(f.referral_bonus), friend_bonus: toPaise(f.friend_bonus) });
      toast.success("Bonus settings saved"); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const send = async () => {
    try {
      const { data } = await api.post("/admin/bonus/send", { username: s.username, random_count: Number(s.random_count) || 0, amount: toPaise(s.amount),
        wager: Number(s.wager) || 0, title: s.title, credit_now: s.credit_now });
      toast.success(`Bonus sent to ${data.sent} of ${data.targets} user(s)`); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  if (!d) return null;
  return (
    <>
      <Section title="Bonus amounts" testid="bonus-config">
        <div className="grid md:grid-cols-3 gap-3">
          <Input label="Daily bonus (₹) · 3× wagering" type="number" value={f.daily_bonus} onChange={(e) => setF({ ...f, daily_bonus: e.target.value })} testid="bonus-daily-input" />
          <Input label="Referrer bonus (₹)" type="number" value={f.referral_bonus} onChange={(e) => setF({ ...f, referral_bonus: e.target.value })} testid="bonus-referrer-input" />
          <Input label="Referee / friend bonus (₹)" type="number" value={f.friend_bonus} onChange={(e) => setF({ ...f, friend_bonus: e.target.value })} testid="bonus-referee-input" />
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Promo reserve left: <b className="text-white">{inr(d.promo_reserve)}</b> · Promotions {d.promotions_enabled ? "ON" : "OFF"}</span>
          <Btn primary onClick={save} data-testid="bonus-save-button">Save bonus settings</Btn>
        </div>
      </Section>
      <Section title="Send a bonus" testid="bonus-send">
        <div className="grid md:grid-cols-3 gap-3">
          <Input label="Username (one user)" value={s.username} onChange={(e) => setS({ ...s, username: e.target.value, random_count: "" })} testid="bonus-send-username" />
          <Input label="…or number of random active users" type="number" value={s.random_count} onChange={(e) => setS({ ...s, random_count: e.target.value, username: "" })} testid="bonus-send-random" />
          <Input label="Amount per user (₹)" type="number" value={s.amount} onChange={(e) => setS({ ...s, amount: e.target.value })} testid="bonus-send-amount" />
          <Input label="Wagering multiplier (×)" type="number" value={s.wager} onChange={(e) => setS({ ...s, wager: e.target.value })} testid="bonus-send-wager" />
          <Input label="Title shown to user" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} testid="bonus-send-title" />
          <label className="flex items-center gap-2 text-sm text-neutral-300 mt-6"><input type="checkbox" checked={s.credit_now} onChange={(e) => setS({ ...s, credit_now: e.target.checked })} data-testid="bonus-send-credit-now" /> Credit to wallet now (otherwise user claims it)</label>
        </div>
        <div className="flex justify-end"><Btn primary onClick={send} data-testid="bonus-send-button">Send bonus</Btn></div>
      </Section>
      <Section title="Bonuses sent by admin" testid="bonus-history">
        <DataTable rows={d.history} cols={[{ label: "Date", render: (r) => dt(r.created_at) }, { label: "User", render: (r) => <span className="mono">{r.user_id.slice(0, 8)}</span> },
          { label: "Title", key: "title" }, { label: "Amount", render: (r) => inr(r.amount) }, { label: "Wager", render: (r) => `${r.wager_multiplier}×` }, { label: "Status", key: "status" }]} />
      </Section>
    </>
  );
}
