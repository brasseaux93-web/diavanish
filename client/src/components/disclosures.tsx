/**
 * Pre-entry disclosures (Phase 4).
 * Shown before a participant joins so they understand identity visibility,
 * retention, and whether AI is involved.
 */
export function PreEntryDisclosures({
  anonymityMode,
  retentionDays,
  aiEnabled,
}: {
  anonymityMode: "anonymous" | "open" | string;
  retentionDays?: number;
  aiEnabled?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-[var(--surface-sunk)] p-4 space-y-2 text-sm" data-testid="pre-entry-disclosures">
      <p className="font-medium text-foreground">Before you enter</p>
      <ul className="space-y-1 text-muted-foreground text-pretty">
        <li>
          <span className="text-foreground/80">Identity:</span>{" "}
          {anonymityMode === "anonymous"
            ? "You will appear under a stable alias. Your verified identity is not shown to other participants."
            : "Your name or chosen display name will be visible to others in the room."}
        </li>
        <li>
          <span className="text-foreground/80">Conversation:</span> Messages expire under the room’s disclosed policy
          {retentionDays ? ` (approximately ${retentionDays} days)` : ""}. They are not kept as a permanent transcript.
        </li>
        <li>
          <span className="text-foreground/80">Ledger:</span> Only points that participants accept as accurate wording carry forward.
        </li>
        <li>
          <span className="text-foreground/80">AI:</span>{" "}
          {aiEnabled
            ? "An AI assistant may suggest ledger wording. It cannot approve or declare agreement."
            : "No AI processes your contributions in this room."}
        </li>
      </ul>
      <p className="text-xs text-muted-foreground pt-1">
        Screenshots and external recording cannot be prevented. The product does not claim absolute anonymity or deletion.
      </p>
    </div>
  );
}
