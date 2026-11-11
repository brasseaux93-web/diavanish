import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft } from "lucide-react";
import { Shell, PageHead, useStartDemo } from "@/components/vault";
import { EmailCodeForm } from "@/components/email-code-form";
import { SignInMethods } from "@/components/signin-methods";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type Mode = "apply" | "signin" | "enrol";

function initialMode(): Mode {
  if (typeof window === "undefined") return "signin";
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  const hashParams = qi >= 0 ? new URLSearchParams(hash.slice(qi + 1)) : null;
  const searchParams = new URLSearchParams(window.location.search);
  const m = hashParams?.get("mode") || searchParams.get("mode");
  if (m === "apply" || m === "enrol") return m;
  return "signin";
}

export default function FacilitatorPortal() {
  const { t } = useI18n();
  const [, navigate] = useLocation();

  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => {
    const syncMode = () => setMode(initialMode());
    window.addEventListener("hashchange", syncMode);
    window.addEventListener("popstate", syncMode);
    return () => {
      window.removeEventListener("hashchange", syncMode);
      window.removeEventListener("popstate", syncMode);
    };
  }, []);
  const demo = useStartDemo();
  const [busy, setBusy] = useState(false);

  // Apply
  const [app, setApp] = useState({
    name: "", affiliation: "", email: "", country: "", experience: "", adult: false,
  });
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Enrol
  const [enrolToken, setEnrolToken] = useState("");
  const [enrolError, setEnrolError] = useState<string | null>(null);

  useEffect(() => {
    setApplyError(null);
    setEnrolError(null);
  }, [mode]);

  const apply = async () => {
    setBusy(true); setApplyError(null);
    try {
      await apiJson("POST", "/api/facilitator/apply", { ...app, adult: app.adult });
      setApplied(true);
    } catch (e: any) {
      setApplyError(e.message || t("error_generic"));
    } finally {
      setBusy(false);
    }
  };

  const enrol = async () => {
    setBusy(true); setEnrolError(null);
    try {
      const res = await apiJson<{ token: string }>("POST", "/api/facilitator/enrol", { token: enrolToken });
      setSessionToken(res.token);
      navigate("/facilitate/rooms");
    } catch (e: any) {
      setEnrolError(e.message || t("enrol_bad"));
      document.getElementById("enrol")?.focus();
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <button data-testid="link-signin" className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors" onClick={() => setMode("signin")}>
      <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("back_to_signin")}
    </button>
  );

  const field = (id: string, label: string, key: "name" | "affiliation" | "email" | "country" | "experience", extra: Record<string, string> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-medium text-neutral-300">{label}</Label>
      <Input
        id={id}
        value={app[key]}
        className="bg-[#12141a] border-neutral-800 text-white"
        onChange={(e) => { setApp({ ...app, [key]: e.target.value }); setApplyError(null); }}
        {...extra}
      />
    </div>
  );

  return (
    <Shell>
      <div className="relative max-w-md mx-auto pt-4 sm:pt-10">
        <div aria-hidden="true" className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 -z-10 h-72 w-72 rounded-full bg-emerald-500/5 blur-[80px]" />
        <div className="rounded-2xl border border-neutral-800/80 bg-[#0e1014] p-6 sm:p-8 shadow-2xl [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]">
          {mode === "signin" && (
            <>
              <PageHead title={t("doc_facilitator_signin")} />
              <div className="space-y-6">
                <SignInMethods role="facilitator" fallbackNext="/facilitate/rooms" emailForm={
                  <EmailCodeForm
                    role="facilitator"
                    onSignedIn={() => navigate("/facilitate/rooms")}
                    ids={{ email: "input-fac-email", request: "button-fac-request", code: "input-fac-code", verify: "button-fac-verify" }}
                  />
                } />
                <div className="pt-5 border-t border-neutral-800/80 flex flex-col items-start gap-2.5">
                  <button data-testid="link-apply" className="text-xs text-neutral-400 hover:text-white transition-colors" onClick={() => setMode("apply")}>{t("apply_access")}</button>
                  <button data-testid="link-enrol" className="text-xs text-neutral-400 hover:text-white transition-colors" onClick={() => setMode("enrol")}>{t("have_enrol")}</button>
                  {demo.available && (
                    <button data-testid="button-demo-facilitator" className="text-xs text-neutral-400 hover:text-white transition-colors" onClick={() => demo.start("facilitator")} disabled={!!demo.busy}>
                      {demo.busy === "facilitator" ? t("demo_starting") : `${t("run_demo")} · ${t("role_facilitator")}`}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {mode === "apply" && (
            <>
              <PageHead title={t("apply_title")} note={applied ? undefined : t("apply_note")} />
              {applied ? (
                <p className="text-sm text-neutral-300 text-pretty mb-6" role="status" data-testid="text-application-sent">{t("application_sent")}</p>
              ) : (
                <form className="space-y-4 mb-6" onSubmit={(e) => { e.preventDefault(); apply(); }}>
                  {field("f-name", t("name"), "name", { "data-testid": "input-fname", autoComplete: "name" })}
                  {field("f-aff", t("affiliation"), "affiliation", { autoComplete: "organization" })}
                  {field("f-email", t("email"), "email", { type: "email", autoComplete: "email" })}
                  {field("f-country", t("country"), "country", { autoComplete: "country-name" })}
                  {field("f-exp", t("experience"), "experience")}
                  <label className="flex items-start gap-2.5 text-sm text-neutral-300 cursor-pointer">
                    <Checkbox className="mt-0.5 border-neutral-700 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" checked={app.adult} onCheckedChange={(v) => { setApp({ ...app, adult: v === true }); setApplyError(null); }} />
                    {t("adult_confirm")}
                  </label>
                  {applyError && <p role="alert" data-testid="text-apply-error" className="text-sm text-red-400 text-pretty">{applyError}</p>}
                  <button
                    type="submit"
                    data-testid="button-apply"
                    className="w-full bg-white text-black hover:bg-neutral-200 font-medium py-2.5 rounded-lg text-sm transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={busy || !app.name || !app.email || !app.country || !app.experience || !app.adult}
                  >
                    {t("submit_application")}
                  </button>
                </form>
              )}
              {back}
            </>
          )}

          {mode === "enrol" && (
            <>
              <PageHead title={t("enrol_token")} />
              <form className="space-y-4 mb-6" onSubmit={(e) => { e.preventDefault(); if (!busy && enrolToken) enrol(); }}>
                <div className="space-y-2">
                  <Label htmlFor="enrol" className="text-xs font-medium text-neutral-300">{t("enrol_token")}</Label>
                  <Input id="enrol" data-testid="input-enrol" className="font-mono bg-[#12141a] border-neutral-800 text-white" value={enrolToken}
                    aria-invalid={enrolError ? true : undefined} aria-describedby={enrolError ? "enrol-error" : undefined}
                    onChange={(e) => { setEnrolToken(e.target.value); setEnrolError(null); }} />
                  {enrolError && <p id="enrol-error" role="alert" data-testid="text-enrol-error" className="text-sm text-red-400 text-pretty">{enrolError}</p>}
                </div>
                <button
                  type="submit"
                  data-testid="button-enrol"
                  className="w-full bg-white text-black hover:bg-neutral-200 font-medium py-2.5 rounded-lg text-sm transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={busy || !enrolToken}
                >
                  {t("enrol")}
                </button>
              </form>
              {back}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
