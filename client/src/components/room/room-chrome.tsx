/*
 * Room chrome: a compact header with status chips. The long security copy
 * lives in popovers so it no longer crowds the chat, but the two things that
 * must never be missed stay on screen: the demo "not end-to-end" warning and
 * a changed safety code.
 */
import { ReactNode } from "react";
import { AlertTriangle, Info, KeyRound, Lock, LockOpen, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRoomCrypto } from "@/lib/e2ee-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The room stopped answering. Nothing is signed out; the page keeps trying. */
export function ConnectionNotice() {
  const { t } = useI18n();
  return (
    <p role="status" data-testid="text-connection-lost"
      className="mb-4 flex items-center gap-2 border-y border-[hsl(var(--warn))]/40 py-2 text-sm text-[hsl(var(--warn))]">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      {t("connection_lost")}
    </p>
  );
}

export function LiveChip({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === "live" ? "chip chip-live" : status === "sealed" ? "chip chip-seal" : "chip";
  return (
    <span className={cls} data-testid="chip-status">
      {status === "live" && <span className="h-1.5 w-1.5 rounded-full bg-current breathe" aria-hidden />}
      {t(status)}
    </span>
  );
}

/** Encryption state. In demo rooms the label itself says "not end-to-end". */
export function E2EEChip({ extra }: { extra?: ReactNode }) {
  const { t } = useI18n();
  const c = useRoomCrypto();
  const ready = c.status === "ready";
  const cls = c.status === "error" ? "chip chip-danger" : !ready ? "chip" : c.demo ? "chip chip-warn" : "chip chip-ok";
  const label = c.status === "error" ? t("e2ee_error_short")
    : !ready ? t("e2ee_preparing_short")
    : c.demo ? t("e2ee_demo_short") : t("e2ee_short");
  const Icon = c.status === "error" ? AlertTriangle : !ready ? Loader2 : c.demo ? LockOpen : Lock;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cls} data-testid="chip-e2ee" aria-label={`${t("e2ee_details")}: ${label}`}>
          <Icon className={!ready && c.status !== "error" ? "animate-spin" : undefined} aria-hidden />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="space-y-2">
        <p className="font-medium">{t("e2ee_details")}</p>
        <p className={`text-sm leading-relaxed ${c.demo ? "text-[hsl(var(--warn))]" : c.status === "ready" ? "text-[hsl(var(--ok))]" : "text-muted-foreground"}`}
          data-testid="text-e2ee-detail">
          {c.status === "error" ? t("e2ee_error") : c.status !== "ready" ? t("e2ee_waiting") : c.demo ? t("e2ee_demo") : t("e2ee_on")}
        </p>
        {!c.demo && <p className="text-xs text-muted-foreground leading-relaxed">{t("chat_note")}</p>}
        {extra}
      </PopoverContent>
    </Popover>
  );
}

/** The safety code as a chip; the explanation opens on demand. */
export function SafetyChip({ testId = "text-safety-code" }: { testId?: string }) {
  const { t } = useI18n();
  const c = useRoomCrypto();
  if (c.status !== "ready" || !c.safety) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={c.safetyChanged ? "chip chip-warn" : "chip"} data-testid="block-safety">
          <KeyRound aria-hidden />
          <span className="hidden sm:inline">{t("safety_code")}</span>
          <span className="sr-only sm:hidden">{t("safety_code")} </span>
          <code className="mono-data tracking-wider text-foreground" data-testid={testId}>{c.safety}</code>
        </button>
      </PopoverTrigger>
      <PopoverContent className="space-y-2">
        <p className="font-medium">{t("safety_code")}</p>
        <p className="metal metal-strip mono-data text-xl tracking-[0.14em] text-center">{c.safety}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("safety_note")}</p>
        {c.safetyChanged && <p className="text-sm text-[hsl(var(--warn))]">{t("safety_changed")}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** Stays on screen until the code is compared again; never hidden in a popover. */
export function SafetyAlert() {
  const { t } = useI18n();
  const c = useRoomCrypto();
  if (!c.safetyChanged) return null;
  return (
    <p role="alert" data-testid="text-safety-changed"
      className="flex items-start gap-2 rounded-md bg-[hsl(var(--warn)/0.1)] px-3.5 py-2.5 text-sm text-[hsl(var(--warn))]">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />{t("safety_changed")}
    </p>
  );
}

/** Phone-only: everything that is not Live or E2EE, in one sheet. */
function RoomDetails({ code, chips, details }: { code: string; chips?: ReactNode; details?: ReactNode }) {
  const { t } = useI18n();
  const c = useRoomCrypto();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="chip room-details-btn" data-testid="button-room-details" aria-label={t("room_details")}>
          <Info aria-hidden /><span className="sr-only">{t("details")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-4" data-testid="sheet-room-details">
        <div>
          <p className="side-title !mb-1">{t("room_code")}</p>
          <p className="mono-data text-sm">{code}</p>
        </div>
        {c.status === "ready" && c.safety && (
          <div>
            <p className="side-title !mb-1">{t("safety_code")}</p>
            <p className={`metal metal-strip mono-data text-lg tracking-[0.14em] ${c.safetyChanged ? "text-[hsl(var(--warn))]" : ""}`}>{c.safety}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("safety_note")}</p>
          </div>
        )}
        {chips && <div className="flex flex-wrap gap-1.5 empty:hidden">{chips}</div>}
        {details}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Desktop: title and code on the left, every chip on the right.
 * Phone: the title on one line with a Details button, then one row with only
 * Live and the E2EE chip (which carries the demo warning), so the chat starts
 * high on the screen. Safety code, stage and turn mode live in the sheet.
 */
export function RoomHeader({
  title, code, status, chips, actions, below, details, leading,
}: {
  title: ReactNode; code: string; status: string;
  chips?: ReactNode; actions?: ReactNode; below?: ReactNode;
  /** Extra phone-only sheet content (stage, turn mode). */
  details?: ReactNode;
  /** Phone-only control before the title, such as a back button. */
  leading?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="mb-3 sm:mb-4 space-y-1 sm:space-y-1.5" data-testid="room-header">
      <div className="flex items-center gap-x-2 sm:gap-x-4">
        {leading}
        <h1 dir="auto" className="user-text min-w-0 flex-1 font-display font-semibold text-[0.9375rem] sm:text-xl tracking-[-0.02em] leading-tight max-sm:truncate">{title}</h1>
        {actions && <span className="inline-flex shrink-0">{actions}</span>}
        <span className="sm:hidden shrink-0">
          <RoomDetails code={code} chips={chips} details={details} />
        </span>
      </div>
      {/* One line of facts, not a row of badges. Warnings keep their tint. */}
      <div className="room-meta room-chips">
        <LiveChip status={status} />
        <span className="hidden sm:inline" data-testid="text-room-code">
          <span className="sr-only">{t("room_code")} </span><span className="mono-data">{code}</span>
        </span>
        {status === "live" && <E2EEChip />}
        <span className="hidden sm:contents">
          {status === "live" && <SafetyChip />}
          {chips}
        </span>
      </div>
      <SafetyAlert />
      {below}
    </header>
  );
}
