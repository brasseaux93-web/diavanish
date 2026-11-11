/**
 * Simplified room shell — less dense, more breathable.
 * Purpose at top, conversation center, collapsible ledger on the side.
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
    <div className="flex flex-col min-h-0 px-2 sm:px-4" data-testid="simple-room-shell">
      <header className="mb-6 pb-4 border-b border-border">
        <p className="text-lg sm:text-xl font-display font-medium text-ivory leading-snug text-pretty max-w-3xl">
          {purpose}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          {phase && <span>Phase: {phase}</span>}
          {identityMode && <span>Identity: {identityMode}</span>}
          {retentionNote && <span>{retentionNote}</span>}
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-8 lg:gap-10 min-h-0">
        <main className="min-w-0">{conversation}</main>

        <aside className="min-w-0">
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-3 hover:text-primary transition-colors"
            aria-expanded={ledgerOpen}
          >
            {ledgerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Ledger
          </button>
          {ledgerOpen && <div className="space-y-4">{ledger}</div>}
          {participants && (
            <div className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground">
              {participants}
            </div>
          )}
        </aside>
      </div>

      {facilitatorControls && (
        <footer className="mt-8 pt-4 border-t border-border flex flex-wrap items-center gap-3 text-sm">
          {facilitatorControls}
        </footer>
      )}
    </div>
  );
}
