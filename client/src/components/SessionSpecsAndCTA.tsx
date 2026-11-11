import { useLocation } from "wouter";
import { ArrowRight, Play, ShieldAlert, Lock, FileText, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStartDemo } from "@/components/vault";
import type { LegalId } from "@/lib/legal";

function openLegal(id: LegalId) {
  const next = new URL(window.location.href);
  next.searchParams.set("legal", id);
  window.history.pushState(window.history.state, "", next.href);
  window.dispatchEvent(new Event("popstate"));
}

export interface SessionSpecsAndCTAProps {
  demo: ReturnType<typeof useStartDemo>;
}

export function SessionSpecsAndCTA({ demo }: SessionSpecsAndCTAProps) {
  const { t } = useI18n();
  const [, navigate] = useLocation();

  const apply = (primary: boolean) => (
    <button
      key="apply"
      type="button"
      data-testid="button-bottom-apply"
      onClick={() => navigate("/facilitate?mode=apply")}
      className={
        primary
          ? "bg-white text-black hover:bg-neutral-200 px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm"
          : "border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
      }
    >
      <span>{t("apply_access")}</span>
    </button>
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-16 sm:py-20 space-y-20 sm:space-y-24">
      {/* SECTION 1: How a session works (3-Column Bento Grid) */}
      <section aria-labelledby="workflow-h" data-testid="section-workflow" className="space-y-6">
        <h2 id="workflow-h" className="text-2xl font-semibold tracking-tight text-white">
          {t("wf_heading")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {([
            ["01", "wf_1_h", "wf_1_p"],
            ["02", "wf_2_h", "wf_2_p"],
            ["03", "wf_3_h", "wf_3_p"],
          ] as const).map(([num, h, p]) => (
            <div
              key={h}
              className="rounded-xl border border-neutral-800/80 bg-[#0e1014] p-6 hover:border-neutral-700 transition-all flex flex-col justify-between group shadow-sm"
            >
              <div>
                <span className="font-mono text-xs font-medium text-neutral-400 bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-md w-fit mb-4 block group-hover:border-neutral-700 transition-colors">
                  {num}
                </span>
                <h3 className="text-base font-medium text-white mb-2 tracking-tight">
                  {t(h)}
                </h3>
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed text-pretty mt-2">
                {t(p)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2: What carries forward, and its limits (Card Matrix + Policy Pill Bar) */}
      <section aria-labelledby="trust-boundary-h" data-testid="section-privacy-limits" className="space-y-6">
        <h2 id="trust-boundary-h" className="text-2xl font-semibold tracking-tight text-white">
          {t("home_trust_h")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Ephemeral Messages */}
          <div className="rounded-xl border border-neutral-800/80 bg-[#0e1014] p-6 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Memory-only
                </span>
              </div>
              <h3 className="text-base font-medium text-white mb-2 tracking-tight">
                {t("home_msg_h")}
              </h3>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed text-pretty mt-2">
              {t("home_msg_p")}
            </p>
          </div>

          {/* Card 2: Approved Ledger */}
          <div className="rounded-xl border border-neutral-800/80 bg-[#0e1014] p-6 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-400">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                  Participant-ratified
                </span>
              </div>
              <h3 className="text-base font-medium text-white mb-2 tracking-tight">
                {t("home_ledger_h")}
              </h3>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed text-pretty mt-2">
              {t("home_ledger_p")}
            </p>
          </div>

          {/* Card 3: Limits & Guardrails (Subtle Warning Surface) */}
          <div className="rounded-xl border border-amber-900/30 bg-[#12100d] p-6 hover:border-amber-800/50 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="p-2 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-400">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold">
                  Scope boundaries
                </span>
              </div>
              <h3 className="text-base font-medium text-white mb-2 tracking-tight">
                {t("home_limits_h")}
              </h3>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed text-pretty mt-2">
              {t("home_limits_p")}
            </p>
          </div>
        </div>

        {/* Audit Warning & Policy Links Utility Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 mt-6">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-neutral-300" data-testid="text-maturity">
            <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>{t("home_status")}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <button
              type="button"
              data-testid="link-trust-privacy"
              onClick={() => openLegal("privacy")}
              className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors"
            >
              <span>{t("footer_privacy")}</span>
              <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="link-trust-orgs"
              onClick={() => navigate("/organisations?section=process")}
              className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors"
            >
              <span>{t("home_link_approval")}</span>
              <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="link-trust-security"
              onClick={() => openLegal("security")}
              className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors"
            >
              <span>{t("footer_security")}</span>
              <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 3: Bottom Action Banner (Elevated Callout Card) */}
      <section className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-[#12141a] to-[#0a0b0e] p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <h2 className="text-xl sm:text-2xl font-medium text-white tracking-tight text-center md:text-left text-pretty max-w-xl">
          {t("entry_closing_line")}
        </h2>

        <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 shrink-0 w-full md:w-auto">
          {demo.available ? (
            <>
              <button
                type="button"
                data-testid="button-bottom-demo"
                onClick={() => demo.start("participant")}
                disabled={!!demo.busy}
                className="bg-white text-black hover:bg-neutral-200 px-5 py-2.5 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2 shadow-sm"
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>{demo.busy === "participant" ? t("demo_starting") : t("entry_cta_demo")}</span>
              </button>
              {apply(false)}
            </>
          ) : (
            <>
              {apply(true)}
              <button
                type="button"
                data-testid="button-bottom-verify"
                onClick={() => navigate("/verify")}
                className="border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
              >
                <span>{t("demo_brief_verify_fallback")}</span>
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
