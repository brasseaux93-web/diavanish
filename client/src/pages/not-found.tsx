import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/vault";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Shell>
      <div className="relative max-w-md mx-auto pt-10 sm:pt-20">
        <div aria-hidden="true" className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 -z-10 h-72 w-72 rounded-full bg-emerald-500/5 blur-[80px]" />
        <div className="rounded-2xl border border-neutral-800/80 bg-[#0e1014] p-8 text-center shadow-2xl [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)] space-y-4">
          <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md border border-neutral-800 bg-[#12141a] text-neutral-400">
            404
          </span>
          <h1 className="font-semibold tracking-tight text-2xl text-white">{t("not_found_title")}</h1>
          <p className="text-sm text-neutral-400 text-pretty">{t("not_found_note")}</p>
          <div className="pt-2">
            <Link
              href="/"
              data-testid="link-not-found-home"
              className="inline-flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-medium px-4 py-2 rounded-lg text-xs transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)]"
            >
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              <span>{t("not_found_home")}</span>
            </Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}
