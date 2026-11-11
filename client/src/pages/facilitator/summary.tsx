import { useEffect, useState } from "react";
import { Check, Lock, Minus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiJson, getSessionToken, apiUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Room, Seat } from "@shared/schema";
import type { SummaryRow, Call, SeatName } from "./types";

/* ── Structured outcome summary ── */

export function SummaryPanel({
  room, admitted, summaries, seatName, call,
}: {
  room: Room;
  admitted: Seat[];
  summaries: SummaryRow[];
  seatName: SeatName;
  call: Call;
}) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const latest = summaries[0]; // sorted version desc
  const locked = !!latest?.locked;
  const [form, setForm] = useState({
    agreements: "", openIssues: "", nextSteps: "", disagreements: "", deadlines: "",
  });
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (latest && !seeded) {
      setForm({
        agreements: latest.agreements, openIssues: latest.openIssues,
        nextSteps: latest.nextSteps, disagreements: latest.disagreements,
        deadlines: latest.deadlines,
      });
      setSeeded(true);
    }
  }, [latest, seeded]);

  const sections: { key: keyof typeof form; label: string }[] = [
    { key: "agreements", label: t("sec_agreements") },
    { key: "openIssues", label: t("sec_open_issues") },
    { key: "nextSteps", label: t("sec_next_steps") },
    { key: "disagreements", label: t("sec_disagreements") },
    { key: "deadlines", label: t("sec_deadlines") },
  ];

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-x-12 gap-y-10 items-start">
      <section className="space-y-4 min-w-0" data-testid="card-summary-editor" aria-labelledby="summary-h">
        <div>
          <h2 id="summary-h" className="section-title">{t("summary_title")}</h2>
          <p className="text-sm text-muted-foreground text-pretty mt-1 max-w-[65ch]">{t("summary_note")}</p>
        </div>

        {locked ? (
          <p className="text-sm text-[hsl(var(--seal))] flex items-center gap-2" data-testid="text-summary-locked">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />{t("summary_locked_final")} · v{latest?.version}
          </p>
        ) : (
          <div className="space-y-4">
            {sections.map((s) => (
              <div key={s.key} className="space-y-1.5">
                <Label htmlFor={`summary-${s.key}`}>{s.label}</Label>
                <Textarea id={`summary-${s.key}`} rows={3} value={form[s.key]}
                  data-testid={`input-summary-${s.key}`}
                  onChange={(e) => setForm({ ...form, [s.key]: e.target.value })} />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!locked && (
            <Button size="sm" data-testid="button-save-summary" disabled={!form.agreements && !form.nextSteps}
              onClick={async () => {
                await call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/summary`, form));
                setSeeded(false);
              }}>
              {t("summary_save_version")}
            </Button>
          )}
          {latest && !locked && (
            <Button size="sm" variant="secondary" data-testid="button-lock-summary"
              onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/summary/${latest.id}/lock`))}>
              {t("lock_summary")}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!latest} data-testid="button-export-summary"
            onClick={async () => {
              const res = await fetch(apiUrl(`/api/facilitator/rooms/${room.id}/summary.md`), {
                headers: { "x-aperture-session": getSessionToken() ?? "" },
              });
              if (!res.ok) { toast({ title: t("error_generic"), variant: "destructive" }); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `diavanish-summary-${room.code}.md`; a.click();
              URL.revokeObjectURL(url);
            }}>
            {t("export_summary")}
          </Button>
        </div>
      </section>

      {/* Version history + party verification status */}
      <section aria-labelledby="summary-versions-h">
        <h2 id="summary-versions-h" className="section-title pb-2 flex items-baseline gap-2">
          {t("summary_versions")}<span className="section-count">{summaries.length}</span>
        </h2>
        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground border-t border-border pt-4">{t("no_items")}</p>
        ) : (
          <ul className="divide-line border-y border-border">
            {summaries.map((v) => {
              const ok = v.confirmations.filter((c) => c.confirmed);
              return (
                <li key={v.id} data-testid={`card-summary-${v.id}`} className="py-3.5 space-y-2">
                  <p className="text-sm flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">v{v.version}</span>
                    <span className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString(lang)}</span>
                    {v.locked ? <span className="text-xs text-[hsl(var(--seal))]">{t("summary_locked_final")}</span> : null}
                  </p>
                  {admitted.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("summary_no_confirmations")}</p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">{t("confirmed_count", { n: ok.length, total: admitted.length })}</p>
                      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {admitted.map((s) => {
                          const c = v.confirmations.find((x) => x.seatId === s.id && x.confirmed);
                          return (
                            <li key={s.id} className={`inline-flex items-center gap-1 ${c ? "text-foreground" : "text-muted-foreground"}`}>
                              {c ? <Check className="h-3 w-3 text-primary" aria-hidden /> : <Minus className="h-3 w-3 opacity-60" aria-hidden />}
                              {seatName(s.id)}
                              <span className="sr-only">: {t(c ? "confirmed_by" : "waiting")}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {v.confirmations.filter((c) => c.note).map((c) => (
                    <p key={c.id} className="text-xs text-muted-foreground text-pretty">
                      <span className="text-foreground/80">{seatName(c.seatId)}:</span> {c.note}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
