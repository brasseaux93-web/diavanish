import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Fingerprint, Building2, Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type AuthMethods = {
  passkey: boolean;
  emailCode: boolean;
  oidc: { enabled: boolean; name: string | null };
};

export function useAuthMethods() {
  return useQuery<AuthMethods>({ queryKey: ["/api/public/auth-methods"] });
}

export async function signInWithPasskey() {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  const options = await apiJson<any>("POST", "/api/auth/passkey/authenticate/options");
  const response = await startAuthentication({ optionsJSON: options });
  return apiJson<{ token: string; role: string; next: string }>("POST", "/api/auth/passkey/authenticate/verify", { response });
}

/** The three-way sign-in choice: passkey, agency (when configured), then email. */
export function SignInMethods({
  role,
  fallbackNext,
  emailForm,
}: {
  role: "admin" | "facilitator";
  fallbackNext: string;
  emailForm: ReactNode;
}) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const methods = useAuthMethods();
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const data = methods.data;
  const emailOn = data?.emailCode !== false;
  const oidcOn = !!data?.oidc.enabled;

  useEffect(() => {
    // If passkeys and SSO are off, don't make someone click to see the form they already know.
    if (data && !data.passkey && !data.oidc.enabled && data.emailCode) setShowEmail(true);
  }, [data]);

  const passkey = async () => {
    setBusy(true);
    try {
      const r = await signInWithPasskey();
      setSessionToken(r.token);
      navigate(r.next || fallbackNext);
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const agency = async () => {
    window.location.href = `/api/auth/oidc/start?role=${role}`;
  };

  return (
    <div className="space-y-3">
      {data?.passkey !== false && (
        <Button data-testid="button-signin-passkey" variant={showEmail ? "secondary" : "default"} className="w-full" onClick={passkey} disabled={busy}>
          <Fingerprint className="h-4 w-4" aria-hidden />
          {busy ? t("passkey_starting") : t("signin_passkey")}
        </Button>
      )}
      {oidcOn && (
        <Button data-testid="button-signin-agency" variant="secondary" className="w-full" onClick={agency} disabled={busy}>
          <Building2 className="h-4 w-4" aria-hidden />
          {data?.oidc.name ? `${t("signin_agency_named")} ${data.oidc.name}` : t("signin_agency")}
        </Button>
      )}
      {emailOn && !showEmail && (
        <Button
          type="button"
          variant={data?.passkey === false && !oidcOn ? "default" : "ghost"}
          data-testid="button-signin-email"
          className="w-full"
          onClick={() => setShowEmail(true)}
        >
          <Mail className="h-4 w-4" aria-hidden />
          {t("signin_email")}
        </Button>
      )}
      {emailOn && showEmail && (
        <div className={data?.passkey !== false || oidcOn ? "pt-5 border-t border-border" : ""}>
          {emailForm}
        </div>
      )}
    </div>
  );
}
