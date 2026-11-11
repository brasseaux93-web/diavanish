import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Seat, Followup } from "@shared/schema";
import type { Call, SeatName } from "./types";

/* ── Follow-through ── */

export function FollowupPanel({
  roomId, seats, followups, seatName, call,
}: {
  roomId: number;
  seats: Seat[];
  followups: Followup[];
  seatName: SeatName;
  call: Call;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ type: "pledge", text: "", ownerSeatId: "none", dueDate: "" });

  const add = async () => {
    await call(() => apiJson("POST", `/api/facilitator/rooms/${roomId}/followups`, {
      type: form.type, text: form.text,
      ownerSeatId: form.ownerSeatId === "none" ? null : Number(form.ownerSeatId),
      dueDate: form.dueDate || null,
    }));
    setForm({ ...form, text: "", dueDate: "" });
  };

  const setStatus = (id: number, status: string) =>
    call(() => apiJson("POST", `/api/facilitator/followups/${id}/status`, { status }));

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-x-12 gap-y-10 items-start">
      <div className="space-y-8 min-w-0">
        {(["pledge", "commitment"] as const).map((type) => {
          const items = followups.filter((f) => f.type === type);
          return (
            <section key={type}>
              <h2 className="section-title pb-2 flex items-baseline gap-2">
                {t(type === "pledge" ? "pledges" : "commitments")}<span className="section-count">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground border-t border-border pt-4">{t("no_items")}</p>
              ) : (
                <ul className="divide-line border-y border-border">
                  {items.map((f) => (
                    <li key={f.id} data-testid={`card-followup-${f.id}`} className="py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="text-[0.9375rem] leading-relaxed text-pretty">{f.text}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t("owner")}: {f.ownerLabel}{f.dueDate && <> · {t("due")}: <span className="mono-data">{f.dueDate}</span></>}
                        </p>
                      </div>
                      <div className="segmented segmented-box shrink-0" role="group" aria-label={t("status")}>
                        {(["open", "kept", "lapsed"] as const).map((st) => (
                          <button key={st} type="button" aria-pressed={f.status === st} data-testid={`button-followup-${f.id}-${st}`}
                            onClick={() => { if (f.status !== st) setStatus(f.id, st); }}>
                            {t(st === "open" ? "open_status" : st)}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <p className="text-xs text-muted-foreground text-pretty max-w-[65ch]">{t("carry_note")}</p>
      </div>

      <form className="space-y-3" aria-labelledby="follow-add-h" onSubmit={(e) => { e.preventDefault(); if (form.text) add(); }}>
        <h2 id="follow-add-h" className="section-title">{t(form.type === "pledge" ? "add_pledge" : "add_commitment")}</h2>
        <div className="segmented segmented-box w-fit" role="radiogroup" aria-label={t("kind")}>
          {(["pledge", "commitment"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={form.type === v} onClick={() => setForm({ ...form, type: v })}>
              {t(v === "pledge" ? "pledges" : "commitments")}
            </button>
          ))}
        </div>
        <Textarea rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })}
          placeholder={t("entry_text")} aria-label={t("entry_text")} data-testid="input-followup-text" />
        <div className="space-y-1.5">
          <Label className="text-xs">{t("owner")}</Label>
          <Select value={form.ownerSeatId} onValueChange={(v) => setForm({ ...form, ownerSeatId: v })}>
            <SelectTrigger aria-label={t("owner")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("role_facilitator")}</SelectItem>
              {seats.map((s) => <SelectItem key={s.id} value={String(s.id)}>{seatName(s.id)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="follow-due">{t("due")}</Label>
          <Input id="follow-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <Button type="submit" size="sm" data-testid="button-followup-add" disabled={!form.text}>{t("add")}</Button>
      </form>
    </div>
  );
}
