/*
 * One chat surface for the participant floor, the facilitator floor and
 * caucus threads. It only renders lines that useEncryptedChat has already
 * decrypted and verified; translation (if any) happens after that, on the
 * device, and never changes what was verified.
 */
import { ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, Languages, LockKeyhole, SendHorizontal, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ChatLine } from "@/lib/e2ee-client";
import { buildItems, dayKey } from "./group";
import {
  translateIncoming, reportUnavailable, dismissUnavailableNote, subscribeUnavailable, unavailableNoteVisible,
  type TranslationResult,
} from "@/lib/translate";

type Readable = Extract<ChatLine, { text: string }>;
function useFormatters(lang: string, t: (k: string) => string) {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" });
    const date = new Intl.DateTimeFormat(lang, { weekday: "long", month: "long", day: "numeric" });
    const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([lang], { type: "language" }) : null;
    return {
      time: (ms: number) => (ms ? time.format(ms) : ""),
      day: (ms: number) => {
        const today = dayKey(Date.now());
        const yest = dayKey(Date.now() - 86400000);
        const k = dayKey(ms);
        return k === today ? t("today") : k === yest ? t("yesterday") : date.format(ms);
      },
      language: (code: string) => {
        try { return names?.of(code) ?? code; } catch { return code; }
      },
    };
  }, [lang, t]);
}

/* ── One bubble, translated on this device when it helps ── */

function Bubble({ line, translate }: { line: Readable; translate: boolean }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang, t);
  const [res, setRes] = useState<TranslationResult | null>(null);
  const [original, setOriginal] = useState(false);

  useEffect(() => {
    if (!translate) { setRes(null); return; }
    let alive = true;
    // `line.text` is the verified original; translation is display-only.
    translateIncoming(String(line.seq), line.text, lang).then((r) => {
      if (!alive) return;
      if (r.kind === "unavailable") reportUnavailable();
      setRes(r);
    });
    return () => { alive = false; };
  }, [line.seq, line.text, lang, translate]);

  const translated = res?.kind === "translated" ? res : null;
  const showing = translated && !original ? translated.text : line.text;
  return (
    <div className="bubble" data-testid={`chat-line-${line.seq}`}>
      <span dir="auto" lang={translated && !original ? lang : translated?.from}>{showing}</span>
      {translated && (
        <span className="bubble-tools" data-testid="text-translated">
          <Languages className="h-3 w-3" aria-hidden />
          <span>{original ? t("translated") : t("translated_from", { lang: fmt.language(translated.from) })}</span>
          <span aria-hidden>·</span>
          <button type="button" className="hit-expand" onClick={() => setOriginal((o) => !o)} data-testid="button-show-original"
            aria-pressed={original}>
            {original ? t("show_translation") : t("show_original")}
          </button>
        </span>
      )}
    </div>
  );
}

function TranslationNote() {
  const { t } = useI18n();
  const visible = useSyncExternalStore(subscribeUnavailable, unavailableNoteVisible, () => false);
  if (!visible) return null;
  return (
    <div className="chat-notice" role="status" data-testid="text-translate-unavailable">
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">{t("translate_unavailable")}</span>
      <button type="button" onClick={dismissUnavailableNote} aria-label={t("dismiss")}
        className="hit-expand rounded-md p-1 hover:text-foreground"><X className="h-3.5 w-3.5" aria-hidden /></button>
    </div>
  );
}

/* ── The shell ── */

export function ChatShell({
  lines, title, headerExtra, banner, onSend, canSend, lockedReason, placeholder, emptyBody,
  logLabel, facilitatorName, logTestId = "card-chat", inputTestId = "input-chat", sendTestId = "button-send-chat",
  className = "", translate = true, fill = false, compactHeadOnMobile = false,
}: {
  lines: ChatLine[];
  title: ReactNode;
  headerExtra?: ReactNode;
  /** Status above the log, e.g. waiting for the room key. */
  banner?: ReactNode;
  onSend: (text: string) => Promise<void>;
  canSend: boolean;
  /** Shown in the composer when sending is closed (floor held, waiting for keys). */
  lockedReason?: string | null;
  placeholder: string;
  emptyBody: string;
  logLabel: string;
  facilitatorName: string;
  logTestId?: string;
  inputTestId?: string;
  sendTestId?: string;
  className?: string;
  translate?: boolean;
  /** Size the panel to reach the bottom of the window (live room layout). */
  fill?: boolean;
  /** Hide the title row under 640px when a tab already names the view. */
  compactHeadOnMobile?: boolean;
}) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang, t);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const lastSeq = useRef<number | null>(null);
  const count = useRef(0);
  const hintId = useId();
  const root = useRef<HTMLElement>(null);

  // Fill the window below wherever the panel starts; re-measured each render
  // so banners, wrapping chips and the demo ribbon never push the composer off-screen.
  useLayoutEffect(() => {
    const el = root.current;
    if (!fill || !el) return;
    const size = () => {
      if (!el.offsetParent) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const min = window.innerWidth < 640 ? 440 : 480;
      el.style.height = `${Math.max(min, Math.round(window.innerHeight - top - 20))}px`;
    };
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  });

  const items = useMemo(() => buildItems(lines, facilitatorName, fmt.day), [lines, facilitatorName, fmt]);
  const tail = lines[lines.length - 1];
  const tailSeq = tail?.seq ?? null;

  // Follow new messages only while the reader is at the bottom; never yank
  // someone who scrolled up to reread. Their own message always scrolls.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const grew = tailSeq !== lastSeq.current;
    const added = Math.max(0, lines.length - count.current);
    const first = lastSeq.current === null;
    lastSeq.current = tailSeq;
    count.current = lines.length;
    if (!grew) return;
    const mineNow = !!tail && !("unreadable" in tail) && tail.mine;
    if (first || atBottom.current || mineNow) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [tailSeq, lines.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current && unseen) setUnseen(0);
  };
  const jump = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  };

  // Grow the composer with its text, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    // Empty: let CSS size it (one line). Otherwise grow with the text.
    el.style.height = "";
    if (text) el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const submit = async () => {
    const body = text.trim();
    if (!body || !canSend || busy) return;
    setBusy(true);
    try {
      atBottom.current = true;
      await onSend(body);
      setText("");
    } catch {
      /* the caller reports the error; keep the text so nothing is lost */
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const disabled = !canSend;
  return (
    <section ref={root} className={`chat-shell panel ${className}`} aria-label={logLabel}>
      <header className={`chat-head${compactHeadOnMobile ? " max-sm:hidden" : ""}`}>
        <h2 className={`font-display font-semibold text-[1.0625rem] tracking-[-0.03em] me-auto${headerExtra ? " max-sm:sr-only" : ""}`}>{title}</h2>
        {headerExtra}
      </header>
      {banner}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={scroller} onScroll={onScroll} className="chat-scroll" data-testid={logTestId}
          role="log" aria-live="polite" aria-relevant="additions" aria-label={logLabel} tabIndex={0}>
          {lines.length === 0 ? (
            <div className="chat-empty">
              <LockKeyhole className="h-5 w-5 text-muted-foreground mb-1" aria-hidden />
              <p className="font-medium">{t("chat_empty_title")}</p>
              {emptyBody && <p className="text-sm text-muted-foreground max-w-sm text-pretty">{emptyBody}</p>}
            </div>
          ) : items.map((it) => {
            if (it.kind === "day") return <div key={it.key} className="chat-day" role="separator">{it.label}</div>;
            if (it.kind === "system") return <p key={it.key} className="chat-system">{t("msg_unreadable")}</p>;
            const cls = `chat-group${it.mine ? " mine" : ""}${it.verified ? "" : " unverified"}`;
            return (
              <div key={it.key} className={cls}>
                <div className="chat-meta">
                  <span className={`who${it.facilitator ? " fac" : ""}`} dir="auto">
                    {it.mine ? `${t("chat_you")} · ${it.name}` : it.verified ? it.name : `“${it.name}”`}
                  </span>
                  {it.verified ? (
                    <span className="chat-badge ok" title={t("msg_verified_note")}>
                      <ShieldCheck aria-hidden /><span className="sr-only sm:not-sr-only">{t("msg_verified")}</span>
                    </span>
                  ) : (
                    <span className="chat-badge warn" title={t("msg_unverified_note")} data-testid="text-msg-unverified">
                      <ShieldAlert aria-hidden />{t("msg_unverified")}
                    </span>
                  )}
                  {it.at ? <time dateTime={new Date(it.at).toISOString()}>{fmt.time(it.at)}</time> : null}
                </div>
                {/* Only verified lines from others are translated; the check ran on the original text. */}
                {it.lines.map((l) => <Bubble key={l.seq} line={l} translate={translate && !it.mine && it.verified} />)}
                {!it.verified && <p className="text-[0.6875rem] text-[hsl(var(--warn))] px-1 max-w-sm">{t("msg_unverified_note")}</p>}
              </div>
            );
          })}
        </div>
        {unseen > 0 && (
          <button type="button" className="chat-jump touch-target" onClick={jump} data-testid="button-chat-jump">
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />{t("chat_new_messages")} · {unseen}
          </button>
        )}
      </div>
      {translate && <TranslationNote />}
      {disabled && lockedReason && (
        <p className="px-4 pt-2.5 text-xs text-muted-foreground" role="status" data-testid="text-chat-locked">{lockedReason}</p>
      )}
      <div className="chat-composer">
        <textarea ref={input} rows={1} value={text} data-testid={inputTestId}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          disabled={disabled} aria-label={logLabel}
          placeholder={disabled && lockedReason ? t("input_paused") : placeholder}
          aria-describedby={hintId} />
        <button type="button" onClick={submit} disabled={disabled || !text.trim() || busy} data-testid={sendTestId}
          className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/88 disabled:opacity-45 disabled:pointer-events-none shrink-0">
          <SendHorizontal className="h-4 w-4 rtl:-scale-x-100" aria-hidden /><span className="hidden sm:inline">{t("send")}</span>
          <span className="sr-only sm:hidden">{t("send")}</span>
        </button>
      </div>
      <p id={hintId} className="sr-only">{t("chat_hint")}</p>
    </section>
  );
}
