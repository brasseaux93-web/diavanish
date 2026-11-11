/*
 * On-device translation of incoming chat, after decryption.
 *
 * Uses the browser's built-in Translator and LanguageDetector APIs (Chrome
 * 138+). Those run a model stored on this device; the text never leaves the
 * tab. There is deliberately no fallback to any server or cloud translator:
 * if the browser cannot translate locally, the reader sees the original.
 *
 * Nothing here touches signatures. Callers verify the original text first and
 * only hand the verified plaintext to translateIncoming() for display.
 */

export type TranslationResult =
  | { kind: "same" }                                  // already in the reader's language, or too short to tell
  | { kind: "translated"; text: string; from: string }
  | { kind: "unavailable" };                          // no on-device API or model for this pair

type Availability = "unavailable" | "downloadable" | "downloading" | "available";
type Detector = { detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> };
type TranslatorInstance = { translate(text: string): Promise<string> };
type TranslatorApi = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
};
type DetectorApi = { availability(): Promise<Availability>; create(): Promise<Detector> };

function apis(): { T: TranslatorApi; D: DetectorApi } | null {
  const g = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi };
  return g.Translator && g.LanguageDetector ? { T: g.Translator, D: g.LanguageDetector } : null;
}

/** True when this browser exposes the on-device translation APIs at all. */
export function translationApiPresent() {
  return apis() !== null;
}

const MIN_CONFIDENCE = 0.6;
const base = (tag: string) => tag.toLowerCase().split("-")[0];

let detector: Promise<Detector | null> | null = null;
const translators = new Map<string, Promise<TranslatorInstance | null>>();
const results = new Map<string, Promise<TranslationResult>>();

function getDetector(): Promise<Detector | null> {
  const a = apis();
  if (!a) return Promise.resolve(null);
  // Only use a model that is already on the device. Creating a "downloadable"
  // one needs a user gesture and fetches the model; we never trigger that here.
  detector ??= a.D.availability()
    .then((s) => (s === "available" ? a.D.create() : null))
    .catch(() => null);
  return detector;
}

function getTranslator(from: string, to: string): Promise<TranslatorInstance | null> {
  const a = apis();
  if (!a) return Promise.resolve(null);
  const key = `${from}>${to}`;
  let p = translators.get(key);
  if (!p) {
    p = a.T.availability({ sourceLanguage: from, targetLanguage: to })
      .then((s) => (s === "available" ? a.T.create({ sourceLanguage: from, targetLanguage: to }) : null))
      .catch(() => null);
    translators.set(key, p);
  }
  return p;
}

async function run(text: string, target: string): Promise<TranslationResult> {
  if (!apis()) return { kind: "unavailable" };
  const d = await getDetector();
  if (!d) return { kind: "unavailable" };
  const guesses = await d.detect(text).catch(() => []);
  const top = guesses[0];
  if (!top || top.detectedLanguage === "und" || top.confidence < MIN_CONFIDENCE) return { kind: "same" };
  const from = base(top.detectedLanguage);
  if (from === base(target)) return { kind: "same" };
  const tr = await getTranslator(from, base(target));
  if (!tr) return { kind: "unavailable" };
  const out = await tr.translate(text).catch(() => null);
  if (!out || out.trim() === text.trim()) return { kind: "same" };
  return { kind: "translated", text: out, from };
}

/**
 * Translate one decrypted, already-verified message into `target`.
 * Results are cached per message (seq) and language for the life of the tab.
 */
export function translateIncoming(cacheKey: string, text: string, target: string): Promise<TranslationResult> {
  const key = `${target}\u0000${cacheKey}\u0000${text}`;
  let p = results.get(key);
  if (!p) {
    p = text.trim().length < 2 ? Promise.resolve({ kind: "same" } as const) : run(text, target).catch(() => ({ kind: "unavailable" } as const));
    results.set(key, p);
  }
  return p;
}

/* ── "Translation unavailable" is said once per browser session, not per bubble ── */

const NOTE_KEY = "aperture.translate-note";
let noteShown = (() => {
  try { return sessionStorage.getItem(NOTE_KEY) === "1"; } catch { return false; }
})();
const listeners = new Set<() => void>();
let visible = false;

/** Called when a message could not be translated locally. Shows the note once per session. */
export function reportUnavailable() {
  if (noteShown) return;
  noteShown = true;
  visible = true;
  try { sessionStorage.setItem(NOTE_KEY, "1"); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
export function unavailableNoteVisible() {
  return visible;
}
export function dismissUnavailableNote() {
  visible = false;
  listeners.forEach((l) => l());
}
export function subscribeUnavailable(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
