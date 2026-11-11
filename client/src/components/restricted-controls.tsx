/**
 * Phase 5 — Restricted controls boundary.
 *
 * Legal review, identity access, incident handling, and retention administration
 * are restricted to platform/organization administrators. They must never appear
 * in participant or standard facilitator navigation.
 *
 * Existing implementation: these functions live exclusively in the admin console
 * (`/admin/console`) behind session checks. This component documents the boundary
 * and can be used to render admin-only notices.
 */
import { Shield } from "lucide-react";

export function RestrictedNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-[var(--surface-sunk)] p-3 text-sm text-muted-foreground flex items-start gap-2" data-testid="restricted-notice">
      <Shield className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="font-medium text-foreground text-xs uppercase tracking-wide">Restricted</p>
        <p className="mt-1">{children ?? "This function is available only to authorized administrators."}</p>
      </div>
    </div>
  );
}

/**
 * Privacy invariants (unchanged by Phase 5):
 * - Chat is ephemeral and end-to-end encrypted in the browser; server sees only ciphertext in memory.
 * - No default transcript export.
 * - Hash-chained audit log contains process events only, not message content.
 * - Sealed ledgers outlive conversation retention under disclosed rules.
 * - Accepting wording is distinct from endorsing a recommendation.
 */
export const PRIVACY_INVARIANTS = {
  ephemeralChat: true,
  noDefaultTranscript: true,
  hashChainedAudit: true,
  acceptWordingDistinct: true,
} as const;
