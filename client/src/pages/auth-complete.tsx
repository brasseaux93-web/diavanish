import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft } from "lucide-react";
import { Shell, PageHead } from "@/components/vault";
import { apiJson, setSessionToken } from "@/lib/queryClient";

function hashParams() {
  const hash = window.location.hash.replace(/^#/, "");
  try {
    return new URL(hash, "http://local").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export default function AuthComplete() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [message, setMessage] = useState(t("auth_complete_working"));
  const [failed, setFailed] = useState(false);
  const [back, setBack] = useState("/admin");

  useEffect(() => {
    const q = hashParams();
    const error = q.get("error");
    const ticket = q.get("ticket");
    const fallback = q.get("next") || "/admin";
    setBack(fallback.startsWith("/facilitate") ? "/facilitate" : "/admin");
    if (error) {
      setFailed(true);
      const key = `auth_err_${error}`;
      const translated = t(key as any);
      setMessage(translated === key ? t("auth_err_failed") : translated);
      return;
    }
    if (!ticket) {
      setFailed(true);
      setMessage(t("auth_err_failed"));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiJson<{ token: string; next?: string }>("POST", "/api/auth/oidc/claim", { ticket });
        if (cancelled) return;
        setSessionToken(r.token);
        navigate(r.next || fallback);
      } catch {
        if (!cancelled) { setFailed(true); setMessage(t("auth_err_failed")); }
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, t]);

  return (
    <Shell>
      <div className="max-w-sm mx-auto">
        <PageHead title={failed ? t("auth_failed_title") : t("auth_complete_title")} />
        <p className={`text-sm text-pretty ${failed ? "" : "text-muted-foreground"}`} role={failed ? "alert" : "status"} data-testid="auth-complete-status">{message}</p>
        {failed && (
          <button data-testid="link-auth-back" className="link-quiet mt-5" onClick={() => navigate(back)}>
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("back_to_signin")}
          </button>
        )}
      </div>
    </Shell>
  );
}
