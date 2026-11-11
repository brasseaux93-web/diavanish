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
      <div className="max-w-sm mx-auto">
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
            <p className="text-xs text-muted-foreground break-all" data-testid="text-bootstrap-admin">
              {t("bootstrap_admin")}: {bootstrapEmail}
            </p>
          )}
          <DemoButton role="admin" demo={demo} />
        </div>
      </div>
    </Shell>
  );
}
