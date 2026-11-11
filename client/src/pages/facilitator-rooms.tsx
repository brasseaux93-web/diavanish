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
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl tracking-tight text-white">{t("my_rooms")}</h1>
            <p className="mt-1 text-sm text-zinc-400 font-mono">Ephemeral rooms · Outcome summaries only</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-room">{t("new_room")}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto bg-zinc-950 border-white/[0.08] p-6">
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">{t("new_room")}</DialogTitle>
                <DialogDescription className="text-zinc-400 text-sm">Configure room parameters and sealing rules.</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="r-title" className="text-xs uppercase tracking-wider text-zinc-400">Title</Label>
                  <Input id="r-title" data-testid="input-room-title" value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>

                <section className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400">{t("tier_title")}</h3>
                  <TierPicker value={tier} onChange={setTier} />
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400">{t("th_title")}</h3>
                  <ThresholdPicker value={threshold} onChange={setThreshold} />
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400">Anonymity</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(["anonymous", "open"] as const).map((m) => (
                      <button key={m} type="button"
                        onClick={() => setForm({ ...form, anonymityMode: m })}
                        className={`border px-3 py-2.5 text-left text-sm transition-colors ${
                          form.anonymityMode === m ? "border-white/30 bg-white/[0.04]" : "border-white/[0.08] hover:border-white/20"
                        }`}>
                        <span className="block font-medium">{m === "anonymous" ? "Anonymous" : "Open"}</span>
                        <span className="block mt-0.5 text-xs text-zinc-500">{m === "anonymous" ? "Pseudonyms only" : "Names visible"}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {sealedV2.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wider text-zinc-400">Continue series</Label>
                    <Select value={continueFrom} onValueChange={setContinueFrom}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fresh">Fresh room</SelectItem>
                        {sealedV2.map((r) => <SelectItem key={r.id} value={r.code}>{r.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <details className="border-t border-white/[0.08] pt-3">
                  <summary className="text-xs text-zinc-500 cursor-pointer">Additional options</summary>
                  <div className="space-y-3 pt-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="r-purpose" className="text-xs text-zinc-400">Purpose</Label>
                      <Input id="r-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-zinc-400">Duration (days)</Label>
                        <Input type="number" min={1} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-zinc-400">Session time</Label>
                        <Input type="datetime-local" value={form.sessionAt} onChange={(e) => setForm({ ...form, sessionAt: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">Require role proof</span>
                      <Switch checked={form.requiresRoleProof} onCheckedChange={(v) => setForm({ ...form, requiresRoleProof: v })} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">Chatham House</span>
                      <Switch checked={form.chathamHouse} onCheckedChange={(v) => setForm({ ...form, chathamHouse: v })} />
                    </div>
                  </div>
                </details>

                <Button className="w-full" onClick={create} disabled={creating || !form.title.trim()}>
                  {creating ? "Creating…" : t("create_room")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {rooms.isLoading ? (
          <p className="text-sm text-zinc-500 font-mono">Loading rooms…</p>
        ) : (rooms.data ?? []).length === 0 ? (
          <div className="bento-panel p-8 text-center">
            <p className="text-sm text-zinc-400">No rooms yet. Create one to begin.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {(rooms.data ?? []).map((r) => (
              <li key={r.id} className="py-3">
                <button
                  type="button"
                  onClick={() => navigate(`/facilitate/room/${r.id}`)}
                  className="group w-full flex items-center gap-4 text-left hover:bg-white/[0.02] px-1 -mx-1 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-white truncate">{r.title}</span>
                    <span className="block text-xs text-zinc-500 mt-0.5 font-mono">
                      {r.code} · {r.tier || "standard"} · {r.anonymityMode === "open" ? "open" : "anonymous"}
                    </span>
                  </span>
                  <span className="text-xs font-mono text-zinc-400 shrink-0">{r.status}</span>
                  <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-300" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-12 pt-8 border-t border-white/[0.06] max-w-md">
          <PasskeyManager />
        </div>
      </div>
    </Shell>
  );
}
