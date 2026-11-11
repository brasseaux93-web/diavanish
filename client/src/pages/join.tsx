import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Shell, PageHead, useStartDemo } from "@/components/vault";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

type InviteInfo = {
  roomTitle: string;
  anonymityMode: "anonymous" | "open";
  requiresRoleProof: boolean;
  turnMinutes: number;
  boundRole: string | null;
  roleAttested: boolean;
};

export default function Join({ params }: { params?: { mode?: string } }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [code, setCode] = useState("");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [nameChoice, setNameChoice] = useState<"pseudonym" | "real">("pseudonym");
  const [name, setName] = useState("");
  const [realName, setRealName] = useState("");
  const [claimedRole, setClaimedRole] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<{ recoveryKey: string } | null>(null);
  const [recoverMode, setRecoverMode] = useState(params?.mode === "recover");
  useEffect(() => { setRecoverMode(params?.mode === "recover"); }, [params?.mode]);
  const demo = useStartDemo();
  const [recover, setRecover] = useState({ roomCode: "", pseudonym: "", recoveryKey: "" });
  const [copied, setCopied] = useState(false);
  // A refused code is a field error: it is shown where the person is looking
  // and announced, instead of a toast that outlives the page.
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [recoverMode, info]);

  const copyKey = async () => {
    if (!joined) return;
    try {
      await navigator.clipboard.writeText(joined.recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("copy_failed"), variant: "destructive" });
    }
  };

  const lookup = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<InviteInfo>("GET", `/api/public/invite-lookup/${encodeURIComponent(code.trim())}`);
      setInfo(res);
      if (res.boundRole) setClaimedRole(res.boundRole);
    } catch (e: any) {
      setError(e.message);
      document.getElementById("code")?.focus();
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ token: string; recoveryKey: string }>("POST", "/api/join", {
        inviteToken: code.trim(),
        nameChoice: info?.anonymityMode === "open" ? nameChoice : "pseudonym",
        name: name || null,
        realName: nameChoice === "pseudonym" ? realName || null : null,
        claimedRole,
        adult,
      });
      setSessionToken(res.token, res.recoveryKey);
      setJoined({ recoveryKey: res.recoveryKey });
    } catch (e: any) {
      setError(e.message || t("error_generic"));
    } finally {
      setBusy(false);
    }
  };

  const recoverSeat = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ token: string; seatId: number; roomId: number }>("POST", "/api/recover", recover);
      setSessionToken(res.token);
      navigate("/p");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // After joining: show the recovery key once — it will not be shown again
  if (joined) {
    return (
      <Shell>
        <div className="max-w-sm mx-auto">
          <PageHead title={t("recovery_key")} note={t("recovery_note")} />
          <div className="rounded-md bg-[var(--surface-sunk)] border border-border px-4 py-5 flex items-center gap-3">
            <code className="mono-data text-xl sm:text-2xl tracking-[0.16em] text-foreground break-all flex-1" data-testid="text-recovery-key">
              {joined.recoveryKey}
            </code>
            <Button type="button" variant="ghost" size="sm" data-testid="button-copy-recovery" onClick={copyKey} className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              <span aria-live="polite">{copied ? t("copied") : t("copy")}</span>
            </Button>
          </div>
          <Button data-testid="button-enter-room" className="w-full mt-6" onClick={() => navigate("/p")}>
            {t("continue")}
          </Button>
        </div>
      </Shell>
    );
  }

  const choice = (value: "pseudonym" | "real", label: string) => (
    <button
      type="button" role="radio" aria-checked={nameChoice === value}
      data-testid={`button-choice-${value}`}
      onClick={() => setNameChoice(value)}
    >
      {label}
    </button>
  );

  return (
    <Shell>
      <div className="max-w-sm mx-auto">
        {recoverMode ? (
          <>
            <PageHead title={t("recover_seat")} note={t("recover_title")} />
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && recover.roomCode && recover.pseudonym && recover.recoveryKey) recoverSeat(); }}>
              <div className="space-y-2">
                <Label htmlFor="rc">{t("recover_code")}</Label>
                <Input id="rc" data-testid="input-recover-code" value={recover.roomCode} autoCapitalize="characters" autoComplete="off"
                  className="mono-data" onChange={(e) => setRecover({ ...recover, roomCode: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rp">{t("recover_pseudonym")}</Label>
                <Input id="rp" data-testid="input-recover-pseudonym" value={recover.pseudonym} autoComplete="off"
                  onChange={(e) => setRecover({ ...recover, pseudonym: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rk">{t("recover_key_label")}</Label>
                <Input id="rk" data-testid="input-recover-key" value={recover.recoveryKey} autoComplete="off"
                  className="mono-data" onChange={(e) => setRecover({ ...recover, recoveryKey: e.target.value })} />
              </div>
              {error && <p role="alert" data-testid="text-recover-error" className="text-sm text-destructive text-pretty">{error}</p>}
              <Button type="submit" data-testid="button-recover" className="w-full"
                disabled={busy || !recover.roomCode || !recover.pseudonym || !recover.recoveryKey}>
                {t("recover_cta")}
              </Button>
            </form>
            <button data-testid="link-back-to-join" className="link-quiet mt-6" onClick={() => setRecoverMode(false)}>
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("join_title")}
            </button>
          </>
        ) : !info ? (
          <>
            <PageHead title={t("join_title")} />
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && code) lookup(); }}>
              <div className="space-y-2">
                <Label htmlFor="code">{t("join_code")}</Label>
                <Input id="code" data-testid="input-join-code" value={code} autoComplete="off"
                  aria-invalid={error ? true : undefined} aria-describedby={error ? "code-error" : undefined}
                  className="mono-data" onChange={(e) => { setCode(e.target.value); setError(null); }} />
                {error && <p id="code-error" role="alert" data-testid="text-join-error" className="text-sm text-destructive text-pretty">{error}</p>}
              </div>
              <Button type="submit" data-testid="button-lookup" className="w-full" disabled={busy || !code}>
                {t("continue")}
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t border-border flex flex-col items-start">
              <button data-testid="button-recover-seat" className="link-quiet" onClick={() => setRecoverMode(true)}>
                {t("recover_seat")}
              </button>
              {demo.available && (
                <button data-testid="button-demo-participant" className="link-quiet" onClick={() => demo.start("participant")} disabled={!!demo.busy}>
                  {demo.busy === "participant" ? t("demo_starting") : `${t("run_demo")} · ${t("role_participant")}`}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <PageHead title={info.roomTitle} note={t("join_notice")} />
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!busy && claimedRole && adult && name) join(); }}>
              {/* Identity: depends on the facilitator's anonymity setting */}
              {info.anonymityMode === "anonymous" ? (
                <div className="space-y-2">
                  <Label htmlFor="pseudonym">{t("display_name")}</Label>
                  <Input id="pseudonym" data-testid="input-pseudonym" value={name} autoComplete="off" aria-describedby="pseudonym-note"
                    onChange={(e) => { setName(e.target.value); setError(null); }} />
                  <p id="pseudonym-note" className="text-xs text-muted-foreground">{t("anonymity_anon_note")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p id="identity-l" className="text-sm font-medium">{t("choose_identity")}</p>
                    <div role="radiogroup" aria-labelledby="identity-l" className="segmented segmented-box w-fit">
                      {choice("pseudonym", t("pseudonym_choice"))}
                      {choice("real", t("real_name_choice"))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">{nameChoice === "real" ? t("your_real_name") : t("display_name")}</Label>
                    <Input id="name" data-testid="input-name" value={name} autoComplete={nameChoice === "real" ? "name" : "off"}
                      onChange={(e) => { setName(e.target.value); setError(null); }} />
                  </div>
                  {nameChoice === "pseudonym" && (
                    <div className="space-y-2">
                      <Label htmlFor="real">{t("your_real_name")}</Label>
                      <Input id="real" data-testid="input-realname" value={realName} autoComplete="name" aria-describedby="real-note"
                        onChange={(e) => { setRealName(e.target.value); setError(null); }} />
                      <p id="real-note" className="text-xs text-muted-foreground">{t("reveal_note")}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="role">{t("your_role")}</Label>
                <Input id="role" data-testid="input-role" value={claimedRole}
                  readOnly={!!info.boundRole}
                  placeholder={t("role_example")} onChange={(e) => { setClaimedRole(e.target.value); setError(null); }} />
                {info.boundRole && info.roleAttested && (
                  <p className="text-xs text-primary flex items-center gap-1.5" data-testid="text-role-bound">
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />{t("role_bound")}
                  </p>
                )}
              </div>

              {info.requiresRoleProof && !info.roleAttested && (
                <p className="text-sm text-destructive text-pretty" role="alert" data-testid="text-role-invite-required">{t("role_invite_required")}</p>
              )}

              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" data-testid="checkbox-adult" checked={adult}
                  onCheckedChange={(v) => { setAdult(v === true); setError(null); }} />
                {t("adult_confirm")}
              </label>

              {error && <p role="alert" data-testid="text-join-submit-error" className="text-sm text-destructive text-pretty">{error}</p>}

              <Button type="submit" data-testid="button-join" className="w-full"
                disabled={busy || !claimedRole || !adult || !name}>
                {t("join_title")}
              </Button>
            </form>
            <button data-testid="link-change-invite" className="link-quiet mt-6" onClick={() => {
              setInfo(null);
              setClaimedRole("");
              setName("");
              setRealName("");
              setNameChoice("pseudonym");
              setAdult(false);
              setError(null);
            }}>
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />{t("join_code")}
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}
