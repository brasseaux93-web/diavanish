import { useEffect } from "react";
import { Mail, ArrowRight, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { CONTACT_EMAIL } from "@shared/contact";
import { useI18n } from "@/lib/i18n";
import { Shell, useStartDemo } from "@/components/vault";

const USES = ["ombuds", "workplace", "labor", "rj"] as const;
const FACTS = ["kept", "not_kept", "human", "selfhost"] as const;

const FAQ_ITEMS = [
  { q: "faq_1_q", a: "faq_1_a" },
  { q: "faq_2_q", a: "faq_2_a" },
  { q: "faq_3_q", a: "faq_3_a" },
  { q: "faq_4_q", a: "faq_4_a" },
  { q: "faq_5_q", a: "faq_5_a" },
  { q: "faq_6_q", a: "faq_6_a" },
  { q: "faq_7_q", a: "faq_7_a" },
] as const;

const LIMIT_ITEMS = [
  { h: "limit_1_h", p: "limit_1_p" },
  { h: "limit_2_h", p: "limit_2_p" },
  { h: "limit_3_h", p: "limit_3_p" },
  { h: "limit_4_h", p: "limit_4_p" },
] as const;

const STATUS_ITEMS = [
  { h: "status_maturity_h", p: "status_maturity_p" },
  { h: "status_operator_h", p: "status_operator_p" },
  { h: "status_contact_h", p: "status_contact_p" },
  { h: "status_docs_h", p: "status_docs_p" },
] as const;

function sectionTarget(): string | null {
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  const hashParams = qi >= 0 ? new URLSearchParams(hash.slice(qi + 1)) : null;
  const searchParams = new URLSearchParams(window.location.search);
  const s = hashParams?.get("section") || searchParams.get("section");
  if (s === "process") return "org-faq-h";
  if (s === "operator") return "org-status-h";
  if (s === "limits") return "org-limits-h";
  return null;
}

export default function Organisations() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const demo = useStartDemo();

  useEffect(() => {
    const scrollIfRequested = () => {
      const id = sectionTarget();
      if (!id) return;
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      });
    };
    scrollIfRequested();
    window.addEventListener("hashchange", scrollIfRequested);
    window.addEventListener("popstate", scrollIfRequested);
    return () => {
      window.removeEventListener("hashchange", scrollIfRequested);
      window.removeEventListener("popstate", scrollIfRequested);
    };
  }, []);

  return (
    <Shell wide>
      <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-10 lg:py-16 space-y-20 sm:space-y-24">
        {/* Soft cinematic ambient radial glow */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-10 -z-10 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
        
        {/* Hero Section */}
        <section className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-[#111317] text-xs font-medium text-neutral-300 shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.06)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="font-mono uppercase tracking-wider text-[11px] text-neutral-300">{t("nav_orgs")}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.08] text-balance" data-testid="text-org-title">
            {t("org_title")}
          </h1>
          <p className="text-base sm:text-lg text-neutral-300 leading-relaxed text-pretty max-w-2xl">{t("org_lede")}</p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              data-testid="link-org-contact"
              className="bg-white text-black hover:bg-neutral-200 font-medium px-5 py-2.5 rounded-lg text-sm transition-all inline-flex items-center gap-2 shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)]"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />{t("org_contact")}
            </a>
            <button
              type="button"
              data-testid="button-org-apply"
              onClick={() => navigate("/facilitate?mode=apply")}
              className="border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2"
            >
              <span>{t("apply_access")}</span>
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            </button>
            {demo.available && (
              <button
                data-testid="button-org-demo"
                onClick={() => demo.start("facilitator")}
                disabled={!!demo.busy}
                className="text-xs text-neutral-400 hover:text-white transition-colors ms-2"
              >
                {demo.busy ? t("demo_starting") : t("org_try")}
              </button>
            )}
          </div>
          <p className="text-xs font-mono text-neutral-400">
            Direct registry contact: <span className="select-all text-neutral-200" data-testid="text-org-email">{CONTACT_EMAIL}</span>
          </p>
        </section>

        {/* SECTION 1: Primary Use Cases (4-Column Bento Grid) */}
        <section aria-labelledby="org-uses-h" className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">PRACTICE AREAS /</span>
            <h2 id="org-uses-h" className="text-xl sm:text-2xl font-semibold tracking-tight text-white">{t("org_uses")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {USES.map((key) => (
              <div
                key={key}
                className="rounded-xl border border-neutral-800/80 bg-[#0e1014] p-5 hover:border-neutral-700 transition-all flex flex-col justify-between group shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]"
              >
                <div>
                  <h3 className="text-base font-semibold text-white tracking-tight mb-2 group-hover:text-emerald-400 transition-colors">
                    {t(`org_${key}`)}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed text-pretty">
                    {t(`org_${key}_d`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 2: Architecture & Trust Guarantees (4-Column Bento Grid) */}
        <section aria-labelledby="org-facts-h" className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">GUARANTEES /</span>
            <h2 id="org-facts-h" className="text-xl sm:text-2xl font-semibold tracking-tight text-white">{t("org_facts")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FACTS.map((key) => (
              <div
                key={key}
                className="rounded-xl border border-neutral-800/80 bg-[#0e1014] p-5 hover:border-neutral-700 transition-all flex flex-col justify-between group shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]"
              >
                <div>
                  <h3 className="text-base font-semibold text-white tracking-tight mb-2 group-hover:text-amber-400 transition-colors">
                    {t(`org_${key}`)}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed text-pretty">
                    {t(`org_${key}_d`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 3: Agreement Rules & Edge Cases */}
        <section className="pt-8 border-t border-neutral-800/80 space-y-6" aria-labelledby="org-faq-h" data-testid="section-agreement-faq">
          <div className="max-w-2xl space-y-2">
            <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">RATIFICATION GOVERNANCE /</span>
            <h2 id="org-faq-h" className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              {t("entry_agreement_title")}
            </h2>
            <p className="text-sm text-neutral-400 leading-relaxed text-pretty">
              {t("entry_agreement_body")}
            </p>
          </div>

          <div className="divide-y divide-neutral-800/80 border-y border-neutral-800/80 rounded-2xl bg-[#0e1014] px-6 py-2 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]">
            {FAQ_ITEMS.map((item, idx) => (
              <details key={item.q} className="disclose py-4 group" data-testid={`faq-item-${idx + 1}`}>
                <summary className="text-sm font-medium text-white cursor-pointer hover:text-emerald-400 transition-colors list-none flex items-center justify-between">
                  <span>{t(item.q)}</span>
                  <span className="text-xs font-mono text-neutral-500 group-open:rotate-90 transition-transform">→</span>
                </summary>
                <p className="mt-3 text-xs sm:text-sm text-neutral-400 leading-relaxed text-pretty">
                  {t(item.a)}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* SECTION 4: Operational Limits & Status Spec-Sheet (2-Column Bento Grid) */}
        <div className="pt-8 border-t border-neutral-800/80 relative">
          {/* The Ambient Glow */}
          <div className="absolute bottom-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none -z-10" />

          {/* The 2-Column Bento Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* CARD 1: Privacy */}
            <div className="bg-[#0c0d11] border border-neutral-800/80 rounded-2xl p-8 sm:p-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-2">LIMITS & BOUNDARIES /</div>
              <h3 id="org-limits-h" className="text-xl font-medium text-white mb-8">Privacy and its limits</h3>

              <div className="flex flex-col gap-2">
                {/* Spec-Sheet Row 1 */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5 border-b border-neutral-800/50">
                  <div className="w-full sm:w-40 shrink-0 pt-0.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Screenshots & recording</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-neutral-300 leading-relaxed">Diavanish cannot stop a participant or facilitator from copying text, taking screenshots, photographing their screen, or recording outside the browser.</p>
                  </div>
                </div>

                {/* Spec-Sheet Row 2 */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5 border-b border-neutral-800/50">
                  <div className="w-full sm:w-40 shrink-0 pt-0.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Retained SQLite logs</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-neutral-300 leading-relaxed">The server stores room titles, codes, pseudonyms, roles, and hashed invites. HTTP logs record API paths and duration without IP addresses.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 2: Project Maturity */}
            <div className="bg-[#0c0d11] border border-neutral-800/80 rounded-2xl p-8 sm:p-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-2">PROJECT MATURITY /</div>
              <h3 id="org-status-h" className="text-xl font-medium text-white mb-8">Status and accountability</h3>

              <div className="flex flex-col gap-2">
                {/* Spec-Sheet Row 1 */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5 border-b border-neutral-800/50">
                  <div className="w-full sm:w-40 shrink-0 pt-0.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Unaudited status</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-neutral-300 leading-relaxed">Diavanish v1.0.0 is prelaunch software. No independent third-party security audit has been published yet.</p>
                  </div>
                </div>

                {/* Spec-Sheet Row 2 */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5 border-b border-neutral-800/50">
                  <div className="w-full sm:w-40 shrink-0 pt-0.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Open source</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-neutral-300 leading-relaxed">Run from a single Docker container on your own infrastructure, inspect the threat model, or verify a live build.</p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-neutral-800/50 mt-4">
                <a
                  href="https://github.com/brasseaux93-web/aperture-v2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-white transition-colors"
                >
                  <span>{t("legal_opensource_repo")}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            </div>

          </div>

          {/* Anchored Bottom Disclaimer */}
          <div className="mt-12 p-6 sm:p-8 rounded-xl border border-neutral-800/60 bg-[#0a0b0e] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] flex items-start gap-4" data-testid="text-org-legal">
            <div className="w-2 h-2 mt-2 rounded-full bg-emerald-500/50 shrink-0" />
            <p className="text-sm text-neutral-400 leading-relaxed">
              Diavanish reduces what conversation text exists on the server, but approved records, retained metadata, and any copies or screenshots made by participants may still be subject to legal disclosure or subpoena. Using Diavanish does not create legal privilege on its own.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
