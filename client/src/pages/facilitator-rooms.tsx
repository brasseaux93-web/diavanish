import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Shell, PageHead } from "@/components/vault";
import { apiJson, getSessionToken, apiUrl } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Room } from "@shared/schema";
import { ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TierPicker, ThresholdPicker, type TierValue } from "@/components/room/tier-picker";
import { PasskeyManager } from "@/components/passkey-manager";
import { TIER_SPECS, DEFAULT_TIER, type Threshold } from "@shared/tiers";

export default function FacilitatorRooms() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const session = useQuery<{ role?: string } | null>({ queryKey: ["/api/auth/session"] });
  const rooms = useQuery<Room[]>({ queryKey: ["/api/facilitator/rooms"], refetchInterval: 5000 });

  useEffect(() => {
    // Signed out, or signed in as another role (an admin or participant
    // wandering here would otherwise see a misleading empty room list).
    if (session.data === null || (session.data && session.data.role !== "facilitator")) {
      navigate("/facilitate");
    }
  }, [session.data]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", purpose: "",
    anonymityMode: "anonymous" as "anonymous" | "open",
    durationDays: 1,
    requiresRoleProof: false,
    chathamHouse: true,
    nextStepReview: false,
    seriesKey: "",
    sessionAt: "",
  });
  const [tier, setTier] = useState<TierValue>({
    tier: DEFAULT_TIER, seatCap: TIER_SPECS[DEFAULT_TIER].seats.default, turnSeconds: TIER_SPECS[DEFAULT_TIER].turn.default,
  });
  const [threshold, setThreshold] = useState<Threshold>("consensus");
  const [continueFrom, setContinueFrom] = useState<string>("fresh");
  const [creating, setCreating] = useState(false);
  const sealedV2 = (rooms.data ?? []).filter((r) => r.status === "sealed" && r.ledgerVersion === 2);

  const create = async () => {
    if (creating || !form.title.trim()) return;
    setCreating(true);
    try {
      const room = await apiJson<Room>("POST", "/api/facilitator/rooms", {
        ...form, ...tier, sealThreshold: threshold,
        continueFrom: continueFrom === "fresh" ? undefined : continueFrom,
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms"] });
      navigate(`/facilitate/room/${room.id}`);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Shell sessionRole="facilitator" title={t("my_rooms")}>
      <PageHead title={t("my_rooms")} action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-room">{t("new_room")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto p-5 sm:p-7">
            <DialogHeader>
              <DialogTitle className="font-display">{t("new_room")}</DialogTitle>
              <DialogDescription className="sr-only">{t("tier_title")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-6 min-w-0">
              <div className="space-y-2">
                <Label htmlFor="r-title">{t("room_title")}</Label>
                <Input id="r-title" data-testid="input-room-title" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>

              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("tier_title")}</h3>
                <TierPicker value={tier} onChange={setTier} />
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("th_title")}</h3>
                <ThresholdPicker value={threshold} onChange={setThreshold} />
              </section>

              {/* The identity decision */}
              <section className="space-y-3">
                <h3 className="text-sm font-medium">{t("anonymity_heading")}</h3>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("anonymity_heading")}>
                  {(["anonymous", "open"] as const).map((m) => (
                    <button key={m} type="button" role="radio" data-testid={m === "anonymous" ? "button-anon-mode" : "button-open-mode"}
                      aria-checked={form.anonymityMode === m}
                      onClick={() => setForm({ ...form, anonymityMode: m })}
                      className={`rounded-md border px-3.5 py-3 text-start transition-colors ${
                        form.anonymityMode === m ? "border-[hsl(var(--foreground)/0.32)] bg-[var(--slate-control)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"
                      }`}>
                      <span className="block text-sm font-medium">{m === "anonymous" ? t("anonymity_anon") : t("anonymity_open")}</span>
                      <span className="block mt-1 text-xs text-muted-foreground text-pretty">{m === "anonymous" ? t("anonymity_anon_note") : t("anonymity_open_note")}</span>
                    </button>
                  ))}
                </div>
              </section>

              {sealedV2.length > 0 && (
                <section className="space-y-2">
                  <Label>{t("series_continue")}</Label>
                  <Select value={continueFrom} onValueChange={setContinueFrom}>
                    <SelectTrigger data-testid="select-continue-from" aria-label={t("series_continue")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fresh">{t("series_fresh")}</SelectItem>
                      {sealedV2.map((r) => <SelectItem key={r.id} value={r.code}>{r.title} · {r.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {continueFrom !== "fresh" && <p className="text-xs text-muted-foreground text-pretty">{t("series_note")}</p>}
                </section>
              )}

              <details className="disclose">
                <summary className="text-sm text-muted-foreground hover:text-foreground min-h-9">
                  <ChevronRight className="chev h-3.5 w-3.5" aria-hidden />{t("nr_more")}
                </summary>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="r-purpose">{t("purpose")}</Label>
                    <Input id="r-purpose" value={form.purpose}
                      onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="r-days">{t("duration_days")}</Label>
                      <Input id="r-days" type="number" min={1} value={form.durationDays}
                        onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="r-session">{t("session_time")}</Label>
                      <Input id="r-session" type="datetime-local" value={form.sessionAt}
                        onChange={(e) => setForm({ ...form, sessionAt: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="r-series">{t("series_key")}</Label>
                    <Input id="r-series" value={form.seriesKey}
                      onChange={(e) => setForm({ ...form, seriesKey: e.target.value })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="r-proof">{t("require_role_proof")}</Label>
                    <Switch id="r-proof" checked={form.requiresRoleProof}
                      onCheckedChange={(v) => setForm({ ...form, requiresRoleProof: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="r-chatham">{t("chatham")}</Label>
                    <Switch id="r-chatham" checked={form.chathamHouse}
                      onCheckedChange={(v) => setForm({ ...form, chathamHouse: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="r-review">{t("next_step_review")}</Label>
                    <Switch id="r-review" checked={form.nextStepReview}
                      onCheckedChange={(v) => setForm({ ...form, nextStepReview: v })} />
                  </div>
                </div>
              </details>

              <Button data-testid="button-create-room" className="w-full" onClick={create} disabled={creating || !form.title.trim()}>
                {t("create_room")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      } />

      {rooms.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>
      ) : (rooms.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground border-t border-border pt-5" data-testid="text-no-rooms">{t("rooms_empty")}</p>
      ) : (
        <ul className="divide-line border-y border-border" data-testid="list-rooms">
          {(rooms.data ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid={`card-room-${r.code}`}
                onClick={() => navigate(`/facilitate/room/${r.id}`)}
                className="group w-[calc(100%+1rem)] flex items-center gap-4 py-3.5 text-start rounded-md -mx-2 px-2 hover:bg-foreground/[0.03] transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="user-text block font-medium truncate">{r.title}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    <span className="mono-data">{r.code}</span>
                    {r.tier ? ` · ${t(`tier_${r.tier}`)}` : ""} · {r.anonymityMode === "open" ? t("anonymity_open") : t("anonymity_anon")}
                    {r.sessionAt ? ` · ${t("scheduled_for")} ${new Date(r.sessionAt).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                  </span>
                </span>
                <span className={`chip shrink-0 ${r.status === "live" ? "chip-live" : r.status === "sealed" ? "chip-seal" : ""}`}>{t(r.status)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground rtl:rotate-180" aria-hidden />
              </button>
              {r.sessionAt && r.status !== "sealed" && (
                <button type="button" className="link-quiet text-xs -mt-1.5 mb-3 block" data-testid={`button-ics-${r.code}`}
                  onClick={async () => {
                    const res = await fetch(apiUrl(`/api/facilitator/rooms/${r.id}/calendar.ics`), {
                      headers: { "x-diavanish-session": getSessionToken() ?? "", "x-aperture-session": getSessionToken() ?? "" },
                    });
                    if (!res.ok) { toast({ title: t("error_generic"), variant: "destructive" }); return; }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `diavanish-${r.code}.ics`; a.click();
                    URL.revokeObjectURL(url);
                  }}>
                  {t("add_to_calendar")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-14 pt-8 border-t border-border max-w-xl">
        <PasskeyManager />
      </div>
    </Shell>
  );
}
