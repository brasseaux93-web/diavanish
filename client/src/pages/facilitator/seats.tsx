import { useState } from "react";
import { Check, Copy, MoreHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { StatusDot } from "@/components/vault";
import { apiJson } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoomCrypto } from "@/lib/e2ee-client";
import { newInviteCode, inviteHash } from "@/lib/keyring";
import * as E from "@shared/e2ee";
import type { Invite, Seat } from "@shared/schema";
import type { Call } from "./types";

/* ── Invites ── */

export function InvitesPanel({ roomId, invites, requiresRoleProof }: { roomId: number; invites: Invite[]; requiresRoleProof: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const crypto = useRoomCrypto();
  const [fresh, setFresh] = useState<{ code: string; role: string | null } | null>(null);
  const [role, setRole] = useState("");
  const [copied, setCopied] = useState(false);
  const unused = invites.filter((i) => !i.usedAt && i.expiresAt > Date.now());
  const canSign = crypto.status === "ready" && !!crypto.attestPriv && !!crypto.roomCode;

  const issue = async () => {
    try {
      const boundRole = role.trim();
      if (requiresRoleProof && !boundRole) throw new Error(t("invite_role_required"));
      // The code is made here; the server only ever stores its hash.
      const code = newInviteCode();
      const hash = await inviteHash(code);
      let attestation: { sig: string; pub: string } | {} = {};
      if (boundRole) {
        if (!canSign) throw new Error(crypto.demo ? t("invite_role_needs_key_demo") : t("invite_role_needs_key"));
        const sig = await E.signAttestation(crypto.attestPriv!, E.attestationMessage(crypto.roomCode!, boundRole, hash));
        attestation = { sig, pub: crypto.attestPub! };
      }
      await apiJson("POST", `/api/facilitator/rooms/${roomId}/invites`, {
        inviteHash: hash, ...(boundRole ? { role: boundRole } : {}), ...attestation,
      });
      setFresh({ code, role: boundRole || null });
      setRole("");
      qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms", String(roomId)] });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("copy_failed"), variant: "destructive" });
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="invites-h">
      <div>
        <div className="flex items-baseline gap-2">
          <h2 id="invites-h" className="section-title">{t("invite")}</h2>
          <span className="text-xs text-muted-foreground" data-testid="text-invites-unused">{t("invites_unused", { n: unused.length })}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1 text-pretty">{t("invite_note")}</p>
      </div>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); issue(); }}>
        <Label htmlFor="invite-role">{t("invite_role")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} aria-describedby="invite-role-note"
            placeholder={t("invite_role_ph")} data-testid="input-invite-role" className="flex-1 min-w-[12rem]" />
          <Button type="submit" data-testid="button-new-invite">{t("new_invite")}</Button>
        </div>
        <p id="invite-role-note" className={`text-xs leading-relaxed text-pretty ${requiresRoleProof ? "text-[hsl(var(--warn))]" : "text-muted-foreground"}`}>
          {requiresRoleProof ? t("invite_role_note_required") : t("invite_role_note")}
        </p>
      </form>
      {fresh && (
        <div className="rounded-md bg-primary/10 px-3.5 py-3" role="status" data-testid="block-fresh-invite">
          <div className="flex items-center gap-3">
            <code className="mono-data text-foreground break-all flex-1 select-all" data-testid="text-invite-token">{fresh.code}</code>
            <Button type="button" size="sm" variant="ghost" onClick={copy} data-testid="button-copy-invite" className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              <span aria-live="polite">{copied ? t("copied") : t("copy")}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {fresh.role ? `${fresh.role} · ` : ""}{t("invite_shown_once")}
          </p>
        </div>
      )}
    </section>
  );
}


/* ── Seats: one list, actions at the end of each row ── */

export function SeatsTab({
  roomId, invites, seats, requiresRoleProof, call,
}: {
  roomId: number; invites: Invite[]; seats: Seat[]; requiresRoleProof: boolean; call: Call;
}) {
  const { t } = useI18n();
  const order = { waiting: 0, admitted: 1, left: 2, removed: 3, banned: 4 } as Record<string, number>;
  const sorted = seats.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const [ending, setEnding] = useState<{ seat: Seat; action: "remove" | "ban" } | null>(null);
  const nameOf = (s: Seat) => (s.useRealName && s.realName ? s.realName : s.pseudonym);
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-x-12 gap-y-10 items-start">
      <section className="min-w-0" aria-labelledby="seats-h">
        <h2 id="seats-h" className="section-title pb-2 flex items-baseline gap-2">
          {t("seats")}<span className="section-count">{seats.length}</span>
        </h2>
        {seats.length === 0 ? (
          <p className="text-sm text-muted-foreground border-t border-border pt-4">{t("no_items")}</p>
        ) : (
          <ul className="divide-line border-y border-border">
            {sorted.map((s) => (
              <li key={s.id} data-testid={`card-seat-${s.id}`} className="py-3 flex items-center gap-x-3">
                <StatusDot tone={s.status === "admitted" ? "ok" : s.status === "waiting" ? "warn" : "off"} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {nameOf(s)}
                    {s.realName && !s.useRealName && (
                      <span className="text-xs font-normal text-muted-foreground"> · {t("real_name")}: {s.realName}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    <span className={s.status === "waiting" ? "text-[hsl(var(--warn))]" : undefined}>{t(s.status)}</span>
                    {s.claimedRole && <><span aria-hidden> · </span>{s.claimedRole}</>}
                    {s.roleProofVerified ? (
                      <span className="text-primary"><span aria-hidden> · </span><Check className="inline h-3 w-3 -mt-0.5" aria-hidden /> {t("role_attested_by_you")}</span>
                    ) : null}
                  </p>
                </div>
                {s.status === "waiting" && (
                  <Button size="sm" data-testid={`button-admit-${s.id}`}
                    onClick={() => call(() => apiJson("POST", `/api/facilitator/seats/${s.id}/admit`))}>
                    {t("admit")}
                  </Button>
                )}
                {!["banned", "left", "removed"].includes(s.status) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-seat-menu-${s.id}`} aria-label={t("seat_actions", { name: nameOf(s) })}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="min-h-10" data-testid={`menu-remove-${s.id}`} onSelect={() => setEnding({ seat: s, action: "remove" })}>
                        {t("remove")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-10 text-destructive focus:text-destructive" data-testid={`menu-ban-${s.id}`} onSelect={() => setEnding({ seat: s, action: "ban" })}>
                        {t("ban")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <InvitesPanel roomId={roomId} invites={invites} requiresRoleProof={requiresRoleProof} />

      {/* Removing or banning ends a seat for good, so it asks first. */}
      <Dialog open={!!ending} onOpenChange={(v) => { if (!v) setEnding(null); }}>
        <DialogContent data-testid="dialog-seat-end">
          {ending && (
            <>
              <DialogHeader>
                <DialogTitle>{t(ending.action === "ban" ? "seat_ban_title" : "seat_remove_title", { name: nameOf(ending.seat) })}</DialogTitle>
                <DialogDescription>{t("seat_end_confirm")}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" data-testid="button-seat-end-cancel" onClick={() => setEnding(null)}>{t("cancel")}</Button>
                <Button variant="destructive" size="sm" data-testid="button-seat-end-confirm"
                  onClick={() => {
                    const { seat, action } = ending;
                    setEnding(null);
                    call(() => apiJson("POST", `/api/facilitator/seats/${seat.id}/${action}`));
                  }}>
                  {t(ending.action === "ban" ? "ban" : "remove")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
