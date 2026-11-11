/*
 * Display pieces for the structured record (ledger v2): one item's body, the
 * room's combined support, quiet tier and threshold chips, and the sealed
 * record grouped by section. Shared by the facilitator and participant rooms.
 */
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { RECORD_KINDS, isCountsView, supportFlags, type LedgerDocV2, type RecordKind, type SupportView } from "@shared/ledger";
import { formatMinutes } from "@shared/tiers";

type AnyPayload = Record<string, any> | null;

/** One structured item, laid out by kind. Never more than a few short lines. */
const FREE_KINDS: Record<string, string> = {
  issue: "kind_issue", summary: "kind_summary", "next-step": "kind_next_step", attestation: "kind_attestation",
};
/** The readable name of an entry kind; an unknown kind is shown as stored. */
export function kindLabel(t: (k: string) => string, kind: string): string {
  if ((RECORD_KINDS as readonly string[]).includes(kind)) return t(`rk1_${kind}`);
  return FREE_KINDS[kind] ? t(FREE_KINDS[kind]) : kind;
}

export function RecordBody({ kind, payload, text, compact }: { kind: string; payload: AnyPayload; text: string; compact?: boolean }) {
  const { t } = useI18n();
  if (!payload) return <p className="text-[0.9375rem] leading-relaxed text-pretty">{text}</p>;
  const lead = "text-[0.9375rem] leading-relaxed text-pretty text-foreground";
  const meta = "text-sm text-muted-foreground text-pretty";
  const Row = ({ k, v }: { k: string; v?: ReactNode }) => v ? (
    <p className={meta}><span className="text-foreground/70">{k}</span> · {v}</p>
  ) : null;
  switch (kind as RecordKind) {
    case "problem":
      return (
        <div className="space-y-1.5">
          <p className={lead}>{payload.statement}</p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <span className="chip">{t("f_scale")} · {t(`scale_${payload.scale}`)}</span>
            {(payload.affected ?? []).map((a: string) => <span key={a} className="chip">{a}</span>)}
          </div>
        </div>
      );
    case "position":
      return (
        <div className="space-y-1">
          <p className={lead}><span className="font-medium">{payload.party}</span> <span className="text-muted-foreground">·</span> {payload.wants}</p>
          {!compact && <Row k={t("f_why")} v={payload.why} />}
        </div>
      );
    case "evidence":
      return (
        <div className="space-y-1">
          <p className={lead}>{payload.summary}</p>
          <p className={meta}>
            {payload.source}
            {payload.url && <> · <span className="mono-data text-xs break-all select-all" data-testid="text-evidence-url">{payload.url}</span></>}
          </p>
        </div>
      );
    case "option":
      return (
        <div className="space-y-1">
          <p className={lead}>
            <span className={`chip me-2 align-[1px] ${payload.status === "chosen" ? "chip-ok" : ""}`}>{t(payload.status === "chosen" ? "f_chosen" : "f_dropped")}</span>{" "}
            {payload.title}
          </p>
          {!compact && <Row k={t("f_rationale")} v={payload.rationale} />}
          {!compact && <Row k={t("f_reason")} v={payload.reason} />}
        </div>
      );
    case "agreement":
      return (
        <div className="space-y-1">
          <p className={lead}>{payload.action}</p>
          <p className={meta}>
            <span className="text-foreground/80">{payload.owner}</span>
            {payload.deadline && (
              <>
                {" · "}
                <span className={/^\d{4}-\d{2}-\d{2}$/.test(payload.deadline) ? "mono-data text-xs" : undefined}>
                  {payload.deadline}
                </span>
              </>
            )}
          </p>
          {!compact && <Row k={t("f_measure")} v={payload.measure} />}
          {!compact && <Row k={t("f_resources")} v={payload.resources} />}
        </div>
      );
    case "condition":
      return payload.form === "conditional" ? (
        <p className={lead}>
          <span className="text-muted-foreground">{t("f_accept")}</span> {payload.accept} <span className="text-muted-foreground">{t("f_provided").toLowerCase()}</span> {payload.provided}
        </p>
      ) : (
        <p className={lead}><span className="chip me-2 align-[1px]">{t("br_unresolved")}</span>{payload.point}</p>
      );
    case "question":
      return (
        <div className="space-y-1">
          <p className={lead}>{payload.question}</p>
          {!compact && <Row k={t("br_research")} v={payload.research} />}
        </div>
      );
    default:
      return <p className={lead}>{text}</p>;
  }
}

/** The room's combined answer: a hairline bar and one quiet line. Never who chose what.
 *  Rooms under seven seats get levels only: the strongest category present, never numbers. */
export function SupportLine({ support, showReasons, quiet }: { support: SupportView | null | undefined; showReasons?: boolean; quiet?: boolean }) {
  const { t } = useI18n();
  if (!support) return null;
  // Quiet: full consensus is the expected case, so it is stated in plain muted
  // text. The bar and colour are kept for reservations and objections.
  if (quiet && support.level === "full") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="support-line" data-detail={isCountsView(support) ? "counts" : "levels"}>
        {isCountsView(support)
          ? <>{t("sup_full")} · {t("sup_counts", { full: support.full, res: support.reservations, obj: support.objection })}</>
          : t("lv_full")}
      </p>
    );
  }
  const tone = support.level === "objection" ? "text-destructive" : support.level === "reservations" ? "text-[hsl(var(--warn))]" : "text-[hsl(var(--ok))]";
  const reasons = showReasons ? support.objections.filter((o) => o.reason || o.by) : [];
  const counts = isCountsView(support);
  const total = counts ? (support.full + support.reservations + support.objection || 1) : 1;
  const flags = supportFlags(support);
  return (
    <div className="space-y-1.5" data-testid="support-line" data-detail={counts ? "counts" : "levels"}>
      {counts ? (
        <div className="flex h-1 w-full max-w-[10rem] overflow-hidden rounded-sm bg-foreground/[0.06]" aria-hidden>
          <span style={{ width: `${(support.full / total) * 100}%` }} className="bg-[hsl(var(--ok))]" />
          <span style={{ width: `${(support.reservations / total) * 100}%` }} className="bg-[hsl(var(--warn))]" />
          <span style={{ width: `${(support.objection / total) * 100}%` }} className="bg-destructive" />
        </div>
      ) : (
        // Levels only: one segment per category present, equal widths, so the bar says nothing about how many.
        <div className="flex gap-0.5 h-1 w-full max-w-[10rem]" aria-hidden>
          <span className="flex-1 rounded-sm bg-[hsl(var(--ok))]" />
          {flags.reservations && <span className="flex-1 rounded-sm bg-[hsl(var(--warn))]" />}
          {flags.objection && <span className="flex-1 rounded-sm bg-destructive" />}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {counts ? (
          <>
            <span className={tone}>{t(`sup_${support.level}`)}</span>
            <span> · {t("sup_counts", { full: support.full, res: support.reservations, obj: support.objection })}</span>
          </>
        ) : (
          <span className={tone} title={t("lv_note")}>
            {t(support.level === "objection" && flags.reservations ? "lv_objection_res" : `lv_${support.level}`)}
          </span>
        )}
      </p>
      {reasons.map((o, i) => (
        <p key={i} className="text-xs text-muted-foreground text-pretty">
          {o.by ? <span className="text-foreground/80">{o.by}: </span> : null}{o.reason}
        </p>
      ))}
    </div>
  );
}

export function thresholdLabel(t: (k: string) => string, th: string | null | undefined) {
  return t(`th_${th === "super75" || th === "super66" ? th : "consensus"}`);
}

/** Quiet chips: the room's tier and how it seals. Shown to everyone. */
export function RoomRuleChips({ tier, seatCap, turnSeconds, threshold }: {
  tier?: string | null; seatCap?: number | null; turnSeconds?: number | null; threshold?: string | null;
}) {
  const { t } = useI18n();
  return (
    <>
      {tier && (
        <span className="chip hidden md:inline-flex" data-testid="chip-tier">
          {t(`tier_${tier}`)}{seatCap ? ` · ${seatCap}` : ""}{turnSeconds ? ` · ${formatMinutes(turnSeconds)}` : ""}
        </span>
      )}
      <span className="chip" data-testid="chip-threshold" title={`${t(`th_${threshold === "super75" || threshold === "super66" ? threshold : "consensus"}_line`)} ${t("th_note")}`}>
        {t("th_chip", { rule: thresholdLabel(t, threshold).toLowerCase() })}
      </span>
    </>
  );
}

/** The sealed record, grouped by section, as the room approved it. */
export function SealedRecord({ doc }: { doc: LedgerDocV2 }) {
  const { t } = useI18n();
  const groups = RECORD_KINDS.map((k) => ({ k, items: doc.items.filter((i) => i.kind === k) })).filter((g) => g.items.length);
  const legacy = doc.items.filter((i) => !(RECORD_KINDS as readonly string[]).includes(i.kind));
  // When nothing drew a reservation or an objection, say so once instead of
  // under every item. Any exception keeps its own line, in full.
  const withSupport = doc.items.filter((i) => i.support);
  const allFull = withSupport.length > 0 && withSupport.length === doc.items.length && withSupport.every((i) => i.support!.level === "full");
  return (
    <div className="space-y-8" data-testid="sealed-record">
      {doc.summary && (
        <section>
          <h3 className="section-title mb-1.5">{t("br_summary")}</h3>
          <p className="text-lg leading-snug text-foreground text-pretty max-w-[60ch]">{doc.summary.agreements}</p>
        </section>
      )}
      {allFull && <p className="text-sm text-muted-foreground" data-testid="text-all-full">{t("sealed_all_full")}</p>}
      {groups.map(({ k, items }) => (
        <section key={k}>
          <h3 className="section-title pb-2 flex items-baseline gap-2">
            {t(`rk_${k}`)}<span className="section-count">{items.length}</span>
          </h3>
          <ul className="divide-line border-y border-border">
            {items.map((i) => (
              <li key={i.id} className="py-3.5 space-y-2">
                <RecordBody kind={i.kind} payload={i.payload as AnyPayload} text={i.text} />
                {(!allFull || i.carriedFrom) && (
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    {!allFull && <SupportLine support={i.support} showReasons quiet />}
                    {i.carriedFrom && <span className="text-xs text-muted-foreground">{t("rec_carried", { code: i.carriedFrom })}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {legacy.length > 0 && (
        <section>
          <h3 className="section-title pb-2 flex items-baseline gap-2">
            {t("led_record")}<span className="section-count">{legacy.length}</span>
          </h3>
          <ul className="divide-line border-y border-border">
            {legacy.map((i) => (
              <li key={i.id} className="py-3.5">
                <p className="text-xs text-muted-foreground">{kindLabel(t, i.kind)}{i.agenda ? ` · ${i.agenda}` : ""}</p>
                <p className="mt-1 text-[0.9375rem] leading-relaxed text-pretty whitespace-pre-wrap">{i.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function parseSealed(json: string | null | undefined): LedgerDocV2 | null {
  if (!json) return null;
  try { const d = JSON.parse(json); return d?.ledgerVersion === 2 ? d : null; } catch { return null; }
}

export function briefUrl(base: (p: string) => string, code: string, lang: string) {
  return base(`/api/public/ledger/${code}/brief.html?lang=${lang}`);
}
