/*
 * Record tab: the structured ledger (v2). Progressive disclosure: pick an
 * agenda step, pick one section chip, fill one compact form. Every item goes to
 * the room for consent with a support level before it can be approved.
 */
import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiJson, apiUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RECORD_KINDS, SCALES, supportFlags, type RecordKind } from "@shared/ledger";
import type { Room, AgendaItem, Seat } from "@shared/schema";
import type { EntryRow, Call } from "./types";
import { RecordBody, SupportLine, SealedRecord, parseSealed, thresholdLabel } from "@/components/ledger/record";

type FieldSpec = {
  key: string; label: string; kind: "text" | "area" | "date" | "url" | "choice";
  options?: { value: string; label: string }[]; required?: boolean; more?: boolean; hint?: string; list?: string;
};

function fieldsFor(kind: RecordKind, form: Record<string, string>, t: (k: string) => string, open: boolean): FieldSpec[] {
  switch (kind) {
    case "problem": return [
      { key: "statement", label: t("f_statement"), kind: "area", required: true },
      { key: "scale", label: t("f_scale"), kind: "choice", options: SCALES.map((s) => ({ value: s, label: t(`scale_${s}`) })) },
      { key: "affected", label: t("f_affected"), kind: "text", hint: t("f_affected_hint"), list: "rec-parties" },
    ];
    case "position": return [
      { key: "party", label: t("f_party"), kind: "text", required: true, hint: open ? t("f_party_hint_open") : t("f_party_hint"), list: "rec-parties" },
      { key: "wants", label: t("f_wants"), kind: "area", required: true },
      { key: "why", label: t("f_why"), kind: "text", more: true },
    ];
    case "evidence": return [
      { key: "summary", label: t("f_summary"), kind: "area", required: true },
      { key: "source", label: t("f_source"), kind: "text" },
      { key: "url", label: t("f_url"), kind: "url", hint: t("f_url_hint"), more: true },
    ];
    case "option": return [
      { key: "title", label: t("f_title"), kind: "text", required: true },
      { key: "status", label: t("f_status"), kind: "choice", options: [{ value: "chosen", label: t("f_chosen") }, { value: "dropped", label: t("f_dropped") }] },
      { key: "reason", label: t("f_reason"), kind: "text" },
      { key: "rationale", label: t("f_rationale"), kind: "area", more: true },
    ];
    case "agreement": return [
      { key: "action", label: t("f_action"), kind: "area", required: true },
      { key: "owner", label: t("f_owner"), kind: "text", required: true, hint: t("f_owner_hint"), list: "rec-parties" },
      { key: "deadline", label: t("f_deadline"), kind: "date" },
      { key: "measure", label: t("f_measure"), kind: "text" },
      { key: "resources", label: t("f_resources"), kind: "text", more: true },
    ];
    case "condition": return [
      { key: "form", label: "", kind: "choice", options: [{ value: "conditional", label: t("f_form_conditional") }, { value: "unresolved", label: t("f_form_unresolved") }] },
      ...(form.form === "unresolved"
        ? [{ key: "point", label: t("f_point"), kind: "area", required: true } as FieldSpec]
        : [{ key: "accept", label: t("f_accept"), kind: "text", required: true } as FieldSpec, { key: "provided", label: t("f_provided"), kind: "text", required: true } as FieldSpec]),
    ];
    case "question": return [
      { key: "question", label: t("f_question"), kind: "area", required: true },
      { key: "research", label: t("f_research"), kind: "text" },
    ];
  }
}

const DEFAULTS: Partial<Record<RecordKind, Record<string, string>>> = {
  problem: { scale: "city" }, option: { status: "chosen" }, condition: { form: "conditional" },
};

function toForm(payload: Record<string, any> | null): Record<string, string> {
  if (!payload) return {};
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)]));
}

/* ── One compact form ── */

function RecordForm({ kind, initial, onSubmit, onCancel, submitLabel, open, solo }: {
  kind: RecordKind; initial?: Record<string, string>; onSubmit: (payload: Record<string, string>) => Promise<boolean>;
  onCancel: () => void; submitLabel: string; open: boolean;
  /** Role labels held by exactly one admitted seat (lower-cased). */
  solo: Set<string>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({ ...(DEFAULTS[kind] ?? {}), ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const specs = fieldsFor(kind, form, t, open);
  const hasMoreFilled = specs.some((f) => f.more && form[f.key]);
  const [more, setMore] = useState(hasMoreFilled);
  const missing = specs.some((f) => f.required && !(form[f.key] ?? "").trim());
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const renderField = (f: FieldSpec) => {
    const id = `rec-${kind}-${f.key}`;
    if (f.kind === "choice") {
      return (
        <div key={f.key} className="space-y-1.5">
          {f.label && <Label className="text-xs text-muted-foreground">{f.label}</Label>}
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={f.label || t(`rk1_${kind}`)}>
            {f.options!.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={form[f.key] === o.value}
                data-testid={`choice-${f.key}-${o.value}`}
                onClick={() => set(f.key, o.value)}
                className={`chip min-h-8 ${form[f.key] === o.value ? "!text-foreground !border-[hsl(var(--foreground)/0.35)] bg-foreground/[0.06]" : "hover:text-foreground"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div key={f.key} className="space-y-1.5">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {f.label}{!f.required && <span className="opacity-70"> · {t("f_optional")}</span>}
        </Label>
        {f.kind === "area" ? (
          <Textarea id={id} rows={2} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className="min-h-[4.5rem]" />
        ) : (
          <Input id={id} type={f.kind === "date" ? "date" : f.kind === "url" ? "url" : "text"} list={f.list}
            inputMode={f.kind === "url" ? "url" : undefined} placeholder={f.kind === "url" ? "https://" : undefined}
            value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
        )}
        {(f.key === "party" || f.key === "owner") && solo.has((form[f.key] ?? "").trim().toLocaleLowerCase())
          // A calm, non-blocking note: a label only one seat holds can point at that person.
          ? <p className="text-xs text-[hsl(var(--warn))]/90" data-testid={`hint-solo-${f.key}`}>{t("f_solo_label")}</p>
          : f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  };

  const main = specs.filter((f) => !f.more);
  const extra = specs.filter((f) => f.more);
  return (
    <form className="space-y-4" data-testid={`form-record-${kind}`} onSubmit={async (e) => {
      e.preventDefault();
      if (missing || busy) return;
      setBusy(true);
      const ok = await onSubmit(form);
      setBusy(false);
      if (ok) setForm({ ...(DEFAULTS[kind] ?? {}) });
    }}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4 [&>*:has(textarea)]:sm:col-span-2 [&>*:has([role=radiogroup])]:sm:col-span-2">
        {main.map(renderField)}
        {more && extra.map(renderField)}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={missing || busy} data-testid="button-propose">{submitLabel}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
        {extra.length > 0 && !more && (
          <button type="button" className="ms-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => setMore(true)}>
            <Plus className="h-3 w-3" aria-hidden />{t("f_more")}
          </button>
        )}
      </div>
    </form>
  );
}

/* ── One item awaiting the room, or on the record ── */

function ItemCard({ e, call, open, grouped, solo }: { e: EntryRow; call: Call; open: boolean; grouped?: boolean; solo: Set<string> }) {
  const { t } = useI18n();
  const [revising, setRevising] = useState(false);
  const v = e.versions.find((x) => x.version === e.currentVersion);
  const payload = v?.payload ? JSON.parse(v.payload) : null;
  const tally = e.tally;
  const kind = e.kind as RecordKind;
  const pending = e.status === "pending";
  const d = tally?.decision;
  const answeredPct = tally && tally.required ? Math.min(100, (tally.responded / tally.required) * 100) : 0;

  if (revising) {
    return (
      <li className="py-5">
        <p className="text-sm font-medium mb-3">{t(`rk1_${kind}`)} · v{e.currentVersion + 1}</p>
        <RecordForm kind={kind} open={open} solo={solo} initial={toForm(payload)} submitLabel={t("rec_save_revision")}
          onCancel={() => setRevising(false)}
          onSubmit={async (p) => {
            let ok = false;
            await call(async () => { await apiJson("POST", `/api/facilitator/entries/${e.id}/revise`, { payload: p }); ok = true; });
            if (ok) setRevising(false);
            return ok;
          }} />
      </li>
    );
  }

  return (
    <li className="py-4 space-y-3" data-testid={`card-record-${e.id}`}>
      {(!grouped || e.carriedFrom || e.currentVersion > 1) && (
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
          {!grouped && <span className="text-foreground/80 font-medium">{t(`rk1_${kind}`)}</span>}
          {e.currentVersion > 1 && <span>v{e.currentVersion}</span>}
          {e.carriedFrom && <span>{t("rec_carried", { code: e.carriedFrom })}</span>}
        </p>
      )}
      <RecordBody kind={kind} payload={payload} text={v?.text ?? ""} />

      {pending && tally && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-1">
          <div className="min-w-[9rem] space-y-1.5">
            {d?.blocker === "waiting" ? (
              <>
                <div className="h-1 w-36 rounded-sm bg-foreground/[0.06] overflow-hidden" aria-hidden>
                  <span className="block h-full bg-foreground/40" style={{ width: `${answeredPct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground" data-testid={`text-tally-${e.id}`}>{t("rec_answered", { n: tally.responded, m: tally.required })}</p>
              </>
            ) : (
              <>
                <SupportLine support={tally.support} />
                <p className="text-xs" data-testid={`text-tally-${e.id}`}>
                  {d?.passed
                    ? <span className="text-primary inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden />{tally.support && supportFlags(tally.support).objection ? t("rec_passes_dissent") : t("rec_passes")}</span>
                    : d?.blocker === "objection" ? <span className="text-destructive">{t("rec_held")}</span>
                    : d?.blocker === "rewording" ? <span className="text-[hsl(var(--warn))]">{tally.rewording != null ? t("rec_rewording", { n: tally.rewording }) : t("sup_rewording")}</span>
                    : <span className="text-[hsl(var(--warn))]">{tally.consenting != null ? t("rec_short", { n: tally.consenting, m: tally.required }) : t("rec_short_levels")}</span>}
                </p>
              </>
            )}
          </div>
          <div className="ms-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setRevising(true)} data-testid={`button-revise-${e.id}`}>{t("revise")}</Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground"
              onClick={() => call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/reject`))}>{t("reject")}</Button>
            <Button size="sm" disabled={!tally.ready} data-testid={`button-approve-${e.id}`}
              onClick={() => call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/approve`), t("approved"))}>
              {t("rec_approve")}
            </Button>
          </div>
        </div>
      )}
      {!pending && tally?.support && <SupportLine support={tally.support} showReasons />}
    </li>
  );
}

/* ── The tab ── */

export function RecordTab({ room, agenda, seats, entries, call }: {
  room: Room; agenda: AgendaItem[]; seats: Seat[]; entries: EntryRow[]; call: Call;
}) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<number | null>(agenda[0]?.id ?? null);
  const [adding, setAdding] = useState<RecordKind | null>(null);
  const open = room.anonymityMode === "open";
  const record = entries.filter((e) => RECORD_KINDS.includes(e.kind as RecordKind) && e.status !== "rejected");
  const sealed = room.status === "sealed" ? parseSealed(room.sealedLedger) : null;
  const parties = useMemo(() => {
    const s = new Set<string>();
    for (const x of seats) {
      if (x.status !== "admitted") continue;
      if (x.claimedRole) s.add(x.claimedRole);
      if (open && x.useRealName && x.realName) s.add(x.realName);
    }
    return Array.from(s);
  }, [seats, open]);
  const solo = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of seats) {
      if (x.status !== "admitted" || !x.claimedRole) continue;
      const k = x.claimedRole.trim().toLocaleLowerCase();
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    return new Set(Array.from(n).filter(([, c]) => c === 1).map(([k]) => k));
  }, [seats]);

  if (sealed) {
    return (
      <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem] gap-8 lg:gap-10 items-start">
      <div className="min-w-0 max-w-3xl space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title">{t("rec_title")}</h2>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" data-testid="button-open-brief"
              onClick={() => window.open(apiUrl(`/api/public/ledger/${room.code}/brief.html?lang=${lang}`), "_blank")}>
              {t("brief_open")}
            </Button>
            <Button size="sm" variant="ghost"
              onClick={() => window.open(apiUrl(`/api/public/ledger/${room.code}/brief.html?lang=${lang}#print`), "_blank")}>
              {t("brief_pdf")}
            </Button>
          </div>
        </div>
        <SealedRecord doc={sealed} />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-20" data-testid="card-record-seal">
        <div className="space-y-1.5">
          <h3 className="section-title">{t("fingerprint")}</h3>
          <p className="mono-data text-xs leading-relaxed break-all text-[hsl(var(--seal))]">{room.fingerprint}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs border-t border-border pt-4">
          <div><dt className="text-muted-foreground">{t("sealed_at")}</dt><dd className="mt-0.5">{new Date(room.sealedAt ?? 0).toLocaleDateString()}</dd></div>
          <div><dt className="text-muted-foreground">{t("th_title")}</dt><dd className="mt-0.5">{thresholdLabel(t, sealed.room.threshold)}</dd></div>
          <div><dt className="text-muted-foreground">{t("tier_title")}</dt><dd className="mt-0.5">{sealed.room.tier ? t(`tier_${sealed.room.tier}`) : "—"}</dd></div>
          <div><dt className="text-muted-foreground">{t("rec_on_record")}</dt><dd className="mt-0.5 mono-data">{sealed.items.length}</dd></div>
        </dl>
      </aside>
      </div>
    );
  }

  const steps: { id: number | null; title: string; pos: string }[] = [
    ...agenda.map((a) => ({ id: a.id, title: a.title, pos: String(a.position) })),
    { id: null, title: t("rec_general"), pos: "·" },
  ];
  const here = record.filter((e) => (e.agendaItemId ?? null) === step);
  const pendingHere = here.filter((e) => e.status === "pending").sort((a, b) => a.id - b.id);
  const approvedHere = here.filter((e) => e.status === "approved");
  const kindsHere = new Set(approvedHere.map((e) => e.kind));
  const current = steps.find((s) => s.id === step) ?? steps[0];
  const readOnly = room.status !== "live" && room.status !== "draft" && room.status !== "closed";

  return (
    <div className="grid lg:grid-cols-[15rem_minmax(0,1fr)] gap-6 lg:gap-10 items-start min-w-0">
      <datalist id="rec-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>

      {/* Stepper: one agenda item at a time */}
      <nav aria-label={t("agenda")} className="lg:sticky lg:top-20 min-w-0 max-w-full">
        <p className="side-title hidden lg:block">{t("agenda")}</p>
        <ol className="flex lg:flex-col gap-1 overflow-x-auto min-w-0 max-w-full -mx-1 px-1 pb-1 lg:pb-0 scrollbar-none" data-testid="record-stepper">
          {steps.map((s) => {
            const items = record.filter((e) => (e.agendaItemId ?? null) === s.id);
            const waiting = items.filter((e) => e.status === "pending").length;
            const done = items.filter((e) => e.status === "approved").length;
            const active = s.id === current.id;
            return (
              <li key={String(s.id)} className="shrink-0">
                <button type="button" onClick={() => { setStep(s.id); setAdding(null); }} aria-current={active ? "step" : undefined}
                  className={`w-full text-start flex items-center gap-2.5 rounded-md px-3 py-2 min-h-11 transition-colors ${active ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"}`}>
                  <span className="min-w-0 flex-1 text-sm leading-snug line-clamp-2 max-w-[12rem] lg:max-w-none">{s.title}</span>
                  {waiting > 0
                    ? <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warn))] shrink-0" role="img" aria-label={t("rec_awaiting")} />
                    : done > 0 ? <span className="text-xs text-muted-foreground shrink-0" aria-label={`${done} ${t("rec_on_record")}`}>{done}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0 space-y-6">
        <header className="space-y-3">
          <h2 className="font-display font-semibold text-lg text-balance">{current.title}</h2>
          <p className="text-xs text-muted-foreground">{t("th_chip", { rule: thresholdLabel(t, room.sealThreshold).toLowerCase() })} · {t(`th_${room.sealThreshold === "super75" || room.sealThreshold === "super66" ? room.sealThreshold : "consensus"}_line`)}</p>
        </header>

        {/* Add-a-section chips, then one compact form */}
        {!readOnly && (
          <section className="space-y-4">
            <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label={t("rec_add_prompt")} data-testid="record-chips">
              {RECORD_KINDS.map((k) => (
                <button key={k} type="button" data-testid={`chip-add-${k}`} aria-pressed={adding === k}
                  onClick={() => setAdding(adding === k ? null : k)}
                  className={`inline-flex items-center gap-1.5 min-h-9 rounded-md border px-2.5 text-sm transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5 ${adding === k ? "border-[var(--line-strong)] bg-foreground/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-[var(--line-strong)]"}`}>
                  {adding === k ? <X aria-hidden /> : <Plus aria-hidden />}{t(`rk1_${k}`)}
                  {adding !== k && kindsHere.has(k) && <Check className="text-primary" aria-label={t("rec_on_record")} />}
                </button>
              ))}
            </div>
            {adding && (
              <div className="border-t border-border pt-5 space-y-4" data-testid="record-form-panel">
                <div>
                  <h3 className="section-title">{t(`rk_${adding}`)}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t(`rh_${adding}`)}</p>
                </div>
                <RecordForm key={`${adding}-${String(step)}`} kind={adding} open={open} solo={solo} submitLabel={t("rec_propose")}
                  onCancel={() => setAdding(null)}
                  onSubmit={async (payload) => {
                    let ok = false;
                    await call(async () => {
                      await apiJson("POST", `/api/facilitator/rooms/${room.id}/record`, { kind: adding, payload, agendaItemId: step });
                      ok = true;
                    }, t("rec_proposed_ok"));
                    if (ok) setAdding(null);
                    return ok;
                  }} />
              </div>
            )}
          </section>
        )}

        {pendingHere.length > 0 && (
          <section className="space-y-1">
            <h3 className="section-title flex items-baseline gap-2">
              {t("rec_awaiting")}<span className="section-count">{pendingHere.length}</span>
            </h3>
            <ul className="divide-line border-y border-border" data-testid="list-record-pending">
              {pendingHere.map((e) => <ItemCard key={e.id} e={e} call={call} open={open} solo={solo} />)}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="section-title flex items-baseline gap-2">
            {t("rec_on_record")}<span className="section-count">{approvedHere.length}</span>
          </h3>
          {approvedHere.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">{t("rec_empty")}</p>
          ) : (
            <div className="space-y-5">
              {RECORD_KINDS.filter((k) => kindsHere.has(k)).map((k) => (
                <div key={k} className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">{t(`rk_${k}`)}</h4>
                  <ul className="divide-line border-y border-border">
                    {approvedHere.filter((e) => e.kind === k).map((e) => <ItemCard key={e.id} e={e} call={call} open={open} grouped solo={solo} />)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


