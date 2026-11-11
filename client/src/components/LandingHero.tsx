import { useLocation } from "wouter";
import { ArrowRight, KeyRound, Play, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStartDemo } from "@/components/vault";
import { WorkflowPreview } from "./WorkflowPreview";

export interface LandingHeroProps {
  demo: ReturnType<typeof useStartDemo>;
}

export function LandingHero({ demo }: LandingHeroProps) {
  const { t } = useI18n();
  const [, navigate] = useLocation();

  return (
    <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-10 lg:py-16">
      {/* Soft cinematic ambient radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-10 -z-10 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-0 -z-10 h-[400px] w-[400px] rounded-full bg-sky-500/[0.03] blur-[100px]"
      />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-start">
        {/* Left Column (5 Cols): Balanced Headline, CTAs, and Trust Metric Pill */}
        <div className="lg:col-span-5 min-w-0 lg:pt-3 space-y-6">
          {/* Eyebrow Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-[#111317] text-xs font-medium text-neutral-300 shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.06)]">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            <span>{t("home_status")}</span>
          </div>

          {/* Headline with cinematic scale */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.08] text-balance">
            {t("entry_title")}
          </h1>

          {/* Supporting Copy */}
          <p className="text-neutral-300 text-base sm:text-lg leading-relaxed max-w-lg text-pretty">
            {t("entry_value_plain")}
          </p>

          {/* Audience Context */}
          <p className="text-xs sm:text-sm text-neutral-400 max-w-lg text-pretty">
            {t("home_audience")}
          </p>

          {/* Primary & Secondary Action CTAs */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            {demo.available ? (
              <>
                <button
                  type="button"
                  data-testid="button-hero-demo"
                  onClick={() => demo.start("participant")}
                  disabled={!!demo.busy}
                  className="bg-white text-black hover:bg-neutral-200 font-medium px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2 shadow-sm shadow-white/5 hover:ring-2 hover:ring-white/20 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)]"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>{demo.busy === "participant" ? t("demo_starting") : t("entry_cta_demo")}</span>
                </button>
                <button
                  type="button"
                  data-testid="button-hero-apply"
                  onClick={() => navigate("/facilitate?mode=apply")}
                  className="border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-200 hover:text-white font-medium px-4 py-2.5 rounded-lg text-sm transition-all hover:ring-2 hover:ring-neutral-700/40 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                >
                  <span>{t("apply_access")}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="button-hero-apply"
                  onClick={() => navigate("/facilitate?mode=apply")}
                  className="bg-white text-black hover:bg-neutral-200 font-medium px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2 shadow-sm shadow-white/5 hover:ring-2 hover:ring-white/20 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)]"
                >
                  <span>{t("apply_access")}</span>
                </button>
                <button
                  type="button"
                  data-testid="button-hero-verify"
                  onClick={() => navigate("/verify")}
                  className="border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-200 hover:text-white font-medium px-4 py-2.5 rounded-lg text-sm transition-all hover:ring-2 hover:ring-neutral-700/40 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                >
                  <span>{t("demo_brief_verify_fallback")}</span>
                </button>
              </>
            )}
          </div>

          {/* Secondary Invite Code Access */}
          <div className="pt-1">
            <button
              type="button"
              data-testid="link-hero-invite"
              onClick={() => navigate("/join")}
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-neutral-400 hover:text-white transition-colors group"
            >
              <KeyRound className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
              <span>{t("entry_have_invite")}</span>
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
            </button>
          </div>

          {/* Vertical Balance: Trust and Ratification Metric Strip */}
          <div className="pt-4 border-t border-neutral-800/60 grid grid-cols-2 gap-4 text-xs font-mono">
            <div className="rounded-lg p-2.5 bg-[#111317]/80 border border-neutral-800/80 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <span className="text-neutral-400 block text-[0.6875rem]">Ephemeral Memory</span>
              <span className="text-white font-medium">Zero Disk Logs</span>
            </div>
            <div className="rounded-lg p-2.5 bg-[#111317]/80 border border-neutral-800/80 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <span className="text-neutral-400 block text-[0.6875rem]">Ledger Ratification</span>
              <span className="text-emerald-400 font-medium">Consensus Sealed</span>
            </div>
          </div>
        </div>

        {/* Right Column (7 Cols): Interactive Workflow Preview */}
        <div className="lg:col-span-7 min-w-0">
          <WorkflowPreview demo={demo} />
        </div>
      </section>
    </div>
  );
}
