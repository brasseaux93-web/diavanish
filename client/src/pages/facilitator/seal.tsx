import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiJson, getSessionToken, apiUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Room } from "@shared/schema";
import type { Call } from "./types";
import { useToast } from "@/hooks/use-toast";

export type Colleague = { id: number; name: string };

/* ── Seal ── */

export function SealPanel({
  room, call, colleagues, navigate,
}: {
  room: Room;
  call: Call;
  colleagues: Colleague[];
  navigate: (to: string) => void;
}) {
  const { t, lang } = useI18n();
  const [handoffTo, setHandoffTo] = useState<string>("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const { toast } = useToast();

  const exportLedger = async () => {
    try {
      const res = await fetch(apiUrl(`/api/facilitator/rooms/${room.id}/export`), {
        headers: { "x-aperture-session": getSessionToken() ?? "" },
      });
      if (!res.ok) throw new Error(t("error_generic"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `diavanish-ledger-${room.code}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    }
  };
  const others = colleagues.filter((f) => f.id !== room.facilitatorId);

  return (
    <div className="max-w-2xl">
      <section className="space-y-4" aria-labelledby="seal-h">
        <div>
          <h2 id="seal-h" className="section-title">{room.status === "sealed" ? t("seal_sealed_title") : t("seal_title")}</h2>
          {room.status !== "sealed" && <p className="text-sm text-muted-foreground text-pretty mt-1 max-w-[65ch]">{t("seal_note")}</p>}
        </div>

        {room.status === "draft" && (
          <p className="text-sm text-muted-foreground text-pretty">{t("seal_needs_live")}</p>
        )}

        {room.status === "live" && (
          <Dialog open={closeOpen} onOpenChange={(v) => { if (!closing) setCloseOpen(v); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-close-room">{t("close_room")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("close_room")}</DialogTitle>
                <DialogDescription>{t("close_room_confirm")}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 justify-end">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" disabled={closing} data-testid="button-close-room-cancel">{t("cancel")}</Button>
                </DialogClose>
                <Button data-testid="button-close-room-confirm" size="sm" disabled={closing} onClick={async () => {
                  setClosing(true);
                  try {
                    await call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/close`));
                    setCloseOpen(false);
                  } finally {
                    setClosing(false);
                  }
                }}>
                  {closing ? t("loading") : t("close_room")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {room.status === "closed" && (
          <Button data-testid="button-seal" className="seal-brass"
            onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/seal`))}>
            {t("seal_ledger")}
          </Button>
        )}
        {room.status === "sealed" && (
          <div className="seal-mark space-y-3" data-testid="card-sealed">
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("sealed_at")}</dt>
                <dd className="text-sm mt-0.5">{new Date(room.sealedAt ?? 0).toLocaleString(lang)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fingerprint")}</dt>
                <dd className="mono-data text-xs text-[hsl(var(--seal))] break-all mt-0.5 select-all" data-testid="text-fingerprint">{room.fingerprint}</dd>
              </div>
            </dl>
            {room.chainHead ? (
              <details className="disclose border-y border-border" data-testid="card-destruction-cert">
                <summary className="py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="chev h-3.5 w-3.5 shrink-0" aria-hidden />{t("destruction_cert")}
                </summary>
                <dl className="pb-4 space-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("destruction_cert")}</dt>
                    <dd className="mono-data text-xs text-foreground/80 break-all mt-0.5 select-all">{room.destructionCert}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("chain_head")}</dt>
                    <dd className="mono-data text-xs text-foreground/80 break-all mt-0.5 select-all">{room.chainHead}</dd>
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">{t("destruction_cert_note")}</p>
                </dl>
              </details>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {room.status === "sealed" && room.ledgerVersion === 2 && (
            <>
              <Button variant="secondary" size="sm" data-testid="button-seal-brief"
                onClick={() => window.open(apiUrl(`/api/public/ledger/${room.code}/brief.html?lang=${lang}`), "_blank")}>
                {t("brief_open")}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button variant="secondary" size="sm" data-testid="button-seal-brief-pdf"
                onClick={() => window.open(apiUrl(`/api/public/ledger/${room.code}/brief.html?lang=${lang}#print`), "_blank")}>
                {t("brief_pdf")}
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" data-testid="button-export-ledger" onClick={exportLedger}>{t("export_ledger")}</Button>
          <Button variant="ghost" size="sm" data-testid="button-open-verify" onClick={() => {
            window.open(`${location.origin}${location.pathname}#/verify${room.status === "sealed" ? `/${room.code}` : ""}`, "_blank");
          }}>
            {t("verify_title")}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </section>

      {/* Rare and consequential: handing the room to a colleague, or erasing it. */}
      <section className="mt-10 border-t border-border divide-line" aria-label={t("seal_more")}>
        <div className="py-5 space-y-2">
          <h2 className="section-title">{t("handoff")}</h2>
          <div className="flex flex-wrap gap-2">
            <Select value={handoffTo} onValueChange={setHandoffTo} disabled={others.length === 0}>
              <SelectTrigger className="flex-1 min-w-[12rem] max-w-xs" aria-label={t("handoff_to")}><SelectValue placeholder={t("handoff_to")} /></SelectTrigger>
              <SelectContent>
                {others.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" className="min-h-10" disabled={!handoffTo} data-testid="button-handoff"
              onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/handoff`, {
                facilitatorId: Number(handoffTo),
              }))}>
              {t("handoff")}
            </Button>
          </div>
          {others.length === 0 && <p className="text-xs text-muted-foreground">{t("handoff_none")}</p>}
        </div>

        <div className="py-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 max-w-[48ch]">
            <h2 className="section-title">{t("wipe_room")}</h2>
            <p className="text-sm text-muted-foreground text-pretty mt-1">{t("wipe_confirm")}</p>
          </div>
          <Dialog open={wipeOpen} onOpenChange={(v) => { if (!wiping) setWipeOpen(v); }}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="button-wipe-room">{t("wipe_room")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("wipe_room")}</DialogTitle>
                <DialogDescription>{t("wipe_confirm")}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 justify-end">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" disabled={wiping} data-testid="button-wipe-cancel">{t("cancel")}</Button>
                </DialogClose>
                <Button variant="destructive" size="sm" disabled={wiping} data-testid="button-wipe-confirm" onClick={async () => {
                  setWiping(true);
                  try {
                    await apiJson("POST", `/api/facilitator/rooms/${room.id}/wipe`);
                    setWipeOpen(false);
                    navigate("/facilitate/rooms");
                  } catch (e: any) {
                    toast({ title: e.message || t("error_generic"), variant: "destructive" });
                  } finally {
                    setWiping(false);
                  }
                }}>
                  {wiping ? t("loading") : t("wipe_room")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </section>
    </div>
  );
}
