import { ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { formatMinutes, turnMs } from "@shared/tiers";
import { useCountdown } from "@/components/vault";
import { apiJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRoomCrypto, useEncryptedChat, type CryptoState } from "@/lib/e2ee-client";
import { ChatShell } from "@/components/chat/chat-shell";
import type { Room, Seat } from "@shared/schema";
import type { Call, SeatName } from "./types";

/* ── The floor tab: chat in the middle, the controls beside it ── */

export function FloorTab({
  room, admitted, seatName, call, active,
}: {
  room: Room; admitted: Seat[]; seatName: SeatName; call: Call; active: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-6 lg:gap-8 items-start">
      <FacilitatorChat room={room} seatName={seatName} active={active} />
      <aside className="side-panel space-y-0 divide-line [&>section]:py-5 [&>section:first-child]:pt-0">
        <section>
          <p className="side-title">{t("floor_controls")}</p>
          <FloorPanel room={room} admitted={admitted} seatName={seatName} call={call} />
        </section>
        <section>
          <ProcessControls room={room} admitted={admitted} seatName={seatName} call={call} />
        </section>
      </aside>
    </div>
  );
}

/* ── Floor chat + caucus thread, through the shared chat shell ── */

function FacilitatorChat({ room, seatName, active }: { room: Room; seatName: SeatName; active: boolean }) {
  const { t } = useI18n();
  const [channel, setChannel] = useState<"floor" | "caucus">(room.caucusSeatId ? "caucus" : "floor");
  // Follow the room: opening a caucus switches to it, closing one returns to the floor.
  useEffect(() => { setChannel(room.caucusSeatId ? "caucus" : "floor"); }, [room.caucusSeatId]);
  const caucusId = room.caucusSeatId;
  const hintId = useId();
  const switcher = (
    <div className="segmented segmented-box" role="group" aria-label={t("chat")}>
      <button type="button" aria-pressed={channel === "floor"} onClick={() => setChannel("floor")} data-testid="button-channel-floor">
        {t("chat_floor")}
      </button>
      {/* Unavailable until a caucus is open, but still legible (muted text at 4.5:1), with the reason on hover and for AT. */}
      <button type="button" aria-pressed={channel === "caucus"} aria-disabled={!caucusId || undefined}
        title={caucusId ? undefined : t("caucus_closed_hint")} aria-describedby={caucusId ? undefined : hintId}
        className="aria-disabled:cursor-not-allowed aria-disabled:hover:!text-muted-foreground"
        onClick={() => { if (caucusId) setChannel("caucus"); }} data-testid="button-channel-caucus">
        {caucusId ? t("chat_with", { name: seatName(caucusId) }) : t("chat_caucus")}
      </button>
      {!caucusId && <span id={hintId} className="sr-only">{t("caucus_closed_hint")}</span>}
    </div>
  );
  return channel === "caucus" && caucusId
    ? <ChannelChat key={`c${caucusId}`} roomId={room.id} caucusSeatId={caucusId} seatLabel={seatName(caucusId)} switcher={switcher} active={active} caucusOpen />
    : <ChannelChat key="floor" roomId={room.id} caucusSeatId={null} seatLabel="" switcher={switcher} active={active} caucusOpen={!!caucusId} />;
}

function ChannelChat({ roomId, caucusSeatId, seatLabel, switcher, active, caucusOpen }: {
  roomId: number; caucusSeatId: number | null; seatLabel: string; switcher: ReactNode; active: boolean; caucusOpen: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const crypto = useRoomCrypto();
  const caucus = caucusSeatId !== null;
  const channel = caucus ? `caucus:${caucusSeatId}` : "floor";
  const keyed: CryptoState = useMemo(() => caucus ? {
    ...crypto,
    // The caucus key for this seat lives in the facilitator's keyring.
    keyForEpoch: (epoch: number, ch: string) => crypto.keyForEpoch(epoch, ch) ?? (epoch === crypto.epoch ? crypto.caucusFor(caucusSeatId!) : null),
  } : crypto, [crypto, caucus, caucusSeatId]);
  const { lines, send } = useEncryptedChat({
    crypto: keyed, channel,
    getUrl: caucus ? `/api/facilitator/rooms/${roomId}/chat?channel=caucus` : `/api/facilitator/rooms/${roomId}/chat`,
    postUrl: `/api/facilitator/rooms/${roomId}/chat`,
    label: t("role_facilitator"), facilitatorName: t("role_facilitator"),
    extraBody: caucus ? { caucus: true } : undefined,
  });
  const ready = crypto.status === "ready";
  const label = caucus ? `${t("caucus_thread")} · ${seatLabel}` : t("chat");
  return (
    <ChatShell
      fill={active}
      // On a phone the Floor/Caucus switch only appears while a caucus is open.
      compactHeadOnMobile={!caucusOpen}
      lines={lines}
      title={t("chat")}
      headerExtra={switcher}
      banner={caucus && !crypto.demo ? (
        <p className="text-sm text-[hsl(var(--seal))] px-5 py-2.5 border-b border-border bg-[hsl(var(--seal)/0.06)]">{t("caucus_thread_note")}</p>
      ) : !ready ? (
        <p className="text-sm text-muted-foreground px-5 py-2.5 border-b border-border" role="status">{t("e2ee_preparing")}</p>
      ) : null}
      onSend={async (text) => {
        try { await send(text); } catch (e: any) { toast({ title: e.message, variant: "destructive" }); throw e; }
      }}
      canSend={ready}
      lockedReason={!ready ? t("e2ee_preparing") : null}
      placeholder={caucus ? t("chat_placeholder_to", { name: seatLabel }) : t("chat_placeholder")}
      emptyBody={crypto.demo ? t("chat_note_demo") : caucus ? "" : t("chat_note")}
      logLabel={label}
      facilitatorName={t("role_facilitator")}
      logTestId={caucus ? "card-caucus-thread" : "card-fac-chat"}
      inputTestId={caucus ? "input-caucus-chat" : "input-fac-chat"}
      sendTestId={caucus ? "button-caucus-send" : "button-fac-send"}
    />
  );
}

/* ── Turn timer, speaker and turn controls ── */

export function FloorPanel({
  room, admitted, seatName, call,
}: {
  room: Room;
  admitted: Seat[];
  seatName: SeatName;
  call: Call;
}) {
  const { t } = useI18n();
  const [speaker, setSpeaker] = useState<string>("");
  const running = room.floorState === "running";
  const countdown = useCountdown(room.floorEndsAt, running);

  const speakerSeat = admitted.find((s) => s.id === room.floorSeatId);
  const progress = useMemo(() => {
    if (!running || !room.floorEndsAt) return 0;
    const total = turnMs(room);
    return Math.min(1, Math.max(0, 1 - (room.floorEndsAt - Date.now()) / total));
  }, [running, room.floorEndsAt, room.turnMinutes, room.turnSeconds, countdown.display]);
  const floor = (action: string, extra: Record<string, unknown> = {}) =>
    call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/floor`, { action, ...extra }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
            <circle
              cx="50" cy="50" r="44" fill="none"
              stroke={running ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${progress * 276.5} 276.5`}
              style={{ transition: "stroke-dasharray 500ms linear" }}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center mono-data text-sm tabular-nums" data-testid="text-timer">{countdown.display}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium" role="status" aria-live="polite">
            {running && speakerSeat ? `${seatName(speakerSeat.id)} ${t("floor_running")}` : room.floorState === "paused" ? t("floor_paused") : t("floor_idle")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("turn")} {room.turnNumber} · {formatMinutes(turnMs(room) / 1000)}</p>
        </div>
      </div>

      {room.floorState === "idle" && <div>
        <p className="text-xs text-muted-foreground mb-2">{t("pick_speaker")}</p>
        <div className="flex flex-wrap gap-1.5">
          {admitted.map((s) => (
            <button key={s.id} type="button" aria-pressed={String(s.id) === speaker}
              onClick={() => setSpeaker(String(s.id))}
              className={`touch-target h-8 px-3 rounded-md border text-[0.8125rem] transition-colors ${
                String(s.id) === speaker ? "border-primary bg-primary/10 text-foreground" : "[border-color:var(--line-strong)] text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}>
              {seatName(s.id)}
            </button>
          ))}
        </div>
      </div>}

      {/* Only the controls that apply now: start when idle; pause or resume, extend and end during a turn. */}
      {room.floorState === "idle" ? (
        <Button data-testid="button-start-turn" className="w-full" disabled={!speaker}
          onClick={() => floor("start", { seatId: Number(speaker) })}>
          {t("start_turn")}
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {room.floorState === "running"
            ? <Button size="sm" variant="secondary" data-testid="button-pause-turn" onClick={() => floor("pause")}>{t("pause")}</Button>
            : <Button size="sm" variant="secondary" data-testid="button-resume-turn" onClick={() => floor("resume")}>{t("resume")}</Button>}
          {room.tier !== "plenary" && <Button size="sm" variant="secondary" data-testid="button-extend-turn" onClick={() => floor("extend", { minutes: 2 })}>{t("extend_turn")}</Button>}
          <Button size="sm" variant="destructive" data-testid="button-end-turn" onClick={() => floor("end")}>{t("end_turn")}</Button>
        </div>
      )}
      {/* The lock note only while a seat actually holds the floor. */}
      {running && speakerSeat && <p className="text-xs text-muted-foreground" data-testid="text-floor-lock">{t("floor_lock_note", { name: seatName(speakerSeat.id) })}</p>}
    </div>
  );
}

/* ── Process controls: stages, input lock, caucus ── */

export function ProcessControls({
  room, admitted, seatName, call,
}: {
  room: Room;
  admitted: Seat[];
  seatName: SeatName;
  call: Call;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState(room.stage);
  const [minutes, setMinutes] = useState("");
  const [caucusWith, setCaucusWith] = useState("");
  const stageCountdown = useCountdown(room.stageEndsAt, !!room.stageEndsAt && room.stageEndsAt > Date.now());

  useEffect(() => { setStage(room.stage); }, [room.stage]);

  return (
    <div className="space-y-5" data-testid="card-process">
      <p className="side-title !mb-0">{t("input_controls")}</p>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs">{t("stage")}</Label>
          {room.stageEndsAt && room.stageEndsAt > Date.now() && (
            <span className="mono-data text-xs text-muted-foreground tabular-nums" data-testid="text-stage-timer">{stageCountdown.display}</span>
          )}
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger aria-label={t("stage")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["opening", "joint", "caucus", "drafting", "closing"] as const).map((s) => (
              <SelectItem key={s} value={s}>{t(`stage_${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Input type="number" min={1} max={240} value={minutes} aria-label={t("stage_minutes")} className="w-24"
            onChange={(e) => setMinutes(e.target.value)} placeholder={t("mins")} />
          <Button size="sm" variant="secondary" className="flex-1 min-h-10" data-testid="button-set-stage"
            onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/stage`, {
              stage, minutes: Number(minutes) || 0,
            }))}>
            {t("set_stage")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("caucus_open")}</Label>
        {room.caucusSeatId ? (
          <div className="flex items-center gap-2">
            <span className="chip chip-seal min-w-0 truncate">{seatName(room.caucusSeatId)}</span>
            <Button size="sm" variant="secondary" className="ms-auto" data-testid="button-caucus-close"
              onClick={() => { setCaucusWith(""); call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/caucus`, { seatId: null })); }}>
              {t("caucus_close")}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Select value={caucusWith} onValueChange={setCaucusWith} disabled={admitted.length === 0}>
                <SelectTrigger aria-label={t("caucus_open")}><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {admitted.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{seatName(s.id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="secondary" className="min-h-10" data-testid="button-caucus-open" disabled={!caucusWith || admitted.length === 0}
                onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/caucus`, {
                  seatId: Number(caucusWith),
                }))}>
                {t("caucus")}
              </Button>
            </div>
            {admitted.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("caucus_no_seats")}</p>
            )}
          </div>
        )}
      </div>

      <Button size="sm" variant={room.inputLocked ? "default" : "secondary"} className="w-full"
        data-testid="button-input-lock"
        onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${room.id}/lock`, {
          locked: !room.inputLocked,
        }))}>
        {room.inputLocked ? t("input_unlock") : t("input_lock")}
      </Button>
    </div>
  );
}
