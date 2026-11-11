/** Footer legal dialogs. Deep-linked via ?legal=<id> (hash router keeps search before #). */

export const LEGAL_IDS = ["privacy", "terms", "security", "accessibility", "opensource"] as const;
export type LegalId = (typeof LEGAL_IDS)[number];

export function isLegalId(value: string | null | undefined): value is LegalId {
  return !!value && (LEGAL_IDS as readonly string[]).includes(value);
}

/** Read ?legal= from the browser search string (works with wouter hash routing). */
export function legalFromSearch(search: string): LegalId | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(q).get("legal");
  return isLegalId(value) ? value : null;
}
