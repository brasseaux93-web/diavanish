/** Soft-mode hints that must never ship to a hardened production host. */
import { demoEnabled } from "./demo-mode";

export const BOOTSTRAP_ADMIN_EMAIL = "admin@diavanish.org";

/**
 * True only when a known local bootstrap address may be shown or pre-filled.
 * Production with demos off returns false. APERTURE_DEV_CODES cannot be on in
 * production (see production-guard.ts), but is listed for clarity.
 */
export function bootstrapAdminHintAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.APERTURE_DEV_CODES === "1") return true;
  if (demoEnabled()) return true;
  return false;
}

/** The bootstrap email, or null when the client must show an empty field. */
export function bootstrapAdminEmail(): string | null {
  return bootstrapAdminHintAllowed() ? BOOTSTRAP_ADMIN_EMAIL : null;
}
