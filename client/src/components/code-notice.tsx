import { TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type Issued = { sent: boolean; delivery: "email" | "dev"; code?: string };

/** Sign-in codes arrive by email. Only a server in development mode shows one here. */
export function CodeNotice({ issued, email }: { issued: Issued; email?: string }) {
  const { t } = useI18n();
  if (issued.delivery === "dev" && issued.code) {
    return (
      <div className="rounded-md bg-[hsl(var(--warn))]/10 p-3 space-y-2" data-testid="block-dev-code" role="status">
        <p className="text-xs text-[hsl(var(--warn))] flex gap-2 text-pretty">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>{t("code_dev_mode")}</span>
        </p>
        <p className="mono-data text-2xl tracking-[0.3em] text-foreground">{issued.code}</p>
      </div>
    );
  }
  return (
    <p className="text-sm text-muted-foreground text-pretty" data-testid="text-code-emailed" role="status">
      {email && <bdi className="block text-foreground break-all">{email}</bdi>}
      {t("code_sent_email")}
    </p>
  );
}
