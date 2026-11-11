import { ReactNode, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useNarrow } from "@/hooks/use-narrow";
import { setSessionToken, apiJson, isDemoMode } from "@/lib/queryClient";
import { CONTACT_EMAIL } from "@shared/contact";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, LogIn, LogOut, ShieldCheck, Users, KeyRound, Play, RotateCcw, X, Globe, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LegalDialogHost, LegalFooterLinks } from "@/components/legal-dialogs";

/* ── Diavanish brand: icon and wordmark (client/public/icon.svg, wordmark.svg) ── */

export function DiavanishMark({ size = 28, alive = false }: { size?: number; open?: boolean; alive?: boolean }) {
  return (
    <img src="./icon.svg" width={size} height={Math.round(size * 181 / 167)} alt="" aria-hidden="true"
      className={alive ? "breathe" : undefined} style={{ width: size, height: "auto" }} draggable={false} />
  );
}

export function DiavanishWordmark({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <img src="./wordmark.svg" alt="Diavanish" height={height} width={Math.round(height * 1209 / 286)}
      className={className} style={{ height, width: "auto" }} draggable={false} />
  );
}

/* ── Status dot ── */

export function StatusDot({ tone }: { tone: "ok" | "warn" | "off" | "seal" | "primary" }) {
  const colors: Record<string, string> = {
    ok: "bg-[hsl(var(--ok))]",
    warn: "bg-[hsl(var(--warn))]",
    off: "bg-muted-foreground",
    seal: "bg-[hsl(var(--seal))]",
    primary: "bg-primary",
  };
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[tone]}`} aria-hidden="true" />;
}

/* ── Shell: top bar + language toggle ── */

export type Crumb = { label: ReactNode; to?: string };
type SessionInfo = { role: "admin" | "facilitator" | "participant"; demo?: boolean; email?: string; name?: string; pseudonym?: string } | null;

/** What this server offers. Demos are off unless the operator turned them on. */
export type PublicConfig = { demo: boolean };
export function usePublicConfig() {
  return useQuery<PublicConfig>({ queryKey: ["/api/public/config"] });
}

/** One click into any role on sample data. `available` is false (buttons hidden) until the server says demos are on. */
export function useStartDemo() {
  const [, navigate] = useLocation();
  const config = usePublicConfig();
  const available = config.data?.demo === true;
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (role: "admin" | "facilitator" | "participant" | "verifier") => {
    setBusy(role);
    try {
      const r = await apiJson<{ token: string | null; next: string; recoveryKey?: string }>("POST", "/api/demo/start", { role });
      if (r.token) setSessionToken(r.token, r.recoveryKey ?? null, true);
      navigate(r.next);
    } finally {
      setBusy(null);
    }
  };
  return { start, busy, available };
}

/* Listed by English name on purpose: anyone can find their way back to English. */
const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "ar", label: "Arabic", short: "AR" },
  { code: "fr", label: "French", short: "FR" },
  { code: "es", label: "Spanish", short: "ES" },
] as const;

function LangSwitch() {
  const { lang, setLang, dir } = useI18n();
  const narrow = useNarrow();
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="lang-switch"
          aria-label={`Language: ${current.label} ${current.short}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-neutral-800 bg-[#14171d] hover:bg-neutral-800 text-xs font-medium text-neutral-300 transition-colors"
          lang="en"
          dir="ltr"
        >
          <Globe className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
          <span className={narrow ? "font-mono text-[0.6875rem]" : undefined}>{narrow ? current.short : current.label}</span>
          <ChevronDown className="h-3 w-3 text-neutral-400 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 border-neutral-800 bg-[#111317] text-neutral-200">
        <DropdownMenuLabel className="text-xs font-normal text-neutral-400" lang="en" dir="ltr">Language</DropdownMenuLabel>
        {LANGS.map((l) => (
          <DropdownMenuItem
            key={l.code}
            data-testid={`button-lang-${l.code}`}
            onSelect={() => setLang(l.code)}
            className="hover:bg-neutral-800 text-xs cursor-pointer"
            lang="en"
            dir="ltr"
          >
            <span className="flex-1">{l.label}</span>
            {l.code === lang && <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Shell({
  children,
  title,
  crumbs,
  room = false,
  wide = false,
}: {
  children: ReactNode;
  title?: ReactNode;
  crumbs?: Crumb[];
  sessionRole?: string | null;
  /** Live room layout: wider, tighter vertical rhythm so the chat panel can fill the window. */
  room?: boolean;
  /** Product showcase layout: aligns wider enterprise framing across header, content, and footer. */
  wide?: boolean;
}) {
  const { t, dir } = useI18n();
  const [location, navigate] = useLocation();
  const maxW = room || wide ? "max-w-7xl" : "max-w-6xl";
  const session = useQuery<SessionInfo>({ queryKey: ["/api/auth/session"] });
  const me = session.data ?? null;
  const demo = useStartDemo();
  const demoOn = isDemoMode() && !!me;

  const signOut = async () => {
    try { await apiJson("POST", "/api/auth/logout"); } catch { /* already gone */ }
    setSessionToken(null);
    navigate("/");
  };
  const resetDemo = async () => {
    await apiJson("POST", "/api/demo/reset");
    const role = me?.role;
    setSessionToken(null);
    if (role) await demo.start(role);
  };

  const nav: { label: string; to: string; id: string }[] =
    me?.role === "admin" ? [{ label: t("nav_console"), to: "/admin/console", id: "console" }]
    : me?.role === "facilitator" ? [{ label: t("nav_rooms"), to: "/facilitate/rooms", id: "rooms" }]
    : me?.role === "participant" ? [{ label: t("nav_my_room"), to: "/p", id: "myroom" }]
    : [{ label: t("nav_join"), to: "/join", id: "join" }];
  nav.push({ label: t("nav_verify"), to: "/verify", id: "verify" });
  if (!me) nav.push({ label: t("nav_orgs"), to: "/organisations", id: "orgs" });

  // The header only carries ways back. The page's own heading says where you are.
  const trail: Crumb[] = (crumbs ?? []).filter((c) => !!c.to);
  void title;
  const roleLabel = me ? t(`role_${me.role}`) : "";

  return (
    <div className="min-h-dvh flex flex-col relative overflow-x-clip">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#090a0c]/85 border-b border-neutral-800/60 transition-colors">
        <div className={`mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 min-w-0 ${maxW}`}>
          {/* Brand Logo & Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              data-testid="button-home"
              onClick={() => navigate("/")}
              className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
              aria-label={t("diavanish")}
            >
              <DiavanishMark size={22} />
              <DiavanishWordmark height={17} className="max-[359px]:hidden" />
            </button>

            {trail.length > 0 && (
              <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-2 min-w-0 ms-2 text-sm">
                {trail.map((c, i) => (
                  <span key={i} className="flex items-center gap-2 min-w-0">
                    <ChevronRight className="h-3.5 w-3.5 text-neutral-500 shrink-0 rtl:rotate-180" aria-hidden />
                    <button
                      data-testid={`crumb-${i}`}
                      onClick={() => navigate(c.to!)}
                      className="text-neutral-400 hover:text-neutral-200 transition-colors truncate text-xs"
                    >
                      {c.label}
                    </button>
                  </span>
                ))}
              </nav>
            )}
          </div>

          {/* Center/Right Nav Links & Actions */}
          <div className="flex items-center gap-4 sm:gap-6 min-w-0">
            <nav className="hidden md:flex items-center gap-5 sm:gap-7" aria-label="Primary">
              {nav.map((n) => (
                <button
                  key={n.id}
                  data-testid={`nav-${n.id}`}
                  onClick={() => navigate(n.to)}
                  className={`text-xs sm:text-sm font-medium transition-colors ${
                    location.startsWith(n.to)
                      ? "text-white font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                  aria-current={location.startsWith(n.to) ? "page" : undefined}
                >
                  {n.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-2.5">
              {me ? (
                <DropdownMenu dir={dir}>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-testid="button-account"
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-neutral-800 bg-[#14171d] hover:bg-neutral-800 text-xs text-neutral-200 transition-colors"
                      aria-label={roleLabel}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                      <span className="max-w-[12ch] truncate max-[359px]:hidden">{roleLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-neutral-400 opacity-70" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60 border-neutral-800 bg-[#111317] text-neutral-200">
                    <DropdownMenuLabel className="font-normal">
                      <span className="block text-xs text-neutral-400">{t("signed_in_as")}</span>
                      <span className="block truncate font-medium text-white">{me.name || me.email || me.pseudonym || roleLabel}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-neutral-800" />
                    {nav.map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        data-testid={`menu-nav-${n.id}`}
                        onSelect={() => navigate(n.to)}
                        className="hover:bg-neutral-800 text-xs cursor-pointer"
                      >
                        {n.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator className="bg-neutral-800" />
                    <DropdownMenuItem
                      data-testid="button-signout"
                      onSelect={signOut}
                      className="hover:bg-neutral-800 text-xs text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 me-2" aria-hidden />{t("sign_out")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <DropdownMenu dir={dir}>
                    <DropdownMenuTrigger asChild>
                      <button
                        data-testid="button-signin-menu"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-800 bg-[#111317] hover:bg-neutral-800 text-xs font-medium text-neutral-200 transition-colors"
                        aria-label={t("sign_in")}
                        title={t("sign_in")}
                      >
                        <LogIn className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
                        <span>{t("sign_in")}</span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 border-neutral-800 bg-[#111317] text-neutral-200">
                      <DropdownMenuLabel className="text-xs font-normal text-neutral-400">{t("sign_in_as")}</DropdownMenuLabel>
                      <DropdownMenuItem data-testid="menu-signin-admin" onSelect={() => navigate("/admin")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        <ShieldCheck className="h-4 w-4 me-2 text-neutral-400" aria-hidden />{t("role_admin")}
                      </DropdownMenuItem>
                      <DropdownMenuItem data-testid="menu-signin-facilitator" onSelect={() => navigate("/facilitate")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        <Users className="h-4 w-4 me-2 text-neutral-400" aria-hidden />{t("role_facilitator")}
                      </DropdownMenuItem>
                      <DropdownMenuItem data-testid="menu-signin-participant" onSelect={() => navigate("/join")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        <KeyRound className="h-4 w-4 me-2 text-neutral-400" aria-hidden />{t("role_participant")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-neutral-800" />
                      <DropdownMenuItem data-testid="menu-recover" onSelect={() => navigate("/join/recover")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        {t("recover_seat_nav")}
                      </DropdownMenuItem>
                      <DropdownMenuItem data-testid="menu-apply" onSelect={() => navigate("/facilitate?mode=apply")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        {t("apply_access")}
                      </DropdownMenuItem>
                      <DropdownMenuItem data-testid="menu-verify" onSelect={() => navigate("/verify")} className="hover:bg-neutral-800 text-xs cursor-pointer">
                        {t("verify_nav")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="md:hidden hover:bg-neutral-800 text-xs cursor-pointer" data-testid="menu-orgs" onSelect={() => navigate("/organisations")}>
                        {t("nav_orgs")}
                      </DropdownMenuItem>
                      {demo.available && (
                        <>
                          <DropdownMenuSeparator className="bg-neutral-800" />
                          <DropdownMenuLabel className="text-xs font-normal text-neutral-400">{t("run_demo")}</DropdownMenuLabel>
                          {(["admin", "facilitator", "participant", "verifier"] as const).map((r) => (
                            <DropdownMenuItem
                              key={r}
                              data-testid={`menu-demo-${r}`}
                              onSelect={() => demo.start(r)}
                              className="hover:bg-neutral-800 text-xs cursor-pointer"
                            >
                              <Play className="h-3.5 w-3.5 me-2 text-amber-400" aria-hidden />{t(`role_${r}`)}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {demo.available ? (
                    <button
                      type="button"
                      data-testid="button-header-demo"
                      onClick={() => demo.start("participant")}
                      disabled={!!demo.busy}
                      className="hidden sm:inline-flex items-center gap-1.5 bg-white text-black hover:bg-neutral-200 font-medium px-3.5 py-1.5 rounded-md text-xs transition-all shadow-sm shrink-0"
                    >
                      <Play className="h-3 w-3 fill-current shrink-0" aria-hidden />
                      <span>{demo.busy === "participant" ? t("demo_starting") : t("entry_cta_demo")}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="button-header-apply"
                      onClick={() => navigate("/facilitate?mode=apply")}
                      className="hidden sm:inline-flex items-center gap-1.5 bg-white text-black hover:bg-neutral-200 font-medium px-3.5 py-1.5 rounded-md text-xs transition-all shadow-sm shrink-0"
                    >
                      <span>{t("header_apply")}</span>
                    </button>
                  )}
                </>
              )}

              <LangSwitch />
            </div>
          </div>
        </div>
        {demoOn && (
          <div className="demo-ribbon" data-testid="demo-ribbon">
            <div className={`mx-auto px-4 sm:px-6 h-9 flex items-center gap-3 text-xs sm:text-sm ${maxW}`}>
              <span className="demo-tag">{t("demo_mode")}</span>
              <span className="text-muted-foreground truncate hidden sm:inline">{t("demo_note")}</span>
              <div className="ms-auto flex items-center gap-1">
                <button data-testid="button-reset-demo" aria-label={t("reset_demo")} onClick={resetDemo} className="ribbon-btn">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /><span className="hidden sm:inline">{t("reset_demo")}</span>
                </button>
                <button data-testid="button-exit-demo" onClick={signOut} className="ribbon-btn">
                  <X className="h-3.5 w-3.5" aria-hidden /><span>{t("exit_demo")}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1} className="flex-1 relative z-[1] outline-none">
        <div key={location} className={`page-enter mx-auto px-4 sm:px-6 ${room ? `${maxW} pt-3 pb-5 sm:pt-6 sm:pb-8` : `${maxW} py-8 sm:py-14`}`}>{children}</div>
      </main>
      <footer className="mt-auto relative z-[1]">
        <div className={`mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-800/60 ${maxW}`}>
          <button onClick={() => navigate("/organisations")} data-testid="link-footer-orgs"
            className="min-h-11 sm:min-h-8 max-sm:min-w-[2.75rem] max-sm:px-2 text-xs text-neutral-400 hover:text-white transition-colors inline-flex items-center">
            {t("nav_orgs")}
          </button>
          <button onClick={() => navigate("/organisations?section=process")} data-testid="link-footer-process"
            className="min-h-11 sm:min-h-8 max-sm:min-w-[2.75rem] max-sm:px-2 text-xs text-neutral-400 hover:text-white transition-colors inline-flex items-center">
            {t("footer_process")}
          </button>
          <button onClick={() => navigate("/organisations?section=operator")} data-testid="link-footer-operator"
            className="min-h-11 sm:min-h-8 max-sm:min-w-[2.75rem] max-sm:px-2 text-xs text-neutral-400 hover:text-white transition-colors inline-flex items-center">
            {t("footer_operator")}
          </button>
          <a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-footer-support"
            className="min-h-11 sm:min-h-8 max-sm:min-w-[2.75rem] max-sm:px-2 text-xs text-neutral-400 hover:text-white transition-colors inline-flex items-center">
            {t("footer_support")}
          </a>
          <LegalFooterLinks />
        </div>
        <LegalDialogHost />
      </footer>
    </div>
  );
}

/* ── Page header ── */

/* The heading speaks for itself: no label above it. `kicker` is accepted for
   older callers and not rendered. */
export function PageHead({ title, note, action }: { kicker?: string; title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="max-w-2xl min-w-0">
        <h1 className="font-semibold text-2xl sm:text-3xl tracking-tight text-white leading-tight">{title}</h1>
        {note && <p className="mt-2 text-sm text-neutral-400 leading-relaxed text-pretty">{note}</p>}
      </div>
      {action}
    </div>
  );
}

/* ── Countdown ── */

export function useCountdown(endsAt: number | null | undefined, running: boolean) {
  const [left, setLeft] = useState(() =>
    endsAt && running ? Math.max(0, endsAt - Date.now()) : 0,
  );
  useEffect(() => {
    if (!endsAt || !running) return;
    setLeft(Math.max(0, endsAt - Date.now()));
    const id = setInterval(() => {
      const l = Math.max(0, endsAt - Date.now());
      setLeft(l);
      if (l === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [endsAt, running]);
  const totalSec = Math.ceil(left / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const mins = Math.ceil(left / 60000);
  return { display: `${mm}:${ss}`, done: left <= 0, left, mins };
}

/** Coarse, unhurried time: "About 6 min left" — no ticking seconds. */
export function CalmTime({ endsAt, running, totalMs, testId }: { endsAt: number | null | undefined; running: boolean; totalMs?: number; testId?: string }) {
  const { t } = useI18n();
  const c = useCountdown(endsAt, running);
  if (!running || !endsAt || c.done) return null;
  const pct = totalMs ? Math.max(0, Math.min(100, (c.left / totalMs) * 100)) : null;
  return (
    <span className="inline-flex flex-col gap-1.5 min-w-[7.5rem]" data-testid={testId}>
      <span className="text-sm text-muted-foreground">
        {c.left < 60000 ? t("time_left_under") : t("time_left_min", { n: c.mins })}
      </span>
      {pct !== null && <span className="time-line" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
    </span>
  );
}

/** A slow breathing iris for moments of waiting. */
export function BreathingIris({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative grid place-items-center h-28 w-28">
        <span className="absolute inset-0 rounded-full border border-[hsl(var(--primary)/0.25)] breathe" />
        <span className="absolute inset-5 rounded-full bg-[hsl(var(--primary)/0.06)] breathe" style={{ animationDelay: "-0.4s" }} />
        <DiavanishMark size={40} />
      </div>
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
    </div>
  );
}

/* ── Sealed drafts: AES-GCM in the browser, passphrase never leaves it ── */

export async function encryptDraft(text: string, passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aes = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(text));
  return btoa(JSON.stringify({
    salt: Array.from(salt), iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)),
  }));
}

export async function decryptDraft(payload: string, passphrase: string): Promise<string> {
  const { salt, iv, ct } = JSON.parse(atob(payload));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  const aes = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 100000, hash: "SHA-256" }, key,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) }, aes, new Uint8Array(ct),
  );
  return new TextDecoder().decode(pt);
}

/* ── Demo entry button (used on sign-in pages) ── */

export function DemoButton({
  role,
  demo,
  className = "",
}: {
  role: "admin" | "facilitator" | "participant" | "verifier";
  demo: ReturnType<typeof useStartDemo>;
  className?: string;
}) {
  const { t } = useI18n();
  if (!demo.available) return null;
  return (
    <div className={`pt-4 border-t border-border ${className}`}>
      <button
        data-testid={`button-demo-${role}`}
        onClick={() => demo.start(role)}
        disabled={!!demo.busy}
        className="link-quiet"
      >
        {demo.busy === role ? t("demo_starting") : `${t("run_demo")} · ${t(`role_${role}`)}`}
      </button>
    </div>
  );
}

