import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Clock, ExternalLink, MessageSquare, ShieldCheck, FileCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStartDemo } from "@/components/vault";
import { RecordBody, SupportLine } from "@/components/ledger/record";

export type Stage = 0 | 1 | 2;

export interface WorkflowPreviewProps {
  demo: ReturnType<typeof useStartDemo>;
  initialStage?: Stage;
}

/**
 * State-Driven Interactive Workflow Preview Component (7-col chamber preview)
 *
 * Switches content cleanly between:
 * 0 (discuss): Ephemeral facilitator dialogue stream
 * 1 (ledger): Ratification chamber for proposed agreement and open questions
 * 2 (brief): Cryptographically sealed proposal brief table
 *
 * Height-capped (min-h-[460px] max-h-[500px]) for vertical balance with the hero CTA stack.
 */
export function WorkflowPreview({ demo, initialStage = 0 }: WorkflowPreviewProps) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<Stage>(initialStage);

  const stages: { id: Stage; label: string; icon: typeof MessageSquare }[] = [
    { id: 0, label: t("home_demo_stage_discuss"), icon: MessageSquare },
    { id: 1, label: t("home_demo_stage_approve"), icon: ShieldCheck },
    { id: 2, label: t("home_demo_stage_develop"), icon: FileCheck },
  ];

  const srText = [
    t("home_demo_sr_discuss"),
    t("home_demo_sr_approve"),
    t("home_demo_sr_develop"),
  ][stage];

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
    <section
      aria-labelledby="home-demo-h"
      data-testid="hero-schematic"
      className="rounded-2xl border border-neutral-800 bg-[#0c0d11]/95 p-5 sm:p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between min-h-[460px] max-h-[500px] min-w-0 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.08)]"
    >
      {/* Top Bar: Tabs & Stage Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-800/80">
        <div
          role="group"
          aria-label={t("home_demo_stage_label")}
          data-testid="demo-stages"
          className="inline-flex items-center gap-1 p-1 rounded-lg bg-neutral-900 border border-neutral-800 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.04)]"
        >
          {stages.map((s) => {
            const active = stage === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                data-testid={`button-demo-stage-${s.id}`}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-neutral-800 text-white shadow-sm border border-neutral-700/60 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                    : "text-neutral-400 hover:text-white"
                }`}
                onClick={() => setStage(s.id)}
              >
                <s.icon className={`h-3.5 w-3.5 ${active ? "text-emerald-400" : "text-neutral-500"}`} aria-hidden="true" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-mono tracking-tight px-2 py-0.5 rounded border border-neutral-800 bg-[#14171d] text-neutral-400"
            data-testid="text-demo-aliases"
          >
            Stage 0{stage + 1} / 03
          </span>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{srText}</p>

      {/* Main Stage View Area (Switched cleanly via state) */}
      <div className="py-4 flex-1 flex flex-col justify-center min-h-0 overflow-y-auto">
        {/* STAGE 0: Facilitator Dialogue Stream */}
        {stage === 0 && (
          <div className="space-y-3.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-neutral-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono font-medium text-amber-300 px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/50 shrink-0">
                  {t("home_demo_fac")}
                </span>
                <span className="text-xs text-neutral-300 font-medium truncate">{t("home_demo_label_dialogue")}</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono tracking-tight bg-neutral-900 border border-neutral-800 text-neutral-300 whitespace-nowrap shrink-0">
                {t("home_demo_ephemeral")}
              </span>
            </div>

            <div className="rounded-xl p-3.5 border border-neutral-800/80 bg-[#12141a] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <p className="text-sm font-normal text-neutral-100 leading-snug text-pretty">
                "{t("home_demo_prompt")}"
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="rounded-xl bg-[#14171d] p-3 border border-neutral-800/80 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.6875rem] font-semibold text-neutral-200">
                    {t("home_demo_da")}
                  </span>
                  <span className="text-[0.6875rem] font-mono text-neutral-400">t+14s</span>
                </div>
                <p className="text-neutral-300 leading-relaxed text-pretty text-[0.8125rem]">
                  {t("home_demo_a")}
                </p>
              </div>

              <div className="rounded-xl bg-[#14171d] p-3 border border-neutral-800/80 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.6875rem] font-semibold text-neutral-200">
                    {t("home_demo_db")}
                  </span>
                  <span className="text-[0.6875rem] font-mono text-neutral-400">t+31s</span>
                </div>
                <p className="text-neutral-300 leading-relaxed text-pretty text-[0.8125rem]">
                  {t("home_demo_b")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 1: Session Ledger Ratification */}
        {stage === 1 && (
          <div data-testid="demo-ledger" className="space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-neutral-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 shrink-0">
                  {t("home_demo_ledger_label")} /
                </span>
                <h3 className="font-semibold text-sm text-white tracking-tight truncate">
                  {t("home_demo_ledger_title")}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-amber-800/60 bg-amber-950/30 text-amber-300 whitespace-nowrap shrink-0">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {t("home_demo_pending")}
              </span>
            </div>

            <div className="rounded-xl p-3.5 border border-neutral-800/90 bg-[#101216] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                  {t("rk1_agreement")}
                </span>
                <span className="text-[0.6875rem] font-mono text-neutral-400">Pending 2/2 consent</span>
              </div>
              <RecordBody kind="agreement" payload={agreementPayload} text="" />
            </div>

            <div className="rounded-xl border border-dashed border-neutral-800 bg-[#14171d]/60 p-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-xs font-medium text-neutral-300 block">
                  {t("home_demo_question_label")}
                </span>
                <p className="text-xs text-neutral-300 truncate mt-0.5">{t("home_demo_question")}</p>
              </div>
              <button
                type="button"
                data-testid="button-demo-approve"
                onClick={() => setStage(2)}
                className="bg-white text-black hover:bg-neutral-200 font-medium px-4 py-2 rounded-lg text-xs transition-all flex items-center gap-1.5 shadow-sm shrink-0 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)]"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t("home_demo_approve_btn")}</span>
              </button>
            </div>
          </div>
        )}

        {/* STAGE 2: Cryptographically Sealed Proposal Brief */}
        {stage === 2 && (
          <div data-testid="demo-proposal" className="space-y-3 animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-neutral-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 shrink-0">
                  {t("home_demo_doc_label")} /
                </span>
                <h3 className="text-sm font-semibold text-white tracking-tight truncate">
                  {t("home_demo_doc_title")}
                </h3>
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-800/50 whitespace-nowrap shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t("home_demo_doc_status")}
              </span>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-[#101216] p-3.5 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]">
              <div className="divide-y divide-neutral-800/80 text-xs">
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                  <span className="font-mono text-xs uppercase tracking-wide text-neutral-400 w-36 shrink-0">
                    {t("home_demo_sec_conditions")}
                  </span>
                  <span className="text-sm text-neutral-200 text-pretty">
                    {t("home_demo_sec_conditions_p")}
                  </span>
                </div>
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                  <span className="font-mono text-xs uppercase tracking-wide text-neutral-400 w-36 shrink-0">
                    {t("home_demo_sec_resp")}
                  </span>
                  <span className="text-sm text-neutral-200 text-pretty">
                    {t("home_demo_sec_resp_p")}
                  </span>
                </div>
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                  <span className="font-mono text-xs uppercase tracking-wide text-neutral-400 w-36 shrink-0">
                    {t("home_demo_sec_open")}
                  </span>
                  <span className="text-sm text-neutral-200 text-pretty">
                    {t("home_demo_sec_open_p")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Footer Callout & Sample Verification Link */}
      <div className="pt-3.5 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
        <span className="font-mono text-[0.6875rem]">
          Sealed-ledger brief — zero chat transcript.
        </span>
        <button
          type="button"
          data-testid="button-demo-brief-link"
          onClick={() => (demo.available ? demo.start("verifier") : navigate("/verify"))}
          disabled={!!demo.busy}
          className="text-white hover:text-emerald-400 font-medium inline-flex items-center gap-1.5 transition-colors"
        >
          <span>
            {demo.busy === "verifier"
              ? t("demo_starting")
              : demo.available
                ? t("home_demo_sample_link")
                : t("verify_nav")}
          </span>
          <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
