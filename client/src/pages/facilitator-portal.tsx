import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft, ShieldCheck, KeyRound, Fingerprint, ChevronRight } from "lucide-react";
import { Shell, PageHead, useStartDemo } from "@/components/vault";
import { EmailCodeForm } from "@/components/email-code-form";
import { SignInMethods } from "@/components/signin-methods";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const STEPS = [
  { id: 1, label: "Identity & Credentials", status: "active" },
  { id: 2, label: "Verification", status: "pending" },
  { id: 3, label: "Ephemeral Key Generation", status: "pending" },
] as const;

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

  const [app, setApp] = useState({
    name: "", affiliation: "", email: "", country: "", experience: "", domain: "track2", adult: false,
  });
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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
    <button data-testid="link-signin" className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors" onClick={() => setMode("signin")}>
      <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("back_to_signin")}
    </button>
  );

  return (
    <Shell wide>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl tracking-tight text-white">
              {mode === "apply" ? "Facilitator Accreditation" : mode === "enrol" ? "Enrolment" : "Facilitator Access"}
            </h1>
            <p className="mt-2 text-sm text-zinc-400 font-mono">
              Zero-persistence session · Ephemeral cryptographic rooms · No transcript retention
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-zinc-500 border border-white/[0.08] px-3 py-1.5 rounded">
            <Fingerprint className="h-3.5 w-3.5" />
            <span>FP · a7f3…e91c</span>
          </div>
        </div>

        {mode === "signin" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bento-panel p-6 sm:p-8 space-y-6">
              <div className="space-y-1">
                <h2 className="font-serif text-xl text-white">Institutional Context</h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Facilitators operate under non-disclosure and ephemerality protocols. Sessions produce outcome summaries only. Cryptographic room signatures ensure provenance without persistent speech records.
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs font-mono text-zinc-300">
                  <ShieldCheck className="h-4 w-4 text-zinc-500" />
                  End-to-end ephemeral · Zero persistence
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-zinc-300">
                  <KeyRound className="h-4 w-4 text-zinc-500" />
                  Room signature required for seal
                </div>
              </div>
              <div className="pt-4 border-t border-white/[0.08]">
                <div className="flex items-center justify-between text-xs font-mono text-zinc-500 mb-2">
                  <span>Progress</span>
                  <span>Step 1 of 3</span>
                </div>
                <div className="h-px bg-white/[0.08] relative">
                  <div className="absolute inset-y-0 left-0 w-1/3 bg-white/40" />
                </div>
              </div>
            </div>

            <div className="bento-panel p-6 sm:p-8">
              <PageHead title={t("doc_facilitator_signin")} />
              <div className="space-y-6">
                <SignInMethods role="facilitator" fallbackNext="/facilitate/rooms" emailForm={
                  <EmailCodeForm
                    role="facilitator"
                    onSignedIn={() => navigate("/facilitate/rooms")}
                    ids={{ email: "input-fac-email", request: "button-fac-request", code: "input-fac-code", verify: "button-fac-verify" }}
                  />
                } />
                <div className="pt-5 border-t border-white/[0.08] flex flex-col items-start gap-2.5">
                  <button data-testid="link-apply" className="text-xs text-zinc-400 hover:text-white transition-colors" onClick={() => setMode("apply")}>{t("apply_access")}</button>
                  <button data-testid="link-enrol" className="text-xs text-zinc-400 hover:text-white transition-colors" onClick={() => setMode("enrol")}>{t("have_enrol")}</button>
                  {demo.available && (
                    <button data-testid="button-demo-facilitator" className="text-xs text-zinc-400 hover:text-white transition-colors" onClick={() => demo.start("facilitator")} disabled={!!demo.busy}>
                      {demo.busy === "facilitator" ? t("demo_starting") : `${t("run_demo")} · ${t("role_facilitator")}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === "apply" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bento-panel p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="font-serif text-xl text-white mb-2">Facilitator Expectations</h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Non-disclosure of session content. Ephemeral rooms only. Outcome summaries sealed with cryptographic signature. No persistent audio, video, or full transcript.
                </p>
              </div>
              <div className="space-y-2">
                {STEPS.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-xs font-mono">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.status === "active" ? "bg-white" : "bg-zinc-700"}`} />
                    <span className={s.status === "active" ? "text-white" : "text-zinc-500"}>{s.label}</span>
                    {s.status === "active" && <ChevronRight className="h-3 w-3 text-zinc-400 ml-auto" />}
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-white/[0.08] flex items-center gap-2 text-xs font-mono text-zinc-500">
                <Fingerprint className="h-3.5 w-3.5" />
                Active fingerprint · session-bound
              </div>
            </div>

            <div className="bento-panel p-6 sm:p-8">
              <PageHead title={t("apply_title")} note={applied ? undefined : t("apply_note")} />
              {applied ? (
                <p className="text-sm text-zinc-300" role="status" data-testid="text-application-sent">{t("application_sent")}</p>
              ) : (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); apply(); }}>
                  <div className="space-y-2">
                    <Label htmlFor="f-name" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</Label>
                    <Input id="f-name" value={app.name} className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm" onChange={(e) => setApp({ ...app, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="f-aff" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Affiliation</Label>
                    <Input id="f-aff" value={app.affiliation} className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm" onChange={(e) => setApp({ ...app, affiliation: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="f-email" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Email</Label>
                    <Input id="f-email" type="email" value={app.email} className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm" onChange={(e) => setApp({ ...app, email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Domain Specialization</Label>
                    <Select value={app.domain} onValueChange={(v) => setApp({ ...app, domain: v })}>
                      <SelectTrigger className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-zinc-800 text-white">
                        <SelectItem value="track1">Track-1 Diplomacy</SelectItem>
                        <SelectItem value="track2">Track-2 Diplomacy</SelectItem>
                        <SelectItem value="commercial">Commercial Mediation</SelectItem>
                        <SelectItem value="crossborder">Cross-Border Dispute</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[0.6875rem] font-mono text-zinc-500">Required for room provisioning</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="f-country" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Country</Label>
                    <Input id="f-country" value={app.country} className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm" onChange={(e) => setApp({ ...app, country: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="f-exp" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Experience</Label>
                    <Input id="f-exp" value={app.experience} className="bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white font-mono text-sm" onChange={(e) => setApp({ ...app, experience: e.target.value })} />
                    <p className="text-[0.6875rem] font-mono text-zinc-500">{app.experience.length}/240</p>
                  </div>
                  <label className="flex items-start gap-2.5 text-sm text-zinc-300 cursor-pointer">
                    <Checkbox className="mt-0.5 border-zinc-700 data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black" checked={app.adult} onCheckedChange={(v) => setApp({ ...app, adult: v === true })} />
                    {t("adult_confirm")}
                  </label>
                  {applyError && <p role="alert" className="text-sm text-red-400">{applyError}</p>}
                  <button
                    type="submit"
                    data-testid="button-apply"
                    className="w-full mt-2 bg-white text-black hover:bg-zinc-100 font-medium py-2.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-transparent"
                    disabled={busy || !app.name || !app.email || !app.country || !app.experience || !app.adult}
                  >
                    {busy ? "Submitting…" : t("submit_application")}
                  </button>
                </form>
              )}
              <div className="mt-6">{back}</div>
            </div>
          </div>
        )}

        {mode === "enrol" && (
          <div className="max-w-md mx-auto bento-panel p-6 sm:p-8">
            <PageHead title={t("enrol_token")} />
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && enrolToken) enrol(); }}>
              <div className="space-y-2">
                <Label htmlFor="enrol" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{t("enrol_token")}</Label>
                <Input id="enrol" className="font-mono bg-zinc-950/60 border-zinc-800/80 focus:border-zinc-400 focus:ring-0 text-white" value={enrolToken}
                  aria-invalid={enrolError ? true : undefined}
                  onChange={(e) => { setEnrolToken(e.target.value); setEnrolError(null); }} />
                {enrolError && <p role="alert" className="text-sm text-red-400">{enrolError}</p>}
              </div>
              <button
                type="submit"
                data-testid="button-enrol"
                className="w-full bg-white text-black hover:bg-zinc-100 font-medium py-2.5 text-sm transition-colors disabled:opacity-40"
                disabled={busy || !enrolToken}
              >
                {busy ? "Enrolling…" : t("enrol")}
              </button>
            </form>
            <div className="mt-6">{back}</div>
          </div>
        )}
      </div>
    </Shell>
  );
}
