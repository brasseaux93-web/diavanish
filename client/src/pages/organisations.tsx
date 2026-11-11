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
    <Shell>
      <section className="max-w-2xl pt-2 sm:pt-8">
        <h1 className="font-display font-semibold tracking-[-0.03em] leading-[1.08] text-[2rem] sm:text-[2.75rem]" data-testid="text-org-title">
          {t("org_title")}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-muted-foreground text-pretty max-w-[56ch]">{t("org_lede")}</p>
        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-org-contact" className="signin-btn hero-cta cta-primary">
            <Mail className="h-3.5 w-3.5" aria-hidden />{t("org_contact")}
          </a>
          <button
            type="button"
            data-testid="button-org-apply"
            onClick={() => navigate("/facilitate?mode=apply")}
            className="signin-btn hero-cta"
          >
            <span>{t("apply_access")}</span>
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </button>
          {demo.available && (
            <button data-testid="button-org-demo" onClick={() => demo.start("facilitator")} disabled={!!demo.busy} className="link-quiet">
              {demo.busy ? t("demo_starting") : t("org_try")}
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="select-all" data-testid="text-org-email">{CONTACT_EMAIL}</span>
        </p>
      </section>

      <div className="mt-14 sm:mt-20 grid lg:grid-cols-2 gap-x-20 gap-y-12">
        <section aria-labelledby="org-uses-h">
          <h2 id="org-uses-h" className="text-sm font-medium text-muted-foreground mb-3">{t("org_uses")}</h2>
          <dl className="divide-line border-y border-border">
            {USES.map((key) => (
              <div key={key} className="py-3.5 grid sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-6 gap-y-0.5">
                <dt className="font-medium tracking-[-0.01em]">{t(`org_${key}`)}</dt>
                <dd className="text-sm text-muted-foreground text-pretty sm:pt-0.5">{t(`org_${key}_d`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="org-facts-h">
          <h2 id="org-facts-h" className="text-sm font-medium text-muted-foreground mb-3">{t("org_facts")}</h2>
          <dl className="divide-line border-y border-border">
            {FACTS.map((key) => (
              <div key={key} className="py-3.5 grid sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-6 gap-y-0.5">
                <dt className="font-medium tracking-[-0.01em]">{t(`org_${key}`)}</dt>
                <dd className="text-sm text-muted-foreground text-pretty sm:pt-0.5">{t(`org_${key}_d`)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Relocated from homepage: Agreement rules & edge cases */}
      <section className="mt-14 sm:mt-20 pt-10 border-t border-border" aria-labelledby="org-faq-h" data-testid="section-agreement-faq">
        <h2 id="org-faq-h" className="font-display font-semibold text-lg tracking-[-0.02em]">
          {t("entry_agreement_title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-[65ch] text-pretty">
          {t("entry_agreement_body")}
        </p>
        <div className="mt-4 divide-y divide-border border-y border-border max-w-3xl">
          {FAQ_ITEMS.map((item, idx) => (
            <details key={item.q} className="disclose py-3.5" data-testid={`faq-item-${idx + 1}`}>
              <summary className="text-sm font-medium text-foreground cursor-pointer">
                {t(item.q)}
              </summary>
              <p className="mt-2 text-sm text-muted-foreground text-pretty leading-relaxed">
                {t(item.a)}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Relocated from homepage: Operational & privacy limits + product status */}
      <div className="mt-14 sm:mt-20 pt-10 border-t border-border grid lg:grid-cols-2 gap-x-20 gap-y-12">
        <section aria-labelledby="org-limits-h">
          <h2 id="org-limits-h" className="font-display font-semibold text-lg tracking-[-0.02em] mb-4">
            {t("entry_trust_title")}
          </h2>
          <dl className="divide-line border-y border-border">
            {LIMIT_ITEMS.map((item) => (
              <div key={item.h} className="py-3.5 space-y-1">
                <dt className="text-sm font-medium tracking-[-0.01em]">{t(item.h)}</dt>
                <dd className="text-sm text-muted-foreground text-pretty leading-relaxed">{t(item.p)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="org-status-h">
          <h2 id="org-status-h" className="font-display font-semibold text-lg tracking-[-0.02em] mb-4">
            {t("status_title")}
          </h2>
          <dl className="divide-line border-y border-border">
            {STATUS_ITEMS.map((item) => (
              <div key={item.h} className="py-3.5 space-y-1">
                <dt className="text-sm font-medium tracking-[-0.01em]">{t(item.h)}</dt>
                <dd className="text-sm text-muted-foreground text-pretty leading-relaxed">{t(item.p)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <a
              href="https://github.com/brasseaux93-web/aperture-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="link-quiet"
            >
              <span>{t("legal_opensource_repo")}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </section>
      </div>

      <p className="mt-10 text-sm text-muted-foreground max-w-[65ch] text-pretty" data-testid="text-org-legal">{t("org_legal")}</p>
    </Shell>
  );
}
