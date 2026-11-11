import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { Shell, PageHead, DemoButton, useStartDemo } from "@/components/vault";
import { SignInMethods } from "@/components/signin-methods";
import { EmailCodeForm } from "@/components/email-code-form";
import { apiJson } from "@/lib/queryClient";

export default function AdminSignin() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [bootstrapEmail, setBootstrapEmail] = useState<string | null>(null);
  const demo = useStartDemo();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiJson<{ email: string | null }>("GET", "/api/public/bootstrap-admin");
        if (cancelled) return;
        setBootstrapEmail(typeof res.email === "string" && res.email.includes("@") ? res.email : null);
      } catch {
        if (!cancelled) setBootstrapEmail(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Shell>
      <div className="relative max-w-md mx-auto pt-4 sm:pt-10">
        <div aria-hidden="true" className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 -z-10 h-72 w-72 rounded-full bg-emerald-500/5 blur-[80px]" />
        <div className="rounded-2xl border border-neutral-800/80 bg-[#0e1014] p-6 sm:p-8 shadow-2xl [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]">
          <PageHead title={t("doc_admin_signin")} />
          <div className="space-y-6">
            <SignInMethods role="admin" fallbackNext="/admin/console" emailForm={
              <EmailCodeForm
                role="admin"
                suggestedEmail={bootstrapEmail}
                onSignedIn={() => navigate("/admin/console")}
                ids={{ email: "input-email", request: "button-request-link", code: "input-code", verify: "button-verify" }}
              />
            } />
            {bootstrapEmail && (
              <p className="text-xs text-neutral-400 break-all p-3 rounded-lg bg-[#12141a] border border-neutral-800" data-testid="text-bootstrap-admin">
                <span className="font-medium text-neutral-300">{t("bootstrap_admin")}:</span> {bootstrapEmail}
              </p>
            )}
            <DemoButton role="admin" demo={demo} />
          </div>
        </div>
      </div>
    </Shell>
  );
}
