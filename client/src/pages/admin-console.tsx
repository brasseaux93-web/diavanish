import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Shell, PageHead } from "@/components/vault";
import { apiJson } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { PlatformSettings, Application, Facilitator, DataRequest, SecurityEvent, BlockedCountry, AuditEntry } from "@shared/schema";
import { PasskeyManager } from "@/components/passkey-manager";

/** A titled group inside a tab: heading, optional note, then content. No box. */
function Group({ title, note, count, children, testId }: { title: string; note?: ReactNode; count?: number; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div>
        <h2 className="section-title flex items-baseline gap-2">
          {title}{count != null && <span className="section-count">{count}</span>}
        </h2>
        {note && <p className="text-sm text-muted-foreground text-pretty mt-1 max-w-[65ch]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground border-t border-border pt-4">{children}</p>
);

export default function AdminConsole() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const fmtTime = (ms: number) => new Date(ms).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });

  const session = useQuery({ queryKey: ["/api/auth/session"] });
  useEffect(() => {
    if (session.data === null) navigate("/admin");
  }, [session.data]);

  const settings = useQuery<PlatformSettings>({ queryKey: ["/api/platform/settings"] });
  const applications = useQuery<Application[]>({ queryKey: ["/api/admin/applications"], refetchInterval: 5000 });
  const facilitators = useQuery<Facilitator[]>({ queryKey: ["/api/admin/facilitators"], refetchInterval: 5000 });
  const requests = useQuery<DataRequest[]>({ queryKey: ["/api/admin/data-requests"], refetchInterval: 5000 });
  const events = useQuery<SecurityEvent[]>({ queryKey: ["/api/admin/security-events", "?range=7d"], refetchInterval: 5000 });
  const blocked = useQuery<BlockedCountry[]>({ queryKey: ["/api/admin/blocked-countries"] });
  const audit = useQuery<{ chain: { total: number; intact: boolean }; entries: AuditEntry[] }>({
    queryKey: ["/api/admin/audit"], refetchInterval: 5000,
  });
  const analytics = useQuery<{
    rooms: { total: number; draft: number; live: number; closed: number; sealed: number };
    seats: { admitted: number; waiting: number; departed: number };
    entries: { approved: number; pending: number; rejected: number };
    followups: { open: number; kept: number; lapsed: number };
    summaries: { versions: number; locked: number; verifications: number };
  }>({ queryKey: ["/api/admin/analytics"], refetchInterval: 5000 });

  const [enrolToken, setEnrolToken] = useState<string | null>(null);
  const [newCountry, setNewCountry] = useState({ code: "", name: "" });
  const [purged, setPurged] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [erasing, setErasing] = useState<DataRequest | null>(null);

  /** Run a write, refresh what it touched, and say so when it fails (the demo administrator is read-only). */
  const run = async (fn: () => Promise<unknown>, keys: string[]) => {
    try {
      await fn();
      for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
      return true;
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
      return false;
    }
  };

  const decide = (id: number, approve: boolean) => run(async () => {
    const res = await apiJson<{ enrolmentToken: string | null }>("POST", `/api/admin/applications/${id}/decide`, { approve });
    if (approve && res.enrolmentToken) setEnrolToken(res.enrolmentToken);
  }, ["/api/admin/applications", "/api/admin/facilitators"]);

  const decideRequest = (id: number, decision: "completed" | "rejected") =>
    run(() => apiJson("POST", `/api/admin/data-requests/${id}/decide`, { decision }), ["/api/admin/data-requests"]);

  const runPurge = async () => {
    try {
      const res = await apiJson<{ rooms: number; ledgersKept: number; guestSessions: number; applications: number }>(
        "POST", "/api/admin/purge",
      );
      setPurged(t("purge_report", { rooms: res.rooms, ledgers: res.ledgersKept, guests: res.guestSessions, apps: res.applications }));
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    } finally {
      setPurgeOpen(false);
    }
  };

  if (!settings.data) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>
      </Shell>
    );
  }

  const s = settings.data;
  const apps = applications.data ?? [];
  const facs = facilitators.data ?? [];
  const reqs = requests.data ?? [];
  const openReqs = reqs.filter((r) => r.status === "open").length;
  const evs = events.data ?? [];
  const a = analytics.data;

  return (
    <Shell sessionRole="admin" title={t("admin_console")}>
      <PageHead title={t("admin_console")} />
      {(session.data as { demo?: boolean } | null)?.demo && (
        <p data-testid="text-demo-admin-readonly" className="text-sm text-muted-foreground -mt-3 mb-6 max-w-prose">
          {t("demo_admin_readonly")}
        </p>
      )}

      <Tabs defaultValue="settings">
        <div className="tabs-bar mb-6 sm:mb-8">
          <TabsList aria-label={t("admin_console")}>
            <TabsTrigger data-testid="tab-settings" value="settings">{t("tab_settings")}</TabsTrigger>
            <TabsTrigger data-testid="tab-facilitators" value="facilitators">
              {t("tab_facilitators")}{apps.length > 0 && <span className="count">{apps.length}</span>}
            </TabsTrigger>
            <TabsTrigger data-testid="tab-compliance" value="compliance">
              {t("tab_compliance")}{openReqs > 0 && <span className="count">{openReqs}</span>}
            </TabsTrigger>
            <TabsTrigger data-testid="tab-outcomes" value="outcomes">{t("tab_outcomes")}</TabsTrigger>
            <TabsTrigger data-testid="tab-security" value="security">{t("tab_security")}</TabsTrigger>
          </TabsList>
        </div>

        {/* Settings: platform defaults, sign-in policy, retention */}
        <TabsContent value="settings" className="mt-0 max-w-xl space-y-10">
          <Group title="Neutrality Engine (Groq)" testId="group-groq">
            <GroqNeutralityPanel />
          </Group>

          <Group title={t("tab_platform")} testId="group-platform">
            <PlatformPanel initial={s} />
          </Group>

          <Group title={t("tab_signin")} testId="group-signin">
            <SignInPolicy initial={s} />
          </Group>

          <PasskeyManager />

          <Group title={t("tab_retention")} testId="group-retention">
            <RetentionPanel initial={s} />
            <div className="border-t border-border pt-5 mt-6 space-y-3">
              <p className="text-sm text-muted-foreground text-pretty">{t("purge_note")}</p>
              <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-purge" variant="destructive" size="sm">{t("run_purge_now")}</Button>
                </DialogTrigger>
                <DialogContent data-testid="dialog-purge">
                  <DialogHeader>
                    <DialogTitle>{t("purge_confirm_title")}</DialogTitle>
                    <DialogDescription>{t("purge_note")}</DialogDescription>
                  </DialogHeader>
                  <div className="flex gap-2 justify-end">
                    <DialogClose asChild>
                      <Button variant="ghost" size="sm" data-testid="button-purge-cancel">{t("cancel")}</Button>
                    </DialogClose>
                    <Button variant="destructive" size="sm" data-testid="button-purge-confirm" onClick={runPurge}>{t("run_purge_now")}</Button>
                  </div>
                </DialogContent>
              </Dialog>
              {purged && <p className="text-sm" role="status" data-testid="text-purge-report">{t("purge_done")}: {purged}</p>}
            </div>
          </Group>
        </TabsContent>

        {/* Facilitators: applications waiting, then everyone with rights */}
        <TabsContent value="facilitators" className="mt-0 space-y-10 max-w-3xl">
          <Group title={t("tab_applications")} count={apps.length}>
            {enrolToken && (
              <div className="rounded-md bg-foreground/[0.04] p-4 space-y-2" role="status" data-testid="block-enrol-token">
                <p className="text-sm font-medium">{t("enrolment_link")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="mono-data break-all min-w-0 flex-1" data-testid="text-enrol-token">{enrolToken}</code>
                  <Button size="sm" variant="secondary" data-testid="button-copy-enrol"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(enrolToken); toast({ title: t("copied") }); }
                      catch { toast({ title: t("copy_failed"), variant: "destructive" }); }
                    }}>
                    <Copy className="h-3.5 w-3.5" aria-hidden />{t("copy")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEnrolToken(null)}>{t("close")}</Button>
                </div>
                <p className="text-xs text-muted-foreground text-pretty">{t("enrolment_note")}</p>
              </div>
            )}
            {apps.length === 0 ? <Empty>{t("applications_empty")}</Empty> : (
              <ul className="divide-line border-y border-border">
                {apps.map((ap) => (
                  <li key={ap.id} data-testid={`card-application-${ap.id}`} className="py-4 space-y-2">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="font-medium">{ap.name}</span>
                      <span className="text-sm text-muted-foreground break-all">{ap.email}</span>
                      <span className="text-sm text-muted-foreground">{[ap.country, ap.affiliation].filter(Boolean).join(" · ")}</span>
                    </p>
                    <p className="text-sm text-pretty max-w-[70ch]">{ap.experience}</p>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" data-testid={`button-approve-${ap.id}`} onClick={() => decide(ap.id, true)}>{t("approve")}</Button>
                      <Button size="sm" variant="ghost" data-testid={`button-reject-${ap.id}`} onClick={() => decide(ap.id, false)}>{t("reject")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <Group title={t("tab_facilitators")} count={facs.length}>
            {facs.length === 0 ? <Empty>{t("facilitators_empty")}</Empty> : (
              <ul className="divide-line border-y border-border">
                {facs.map((f) => (
                  <li key={f.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid={`row-facilitator-${f.id}`}>
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-medium truncate">{f.name}</p>
                      <p className="text-sm text-muted-foreground break-all">{f.email}</p>
                    </div>
                    <span className={`chip ${f.status === "active" ? "chip-ok" : ""}`}>{t(f.status === "active" ? "fac_active" : "fac_withdrawn")}</span>
                    {f.status === "active" ? (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        onClick={() => run(() => apiJson("POST", `/api/admin/facilitators/${f.id}/withdraw`), ["/api/admin/facilitators"])}>
                        {t("withdraw_rights")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary"
                        onClick={() => run(() => apiJson("POST", `/api/admin/facilitators/${f.id}/restore`), ["/api/admin/facilitators"])}>
                        {t("restore_rights")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </TabsContent>

        {/* Compliance */}
        <TabsContent value="compliance" className="mt-0 space-y-10 max-w-3xl">
          <Group title={t("data_requests")} count={reqs.length}>
            {reqs.length === 0 ? <Empty>{t("requests_empty")}</Empty> : (
              <ul className="divide-line border-y border-border">
                {reqs.map((r) => (
                  <li key={r.id} data-testid={`card-request-${r.id}`} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm"><span className="font-medium">{t(r.kind === "erasure" ? "req_erasure" : "req_access")}</span> · {r.requester}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(r.createdAt)}</p>
                    </div>
                    {r.status === "open" ? (
                      <div className="flex gap-2">
                        <Button size="sm" data-testid={`button-request-complete-${r.id}`}
                          onClick={() => (r.kind === "erasure" ? setErasing(r) : decideRequest(r.id, "completed"))}>
                          {t(r.kind === "erasure" ? "req_erase_complete" : "complete")}
                        </Button>
                        <Button size="sm" variant="ghost" data-testid={`button-request-reject-${r.id}`} onClick={() => decideRequest(r.id, "rejected")}>{t("reject")}</Button>
                      </div>
                    ) : (
                      <span className={`chip ${r.status === "completed" ? "chip-ok" : ""}`}>{t(r.status === "completed" ? "complete" : "rejected")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <Group title={t("blocked_countries")}>
            {(blocked.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t("blocked_empty")}</p> : (
              <ul className="flex flex-wrap gap-2">
                {(blocked.data ?? []).map((c) => (
                  <li key={c.id} className="inline-flex items-center gap-2 rounded-md bg-foreground/[0.06] ps-2.5 pe-1 h-8 text-sm">
                    <span className="mono-data text-xs text-muted-foreground">{c.code}</span>
                    {c.name}
                    <button type="button" aria-label={t("remove_country", { name: c.name })}
                      onClick={() => run(() => apiJson("DELETE", `/api/admin/blocked-countries/${c.id}`), ["/api/admin/blocked-countries"])}
                      className="touch-target grid place-items-center h-6 w-6 rounded-sm text-muted-foreground hover:text-destructive hover:bg-foreground/[0.06]">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="flex flex-wrap gap-2 max-w-md" onSubmit={async (e) => {
              e.preventDefault();
              if (!newCountry.code || !newCountry.name) return;
              if (await run(() => apiJson("POST", "/api/admin/blocked-countries", newCountry), ["/api/admin/blocked-countries"])) {
                setNewCountry({ code: "", name: "" });
              }
            }}>
              <Input placeholder={t("code")} aria-label={t("code")} value={newCountry.code} maxLength={2} className="w-20 mono-data uppercase"
                onChange={(e) => setNewCountry({ ...newCountry, code: e.target.value })} />
              <Input placeholder={t("name")} aria-label={t("name")} value={newCountry.name} className="flex-1 min-w-40"
                onChange={(e) => setNewCountry({ ...newCountry, name: e.target.value })} />
              <Button type="submit" variant="secondary" disabled={!newCountry.code || !newCountry.name}>{t("add_country")}</Button>
            </form>
          </Group>

          <Group title={t("audit_log")}
            note={audit.data ? (
              <span data-testid="text-chain-status" className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${audit.data.chain.intact ? "" : "text-destructive"}`}>
                <span className={`inline-flex items-center gap-1 font-medium ${audit.data.chain.intact ? "text-primary" : ""}`}>
                  {audit.data.chain.intact ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                  {t(audit.data.chain.intact ? "chain_intact" : "chain_broken")}
                </span>
                <span>{t("chain_note", { n: audit.data.chain.total })}</span>
              </span>
            ) : undefined}>
            {(audit.data?.entries ?? []).length === 0 ? <Empty>{t("no_items")}</Empty> : (
              <ul className="divide-line border-y border-border max-h-[28rem] overflow-y-auto" tabIndex={0} aria-label={t("audit_log")}>
                {(audit.data?.entries ?? []).map((e) => (
                  <li key={e.id} className="py-2 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,9.5rem)_minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs items-baseline">
                    <time className="text-muted-foreground" dateTime={new Date(e.createdAt).toISOString()}>{fmtTime(e.createdAt)}</time>
                    <span className="text-muted-foreground truncate">{e.actor}</span>
                    <span className="mono-data [overflow-wrap:anywhere] col-span-2 sm:col-span-1">{e.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </TabsContent>

        {/* Outcomes */}
        <TabsContent value="outcomes" className="mt-0 max-w-2xl">
          <Group title={t("outcomes_title")} note={t("outcomes_note")}>
            {a ? (
              <dl className="divide-line border-y border-border" data-testid="card-analytics">
                {([
                  [t("rooms_total"), t("rooms_live_sealed", { live: a.rooms.live, sealed: a.rooms.sealed, total: a.rooms.total })],
                  [t("seats"), t("seats_counts", { admitted: a.seats.admitted, waiting: a.seats.waiting })],
                  [t("entries"), t("entries_counts", { approved: a.entries.approved, pending: a.entries.pending })],
                  [t("followups_kept"), t("followups_counts", { kept: a.followups.kept, lapsed: a.followups.lapsed, open: a.followups.open })],
                  [t("summaries_written"), String(a.summaries.versions)],
                  [t("verifications"), String(a.summaries.verifications)],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="py-3 grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-6">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-sm tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>}
          </Group>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-0 max-w-3xl">
          <Group title={t("tab_security")} note={t("security_range")} count={evs.length}>
            {evs.length === 0 ? <Empty>{t("security_empty")}</Empty> : (
              <ul className="divide-line border-y border-border">
                {evs.map((e) => (
                  <li key={e.id} className="py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="mono-data text-xs">{e.kind}</span>
                    <span className="text-sm text-muted-foreground min-w-0 flex-1 basis-56 break-words">{e.detail}</span>
                    <time className="text-xs text-muted-foreground" dateTime={new Date(e.createdAt).toISOString()}>{fmtTime(e.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </TabsContent>
      </Tabs>

      <Dialog open={!!erasing} onOpenChange={(v) => { if (!v) setErasing(null); }}>
        <DialogContent data-testid="dialog-erase">
          <DialogHeader>
            <DialogTitle>{t("req_erase_title")}</DialogTitle>
            <DialogDescription>{erasing?.requester}. {t("req_erase_confirm")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" data-testid="button-erase-cancel" onClick={() => setErasing(null)}>{t("cancel")}</Button>
            <Button variant="destructive" size="sm" data-testid="button-erase-confirm" onClick={async () => {
              if (erasing) await decideRequest(erasing.id, "completed");
              setErasing(null);
            }}>{t("req_erase_complete")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

/** A switch with its label; the note explains the consequence, when there is one. */
function SwitchRow({ id, label, note, checked, onChange, testId }: {
  id: string; label: string; note?: string; checked: boolean; onChange: (v: boolean) => void; testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {note && <p className="text-sm text-muted-foreground mt-1 text-pretty">{note}</p>}
      </div>
      <Switch id={id} data-testid={testId} checked={checked} onCheckedChange={onChange} className="shrink-0 mt-0.5" />
    </div>
  );
}

/** Each settings form sends only its own fields, so saving one never overwrites another. */
function useSettingsSave() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const save = async (fields: Partial<PlatformSettings> | Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await apiJson<PlatformSettings>("PATCH", "/api/platform/settings", fields);
      qc.setQueryData(["/api/platform/settings"], res);
      toast({ title: t("saved") });
      return res;
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

function SignInPolicy({ initial }: { initial: PlatformSettings }) {
  const { t } = useI18n();
  const { save, busy } = useSettingsSave();
  const [form, setForm] = useState({
    requirePasskey: !!initial.requirePasskey,
    emailCodeEnabled: initial.emailCodeEnabled !== 0,
  });
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(form); }}>
      <SwitchRow id="require-passkey" testId="switch-require-passkey" label={t("require_passkey")} note={t("require_passkey_note")}
        checked={form.requirePasskey} onChange={(v) => setForm({ ...form, requirePasskey: v })} />
      <SwitchRow id="email-codes" testId="switch-email-codes" label={t("email_code_enabled")}
        checked={form.emailCodeEnabled} onChange={(v) => setForm({ ...form, emailCodeEnabled: v })} />
      <Button type="submit" size="sm" data-testid="button-save-signin" disabled={busy}>{t("save")}</Button>
    </form>
  );
}

function GroqNeutralityPanel() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("diavanish_groq_key") || "");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);

  useEffect(() => {
    apiJson<{ configured: boolean; model: string }>("GET", "/api/neutrality/status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!apiKey.trim() && !status?.configured) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiJson<{ ok: boolean; models?: string[]; error?: string }>("POST", "/api/neutrality/test-key", {
        apiKey: apiKey.trim() || undefined,
      });
      setTestResult(res);
      if (res.ok) {
        if (apiKey.trim()) sessionStorage.setItem("diavanish_groq_key", apiKey.trim());
        toast({ title: "Groq Connection Validated", description: "In-memory connection active." });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || "Failed to test key" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-[#0e1014] p-5 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
        <div>
          <span className="text-sm font-semibold text-white">Groq Neutrality Engine</span>
          <p className="text-xs text-neutral-400 mt-0.5">
            Ephemeral Harvard Negotiation multi-agent pipeline {status?.model ? `· ${status.model}` : ""}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium ${
          status?.configured || testResult?.ok
            ? "border border-emerald-800/60 bg-emerald-950/40 text-emerald-400"
            : "border border-amber-800/60 bg-amber-950/40 text-amber-300"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status?.configured || testResult?.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
          {status?.configured ? "Server Configured" : testResult?.ok ? "Session Active" : "Unconfigured"}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <Label htmlFor="admin-groq-key" className="text-xs font-medium text-neutral-300">API Key Template</Label>
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-1 text-[11px]">
            <span>Get Groq Key</span>
          </a>
        </div>
        <div className="flex gap-2">
          <Input
            id="admin-groq-key"
            type="password"
            placeholder="gsk_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="font-mono bg-[#12141a] border-neutral-800 text-white text-xs flex-1"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleTest}
            disabled={testing || (!apiKey.trim() && !status?.configured)}
            className="shrink-0"
          >
            {testing ? "Testing..." : apiKey.trim() ? "Test & Save Session" : "Test Server Key"}
          </Button>
        </div>
      </div>

      {testResult && (
        <div className={`p-3 rounded-lg text-xs ${testResult.ok ? "bg-emerald-950/20 border border-emerald-900/60 text-emerald-300" : "bg-red-950/20 border border-red-900/60 text-red-300"}`}>
          {testResult.ok ? (
            <div>
              <p className="font-medium">Connection verified successfully!</p>
              <p className="text-[11px] text-neutral-400 mt-1">Available models: {testResult.models?.slice(0, 3).join(", ") || "llama-3.3-70b-versatile"}...</p>
            </div>
          ) : (
            <p>{testResult.error}</p>
          )}
        </div>
      )}

      <p className="text-[11px] text-neutral-500 leading-relaxed">
        Zero Disk Logging Guarantee: API keys and conversation drafts are processed strictly in RAM and never written to the SQLite database.
      </p>
    </div>
  );
}

function PlatformPanel({ initial }: { initial: PlatformSettings }) {
  const { t } = useI18n();
  const { save, busy } = useSettingsSave();
  const [form, setForm] = useState({
    orgName: initial.orgName,
    defaultTurnMinutes: initial.defaultTurnMinutes,
    requireRoleProofsDefault: !!initial.requireRoleProofsDefault,
  });
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      const res = await save(form);
      // The server clamps the turn length; show what was actually stored.
      if (res) setForm((f) => ({ ...f, defaultTurnMinutes: res.defaultTurnMinutes }));
    }}>
      <div className="space-y-2">
        <Label htmlFor="orgName">{t("org_name")}</Label>
        <Input id="orgName" value={form.orgName} required
          onChange={(e) => setForm({ ...form, orgName: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="turn">{t("default_turn")}</Label>
        <Input id="turn" type="number" min={5} max={15} className="w-28" value={form.defaultTurnMinutes} aria-describedby="turn-hint"
          onChange={(e) => setForm({ ...form, defaultTurnMinutes: Number(e.target.value) })} />
        <p id="turn-hint" className="text-xs text-muted-foreground">{t("turn_range")}</p>
      </div>
      <SwitchRow id="proofs" label={t("require_proofs")}
        checked={form.requireRoleProofsDefault} onChange={(v) => setForm({ ...form, requireRoleProofsDefault: v })} />
      <Button type="submit" size="sm" data-testid="button-save-platform" disabled={busy}>{t("save")}</Button>
    </form>
  );
}

function RetentionPanel({ initial }: { initial: PlatformSettings }) {
  const { t } = useI18n();
  const { save, busy } = useSettingsSave();
  const [form, setForm] = useState({
    closedRoomRetentionDays: initial.closedRoomRetentionDays,
    guestSessionRetentionDays: initial.guestSessionRetentionDays,
    applicationRetentionDays: initial.applicationRetentionDays,
    sealedLedgerKept: !!initial.sealedLedgerKept,
  });
  const days: { id: string; key: "closedRoomRetentionDays" | "guestSessionRetentionDays" | "applicationRetentionDays"; label: string }[] = [
    { id: "crd", key: "closedRoomRetentionDays", label: t("closed_room_days") },
    { id: "gsd", key: "guestSessionRetentionDays", label: t("guest_session_days") },
    { id: "ad", key: "applicationRetentionDays", label: t("application_days") },
  ];
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      const res = await save(form);
      // Out-of-range values fall back or clamp on the server; show what was stored.
      if (res) setForm({
        closedRoomRetentionDays: res.closedRoomRetentionDays,
        guestSessionRetentionDays: res.guestSessionRetentionDays,
        applicationRetentionDays: res.applicationRetentionDays,
        sealedLedgerKept: !!res.sealedLedgerKept,
      });
    }}>
      {days.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-6">
          <Label htmlFor={d.id}>{d.label}</Label>
          <Input id={d.id} type="number" min={1} max={3650} className="w-28 shrink-0" value={form[d.key]}
            data-testid={`input-${d.key}`}
            onChange={(e) => setForm({ ...form, [d.key]: Number(e.target.value) })} />
        </div>
      ))}
      <SwitchRow id="sealed" label={t("sealed_kept")}
        checked={form.sealedLedgerKept} onChange={(v) => setForm({ ...form, sealedLedgerKept: v })} />
      <Button type="submit" size="sm" data-testid="button-save-retention" disabled={busy}>{t("save")}</Button>
    </form>
  );
}
