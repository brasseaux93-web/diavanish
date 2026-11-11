import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/vault";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Shell>
      <div className="max-w-sm mx-auto py-10 sm:py-20">
        <h1 className="font-display font-semibold tracking-[-0.02em] text-2xl">{t("not_found_title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{t("not_found_note")}</p>
        <Link href="/" data-testid="link-not-found-home" className="link-quiet mt-5">
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("not_found_home")}
        </Link>
      </div>
    </Shell>
  );
}
