import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Check, Clock, ExternalLink, KeyRound, Play } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Shell, StatusDot, useStartDemo } from "@/components/vault";
import { RecordBody, SupportLine } from "@/components/ledger/record";
import type { LegalId } from "@/lib/legal";

function openLegal(id: LegalId) {
  const next = new URL(window.location.href);
  next.searchParams.set("legal", id);
  window.history.pushState(window.history.state, "", next.href);
  window.dispatchEvent(new Event("popstate"));
}

/** 0 = discuss, 1 = entries proposed and awaiting approval, 2 = approved and proposal brief available. */
type Stage = 0 | 1 | 2;

/**
 * The homepage demonstration: one fictional, clearly labelled dialogue.
 * It opens on the finished sequence so the page explains itself without any
 * interaction. Stepping back to "Approve" lets a visitor press the approval
 * action themselves; nothing approves on its own and nothing animates by timer.
 * The detailed workflow lives in the sample rooms ("Explore a sample").
 */
function HeroDemo({ demo }: { demo: ReturnType<typeof useStartDemo> }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<Stage>(2);
  const approved = stage === 2;

  const stages: { id: Stage; label: string }[] = [
    { id: 0, label: t("home_demo_stage_discuss") },
    { id: 1, label: t("home_demo_stage_approve") },
    { id: 2, label: t("home_demo_stage_develop") },
  ];
  const srText = [t("home_demo_sr_discuss"), t("home_demo_sr_approve"), t("home_demo_sr_develop")][stage];
  const agreementPayload = {
    action: t("home_demo_principle"),
    owner: t("home_demo_owner"),
    deadline: t("home_demo_deadline"),
    measure: t("home_demo_measure"),
    resources: "",
  };
  const questionPayload = {
    question: t("home_demo_question"),
    research: "",
  };

  return (
    <section aria-labelledby="home-demo-h" className="metal min-w-0 overflow-hidden" data-testid="hero-schematic">
      {/* Header bar: scenario title and aliases note */}
      <div className="px-4 py-2.5 border-b border-border bg-[var(--surface-sunk)] flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="home-demo-h" className="text-xs font-medium text-muted-foreground">
          {t("home_demo_scenario")}
        </h2>
        <span className="text-xs text-muted-foreground" data-testid="text-demo-aliases">{t("home_demo_aliases")}</span>
      </div>

      {/* Stage selector: clean tabs on a hairline; wraps cleanly on narrow phones so no label clips */}
      <div className="px-4 pt-2.5 flex items-center justify-between gap-2 border-b border-border/60">
        <div
          role="group"
          aria-label={t("home_demo_stage_label")}
          className="segmented segmented-box max-sm:w-full max-sm:flex-wrap max-sm:gap-1 max-sm:mb-2.5 max-sm:[&>button]:flex-1 max-sm:[&>button]:min-w-[5.5rem] max-sm:[&>button]:whitespace-normal max-sm:[&>button]:text-center max-sm:[&>button]:justify-center max-sm:[&>button]:leading-tight max-sm:[&>button]:py-1.5 max-sm:[&>button]:px-2"
          data-testid="demo-stages"
        >
          {stages.map((s) => {
            const locked = s.id === 2 && !approved;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={stage === s.id}
                aria-disabled={locked || undefined}
                title={locked ? t("home_demo_stage_locked") : undefined}
                data-testid={`button-demo-stage-${s.id}`}
                className="aria-disabled:cursor-not-allowed aria-disabled:hover:!text-muted-foreground"
                onClick={() => { if (!locked) setStage(s.id); }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{srText}</p>

      <div className="p-4 sm:p-5 space-y-3">
        {/* 1. Conversation strip: compact dialogue held ephemeral in memory */}
        <div
          className={`rounded-md p-3 transition-colors duration-200 motion-reduce:transition-none ${
            stage === 0
              ? "bg-[var(--surface-sunk)] border border-[hsl(var(--primary)/0.45)]"
              : "bg-[var(--surface-sunk)]/80 border border-border/60"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-xs font-semibold text-[hsl(var(--seal))]">{t("home_demo_fac")}</span>
              <span className="text-xs text-muted-foreground">{t("home_demo_label_dialogue")}</span>
            </div>
            <span className="chip text-[0.6875rem] py-0 min-h-[1.25rem]">{t("home_demo_ephemeral")}</span>
          </div>
          <p className="mt-1 text-sm leading-snug text-foreground text-pretty font-normal">{t("home_demo_prompt")}</p>

          <div className="mt-2 pt-2 border-t border-border/40 grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <span className="font-medium text-foreground/85 block">{t("home_demo_da")}</span>
              <p className="text-pretty leading-relaxed text-foreground/75">{t("home_demo_a")}</p>
            </div>
            <div className="min-w-0">
              <span className="font-medium text-foreground/85 block">{t("home_demo_db")}</span>
              <p className="text-pretty leading-relaxed text-foreground/75">{t("home_demo_b")}</p>
            </div>
          </div>
        </div>

        {/* 2. Dominant Ledger Card: the participant-approved foundation */}
        <div
          className={`rounded-lg p-4 sm:p-5 transition-colors duration-200 motion-reduce:transition-none ${
            stage === 1
              ? "bg-[var(--slate-card)] border-2 border-[hsl(var(--primary)/0.55)]"
              : "bg-[var(--slate-card)] border border-border"
          }`}
          data-testid="demo-ledger"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
              <span className="text-[0.6875rem] tracking-wider uppercase font-semibold text-muted-foreground">
                {t("home_demo_ledger_label")}
              </span>
              <span className="text-muted-foreground/40 font-mono text-xs" aria-hidden>/</span>
              <h3 className="font-display font-semibold text-base sm:text-[1.0625rem] text-ivory tracking-tight">
                {t("home_demo_ledger_title")}
              </h3>
            </div>
            <span className="chip text-[0.6875rem] min-h-[1.25rem]">{t("th_consensus")}</span>
          </div>

          <div key={String(approved)} className="page-enter space-y-2.5">
            {/* Approved agreement: real structured record component + levels-only consent (<7 seats) */}
            <div
              className={`rounded-md p-3 sm:p-3.5 transition-colors ${
                approved
                  ? "bg-[hsl(var(--primary)/0.08)] border border-[hsl(var(--primary)/0.35)]"
                  : "bg-[var(--surface-sunk)] border border-border/80"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("rk1_agreement")}</span>
                <span data-testid="demo-principle-status">
                  {approved ? (
                    <span className="chip chip-ok text-xs font-medium">
                      <Check className="h-3 w-3" aria-hidden />
                      <span>{t("approved")}</span>
                    </span>
                  ) : (
                    <span className="chip chip-warn text-xs font-medium">
                      <Clock className="h-3 w-3" aria-hidden />
                      <span>{t("home_demo_pending")}</span>
                    </span>
                  )}
                </span>
              </div>
              <RecordBody kind="agreement" payload={agreementPayload} text="" />
              {approved && (
                <div className="mt-2.5 pt-2.5 border-t border-border/50">
                  <SupportLine support={{ level: "full", withReservations: false, withObjection: false, objections: [] }} />
                </div>
              )}
            </div>

            {/* Unresolved question: clearly distinguished with dashed border */}
            <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-transparent p-3" data-testid="demo-question">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-muted-foreground">{t("home_demo_question_label")}</span>
                <span className="chip text-[0.6875rem] min-h-[1.375rem]">
                  {approved ? t("rec_on_record") : t("home_demo_pending")}
                </span>
              </div>
              <RecordBody kind="question" payload={questionPayload} text="" compact />
              {approved && (
                <p className="mt-1.5 text-xs text-muted-foreground text-pretty">
                  {t("home_demo_unresolved_note")}
                </p>
              )}
            </div>
          </div>

          {stage === 1 && (
            <div className="mt-3.5 pt-3 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                data-testid="button-demo-approve"
                onClick={() => setStage(2)}
                className="signin-btn hero-cta cta-primary"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                <span>{t("home_demo_approve_btn")}</span>
              </button>
              <p className="text-xs text-muted-foreground max-w-[36ch] text-pretty">{t("home_demo_approve_note")}</p>
            </div>
          )}
        </div>

        {/* 3. Deliberate directional connector: links approved ledger directly to brief */}
        <div className="flex items-center gap-2.5 ps-4 py-0.5" data-testid="demo-link-cue">
          <div className="flex items-center text-[hsl(var(--primary))]">
            <span
              aria-hidden
              className={`block w-px h-5 transition-colors duration-200 motion-reduce:transition-none ${
                approved ? "bg-[hsl(var(--primary))]" : "bg-foreground/20"
              }`}
            />
            <span
              aria-hidden
              className={`block w-2 h-px transition-colors duration-200 motion-reduce:transition-none ${
                approved ? "bg-[hsl(var(--primary))]" : "bg-foreground/20"
              }`}
            />
          </div>
          <span className="text-[0.6875rem] uppercase tracking-wider font-medium text-muted-foreground">
            {t("home_demo_from")}
          </span>
        </div>

        {/* 4. Proposal brief preview (typeset strictly from sealed approved ledger) */}
        <div
          className={`rounded-lg p-3.5 sm:p-4 transition-colors duration-200 motion-reduce:transition-none ${
            approved
              ? "bg-[var(--slate-raised)] border border-[hsl(var(--primary)/0.3)]"
              : "bg-[var(--slate-raised)]/70 border border-border/60"
          }`}
          data-testid="demo-proposal"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="font-display font-medium text-sm sm:text-base text-foreground flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground font-semibold">
                {t("home_demo_doc_label")}
              </span>
              <span className="text-muted-foreground/40 font-mono text-xs" aria-hidden>/</span>
              <span>{t("home_demo_doc_title")}</span>
            </h3>
            <span className="text-xs text-muted-foreground">{t("home_demo_doc_status")}</span>
          </div>

          <div key={String(approved)} className="page-enter mt-2">
            {approved ? (
              <>
                <div className="divide-y divide-border/60 border-t border-border/60 text-xs">
                  <div className="py-2 grid sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground font-medium">{t("home_demo_sec_conditions")}</span>
                    <span className="text-foreground text-pretty">{t("home_demo_sec_conditions_p")}</span>
                  </div>
                  <div className="py-2 grid sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground font-medium">{t("home_demo_sec_resp")}</span>
                    <span className="text-foreground/90 text-pretty">{t("home_demo_sec_resp_p")}</span>
                  </div>
                  <div className="py-2 grid sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground font-medium">{t("home_demo_sec_open")}</span>
                    <span className="text-foreground/85 text-pretty">{t("home_demo_sec_open_p")}</span>
                  </div>
                </div>
                <div className="mt-2 pt-2.5 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{t("home_demo_brief_note")}</span>
                  <button
                    type="button"
                    data-testid="button-demo-brief-link"
                    onClick={() => (demo.available ? demo.start("verifier") : navigate("/verify"))}
                    disabled={!!demo.busy}
                    className="link-quiet text-xs"
                  >
                    <span>
                      {demo.busy === "verifier"
                        ? t("demo_starting")
                        : demo.available
                          ? t("home_demo_sample_link")
                          : t("verify_nav")}
                    </span>
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              </>
            ) : (
              <p className="py-2 border-t border-dashed border-[var(--line-strong)] text-xs text-muted-foreground" data-testid="demo-proposal-wait">
                {t("home_demo_doc_wait")}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The same two actions in the hero and the closing. Readiness decides the primary one. */
function HomeActions({ demo, prefix }: { demo: ReturnType<typeof useStartDemo>; prefix: "hero" | "bottom" }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const apply = (primary: boolean) => (
    <button
      key="apply"
      type="button"
      data-testid={`button-${prefix}-apply`}
      onClick={() => navigate("/facilitate?mode=apply")}
      className={`signin-btn hero-cta${primary ? " cta-primary" : ""}`}
    >
      <span>{t("apply_access")}</span>
    </button>
  );
  if (demo.available) {
    return (
      <>
        <button
          type="button"
          data-testid={`button-${prefix}-demo`}
          onClick={() => demo.start("participant")}
          disabled={!!demo.busy}
          className="signin-btn hero-cta cta-primary"
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
          <span>{demo.busy === "participant" ? t("demo_starting") : t("entry_cta_demo")}</span>
        </button>
        {apply(false)}
      </>
    );
  }
  return (
    <>
      {apply(true)}
      <button
        type="button"
        data-testid={`button-${prefix}-verify`}
        onClick={() => navigate("/verify")}
        className="signin-btn hero-cta"
      >
        <span>{t("demo_brief_verify_fallback")}</span>
      </button>
    </>
  );
}

export default function Entry() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const demo = useStartDemo();

  return (
    <Shell wide>
      {/* 1. HERO: copy and actions on the left, one readable demonstration on the right */}
      <section className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-10 lg:gap-14 items-start">
        <div className="min-w-0 lg:pt-10">
          <h1 className="font-display font-semibold tracking-[-0.035em] leading-[1.06] text-[2rem] sm:text-[2.625rem] xl:text-[3.125rem] text-foreground">
            {t("entry_title")}
          </h1>
          <p className="mt-5 text-base sm:text-[1.125rem] text-foreground/85 text-pretty leading-relaxed max-w-[44ch]">
            {t("entry_value_plain")}
          </p>
          <p className="mt-3 text-sm text-muted-foreground text-pretty max-w-[46ch]">{t("home_audience")}</p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <HomeActions demo={demo} prefix="hero" />
          </div>
          <div className="mt-4">
            <button type="button" data-testid="link-hero-invite" onClick={() => navigate("/join")} className="link-quiet">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              <span>{t("entry_have_invite")}</span>
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            </button>
          </div>
        </div>

        <HeroDemo demo={demo} />
      </section>

      {/* 2. WORKFLOW: three stages from temporary conversation to sealed brief */}
      <section
        aria-labelledby="workflow-h"
        data-testid="section-workflow"
        className="mt-12 sm:mt-16 pt-8 border-t border-border"
      >
        <h2 id="workflow-h" className="font-display font-semibold text-lg sm:text-xl tracking-[-0.02em] text-foreground">
          {t("wf_heading")}
        </h2>
        <ol className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {([
            ["01", "wf_1_h", "wf_1_p"],
            ["02", "wf_2_h", "wf_2_p"],
            ["03", "wf_3_h", "wf_3_p"],
          ] as const).map(([num, h, p]) => (
            <li key={h} className="space-y-1 min-w-0">
              <div className="flex items-baseline gap-2.5">
                <span className="mono-data text-xs text-muted-foreground" aria-hidden>{num}</span>
                <span className="text-sm font-medium text-foreground">{t(h)}</span>
              </div>
              <p className="text-sm text-muted-foreground text-pretty leading-relaxed">{t(p)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 3. TRUST: what carries forward, and where it stops */}
      <section
        aria-labelledby="trust-boundary-h"
        data-testid="section-privacy-limits"
        className="mt-12 sm:mt-16 pt-8 border-t border-border"
      >
        <h2 id="trust-boundary-h" className="font-display font-semibold text-lg sm:text-xl tracking-[-0.02em] text-foreground">
          {t("home_trust_h")}
        </h2>

        <dl className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {([
            ["home_msg_h", "home_msg_p"],
            ["home_ledger_h", "home_ledger_p"],
            ["home_limits_h", "home_limits_p"],
          ] as const).map(([h, p]) => (
            <div key={h} className="space-y-1 min-w-0">
              <dt className="text-sm font-medium text-foreground">{t(h)}</dt>
              <dd className="text-sm text-muted-foreground text-pretty leading-relaxed">{t(p)}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 flex items-start gap-2.5 text-sm text-foreground" data-testid="text-maturity">
          <span className="mt-[0.4375rem]"><StatusDot tone="warn" /></span>
          <span>{t("home_status")}</span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1">
          <button type="button" data-testid="link-trust-privacy" onClick={() => openLegal("privacy")} className="link-quiet">
            <span>{t("footer_privacy")}</span>
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </button>
          <button type="button" data-testid="link-trust-orgs" onClick={() => navigate("/organisations?section=process")} className="link-quiet">
            <span>{t("home_link_approval")}</span>
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </button>
          <button type="button" data-testid="link-trust-security" onClick={() => openLegal("security")} className="link-quiet">
            <span>{t("footer_security")}</span>
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </button>
        </div>
      </section>

      {/* 4. CLOSING: one invitation, the same two actions */}
      <section className="mt-12 sm:mt-16 pt-8 border-t border-border pb-2 flex flex-wrap items-center justify-between gap-6">
        <h2 className="font-display font-semibold text-xl sm:text-2xl tracking-[-0.02em] text-foreground text-pretty">
          {t("entry_closing_line")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <HomeActions demo={demo} prefix="bottom" />
        </div>
      </section>
    </Shell>
  );
}
