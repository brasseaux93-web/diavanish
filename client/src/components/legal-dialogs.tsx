import { useEffect, useMemo } from "react";
import { CONTACT_EMAIL } from "@shared/contact";
import { useSearch } from "wouter";
import { useI18n } from "@/lib/i18n";
import { isLegalId, legalFromSearch, LegalId, LEGAL_IDS } from "@/lib/legal";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Section = { heading: string; points: string[] };

function sectionsFor(id: LegalId, t: (k: string) => string): Section[] {
  const n = Number(t(`legal_${id}_n`)) || 0;
  const out: Section[] = [];
  for (let i = 1; i <= n; i++) {
    const heading = t(`legal_${id}_s${i}_h`);
    const points: string[] = [];
    const pn = Number(t(`legal_${id}_s${i}_n`)) || 0;
    for (let j = 1; j <= pn; j++) points.push(t(`legal_${id}_s${i}_p${j}`));
    out.push({ heading, points });
  }
  return out;
}

const DRAFT_IDS: LegalId[] = ["privacy", "terms"];

function useLegalParam() {
  const search = useSearch();
  const openId = useMemo(() => legalFromSearch(search), [search]);

  const setLegal = (id: LegalId | null, replace = false) => {
    const next = new URL(window.location.href);
    if (id) next.searchParams.set("legal", id);
    else next.searchParams.delete("legal");
    // Also clean any ?legal= that may have been placed inside the hash
    const hash = next.hash || "";
    const qi = hash.indexOf("?");
    if (qi >= 0) {
      const hashSearch = new URLSearchParams(hash.slice(qi + 1));
      hashSearch.delete("legal");
      const baseHash = hash.slice(0, qi);
      const rest = hashSearch.toString();
      next.hash = rest ? `${baseHash}?${rest}` : baseHash;
    }
    window.history[replace ? "replaceState" : "pushState"](window.history.state, "", next.href);
    window.dispatchEvent(new Event("popstate"));
  };

  return { openId, setLegal };
}

/** Normalize rare inbound links that put ?legal= inside the hash (#/?legal=…). */
function useNormalizeHashLegal() {
  useEffect(() => {
    const hash = window.location.hash || "";
    const qi = hash.indexOf("?");
    if (qi < 0) return;
    const hashSearch = new URLSearchParams(hash.slice(qi + 1));
    const legal = hashSearch.get("legal");
    if (!isLegalId(legal)) return;
    const path = hash.slice(1, qi) || "/";
    const next = new URL(window.location.href);
    next.hash = path.startsWith("/") ? path : `/${path}`;
    next.searchParams.set("legal", legal);
    window.history.replaceState(window.history.state, "", next.href);
    window.dispatchEvent(new Event("hashchange"));
    window.dispatchEvent(new Event("popstate"));
  }, []);
}

export function LegalDialogHost() {
  const { t, dir } = useI18n();
  const { openId, setLegal } = useLegalParam();
  useNormalizeHashLegal();

  const sections = useMemo(() => (openId ? sectionsFor(openId, t) : []), [openId, t]);
  const isDraft = openId ? DRAFT_IDS.includes(openId) : false;

  return (
    <Dialog open={!!openId} onOpenChange={(v) => { if (!v) setLegal(null, true); }}>
      <DialogContent
        dir={dir}
        className={[
          "max-w-xl gap-0 p-0 overflow-hidden",
          "max-h-[min(88vh,40rem)]",
          "max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh]",
          "max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0",
          "max-sm:rounded-none max-sm:border-0",
        ].join(" ")}
      >
        {openId && (
          <div className="flex flex-col max-h-[inherit] min-h-0">
            <DialogHeader className="px-6 pt-6 pb-4 pe-14 sm:px-8 sm:pt-8 sm:pb-5 sm:pe-16 text-start space-y-3 shrink-0 border-b border-border/60">
              {isDraft && (
                <p className="chip chip-warn w-fit" data-testid="legal-draft-badge">{t("legal_draft_badge")}</p>
              )}
              <DialogTitle className="font-display font-semibold tracking-[-0.03em] text-xl sm:text-[1.35rem] text-balance">
                {t(`legal_${openId}_title`)}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground text-pretty leading-relaxed">
                {t(`legal_${openId}_desc`)}
              </DialogDescription>
            </DialogHeader>

            <div
              className="overflow-y-auto flex-1 min-h-0 px-6 sm:px-8 py-6 sm:py-7 space-y-8"
              tabIndex={0}
              role="region"
              aria-label={t(`legal_${openId}_title`)}
            >
              {sections.map((s, i) => (
                <section key={i} className="space-y-3">
                  <h3 className="text-sm font-medium">{s.heading}</h3>
                  <ul className="space-y-2.5">
                    {s.points.map((p, j) => (
                      <li key={j} className="text-sm leading-relaxed text-foreground/90 text-pretty">
                        {p}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {openId === "opensource" && (
                <p className="pt-1">
                  <a
                    href="https://github.com/brasseaux93-web/aperture-v2"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-legal-repo"
                    className="inline-flex min-h-11 items-center text-sm text-primary hover:underline underline-offset-4"
                  >
                    {t("legal_opensource_repo")}
                  </a>
                </p>
              )}
              {openId === "security" && (
                <p className="text-sm text-muted-foreground text-pretty leading-relaxed">{t("legal_security_report")}</p>
              )}
              {openId === "accessibility" && (
                <p className="text-sm text-muted-foreground text-pretty leading-relaxed">{t("legal_accessibility_contact")}</p>
              )}
              <p className="text-sm text-muted-foreground pt-4 border-t border-border">
                {t("contact_label")}:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-legal-contact"
                  className="text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-current">
                  {CONTACT_EMAIL}
                </a>
              </p>
            </div>

            <div className="px-6 py-3.5 sm:px-8 border-t border-border/60 flex items-center justify-end shrink-0 bg-[var(--surface-1)]">
              <DialogClose asChild>
                <button
                  type="button"
                  data-testid="button-legal-close"
                  onClick={() => setLegal(null, true)}
                  className="signin-btn"
                >
                  {t("close")}
                </button>
              </DialogClose>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const { setLegal } = useLegalParam();
  return (
    <nav aria-label={t("footer_legal_nav")} className={`contents ${className}`}>
      {LEGAL_IDS.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`link-footer-${id}`}
          onClick={() => setLegal(id)}
          className="min-h-11 sm:min-h-8 max-sm:min-w-[2.75rem] max-sm:px-2 inline-flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t(`footer_${id}`)}
        </button>
      ))}
    </nav>
  );
}
