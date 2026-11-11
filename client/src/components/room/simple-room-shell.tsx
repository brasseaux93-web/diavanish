/**
 * Simplified room shell (Phase 2 start).
 * Purpose at top, conversation center, collapsible ledger on the side.
 * Facilitator controls stay quiet. State indicators are persistent but restrained.
 * Intended for incremental adoption; does not replace existing tabbed rooms yet.
 */
import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function SimpleRoomShell({
  purpose,
  phase,
  identityMode,
  retentionNote,
  conversation,
  ledger,
  participants,
  facilitatorControls,
}: {
  purpose: ReactNode;
  phase?: string;
  identityMode?: string;
  retentionNote?: string;
  conversation: ReactNode;
  ledger: ReactNode;
  participants?: ReactNode;
  facilitatorControls?: ReactNode;
}) {
  const [ledgerOpen, setLedgerOpen] = useState(true);

  return (
    <div className="flex flex-col min-h-0" data-testid="simple-room-shell">
      {/* Purpose + quiet state */}
      <header className="mb-4 pb-3 border-b border-border">
        <p className="text-base sm:text-lg font-display font-medium text-ivory leading-snug text-pretty">
          {purpose}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {phase && <span>Phase: {phase}</span>}
          {identityMode && <span>Identity: {identityMode}</span>}
          {retentionNote && <span>{retentionNote}</span>}
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] gap-6 lg:gap-8 min-h-0">
        {/* Conversation */}
        <main className="min-w-0">{conversation}</main>

        {/* Collapsible ledger */}
        <aside className="min-w-0">
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2 hover:text-primary transition-colors"
            aria-expanded={ledgerOpen}
          >
            {ledgerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Ledger
          </button>
          {ledgerOpen && <div className="space-y-3">{ledger}</div>}
          {participants && (
            <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
              {participants}
            </div>
          )}
        </aside>
      </div>

      {/* Quiet facilitator controls */}
      {facilitatorControls && (
        <footer className="mt-6 pt-3 border-t border-border flex flex-wrap items-center gap-2 text-sm">
          {facilitatorControls}
        </footer>
      )}
    </div>
  );
}
