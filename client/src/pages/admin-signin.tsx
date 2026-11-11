import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { Shell, useStartDemo } from "@/components/vault";
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
      <div className="max-w-md mx-auto bento-panel p-6 sm:p-8">
        <h1 className="font-serif text-2xl text-white mb-1">Administrator</h1>
        <p className="text-sm text-zinc-400 mb-6">Sign in to manage the registry.</p>
        <SignInMethods role="admin" fallbackNext="/admin/console" emailForm={
          <EmailCodeForm
            role="admin"
            suggestedEmail={bootstrapEmail}
            onSignedIn={() => navigate("/admin/console")}
            ids={{ email: "input-email", request: "button-request-link", code: "input-code", verify: "button-verify" }}
          />
        } />
        {bootstrapEmail && (
          <p className="text-xs text-zinc-500 mt-4 font-mono break-all">Bootstrap: {bootstrapEmail}</p>
        )}
        {demo.available && (
          <button className="text-xs text-zinc-500 hover:text-zinc-300 mt-4 block" onClick={() => demo.start("admin")} disabled={!!demo.busy}>
            {demo.busy ? "Starting…" : "Try demo"}
          </button>
        )}
      </div>
    </Shell>
  );
}
