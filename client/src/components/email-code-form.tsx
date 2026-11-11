import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { CodeNotice, type Issued } from "@/components/code-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Ids = { email: string; request: string; code: string; verify: string };

/**
 * Email sign-in in two steps: ask for the address, then for the code.
 * The code field appears only once the server has issued a code, so the
 * screen never shows a field that cannot be filled in yet.
 */
export function EmailCodeForm({
  role, ids, onSignedIn, suggestedEmail,
}: {
  role: "admin" | "facilitator";
  ids: Ids;
  onSignedIn: () => void;
  suggestedEmail?: string | null;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  // Shown next to the field it concerns, and announced to screen readers.
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (suggestedEmail) setEmail((prev) => prev || suggestedEmail);
  }, [suggestedEmail]);

  useEffect(() => {
    if (issued) codeRef.current?.focus();
  }, [issued]);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiJson<Issued>("POST", "/api/auth/request-code", { email, role });
      setCode("");
      setIssued(res);
    } catch (e: any) {
      setError(e.message || t("error_generic"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiJson<{ token: string }>("POST", "/api/auth/verify-code", { email, code, role });
      setSessionToken(res.token);
      onSignedIn();
    } catch (e: any) {
      setError(e.message || t("wrong_code"));
      codeRef.current?.focus();
      codeRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = () => {
    setIssued(null);
    setCode("");
    setError(null);
    requestAnimationFrame(() => emailRef.current?.focus());
  };

  if (!issued) {
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && email) request(); }}>
        <div className="space-y-2">
          <Label htmlFor={ids.email}>{t("email")}</Label>
          <Input
            ref={emailRef}
            id={ids.email}
            data-testid={ids.email}
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            placeholder={suggestedEmail ?? undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids.email}-error` : undefined}
          />
          {error && <p id={`${ids.email}-error`} role="alert" data-testid="text-signin-error" className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" data-testid={ids.request} disabled={busy || !email} className="w-full">
          {t("request_link")}
        </Button>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && code) verify(); }}>
      <CodeNotice issued={issued} email={email} />
      <div className="space-y-2">
        <Label htmlFor={ids.code}>{t("one_time_code")}</Label>
        <Input
          ref={codeRef}
          id={ids.code}
          data-testid={ids.code}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="mono-data tracking-[0.2em]"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids.code}-error` : undefined}
        />
        {error && <p id={`${ids.code}-error`} role="alert" data-testid="text-signin-error" className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" data-testid={ids.verify} disabled={busy || !code} className="w-full">
        {t("verify")}
      </Button>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <button type="button" data-testid="button-code-resend" onClick={request} disabled={busy} className="link-quiet">
          {t("code_resend")}
        </button>
        <button type="button" data-testid="button-code-change-email" onClick={changeEmail} className="link-quiet">
          {t("code_change_email")}
        </button>
      </div>
    </form>
  );
}
