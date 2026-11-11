/**
 * Accept wording vs endorsement distinction (Phase 3).
 * Accepting wording confirms the text accurately represents the discussion.
 * Supporting a recommendation is a separate decision.
 */
import { Check, AlertCircle } from "lucide-react";

export function AcceptWordingActions({
  onAcceptWording,
  onSuggestEdit,
  onRaiseConcern,
  accepted,
}: {
  onAcceptWording?: () => void;
  onSuggestEdit?: () => void;
  onRaiseConcern?: () => void;
  accepted?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="accept-wording-actions">
      <button
        type="button"
        onClick={onAcceptWording}
        disabled={accepted}
        className={`text-xs px-2 py-1 rounded border ${accepted ? "border-primary/40 text-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
      >
        {accepted ? <><Check className="inline h-3 w-3 mr-1" />Wording accepted</> : "Accept wording"}
      </button>
      <button type="button" onClick={onSuggestEdit} className="text-xs px-2 py-1 rounded border border-border hover:border-foreground/30">
        Suggest edit
      </button>
      <button type="button" onClick={onRaiseConcern} className="text-xs px-2 py-1 rounded border border-border hover:border-warn/50 text-muted-foreground">
        <AlertCircle className="inline h-3 w-3 mr-1" />Raise concern
      </button>
      <p className="text-[0.6875rem] text-muted-foreground w-full mt-1">
        Accepting wording means it accurately records the discussion. It does not mean you endorse the idea.
      </p>
    </div>
  );
}
