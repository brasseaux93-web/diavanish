import { ReactNode, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Check, ChevronRight, Copy, X } from "lucide-react";
import { Shell, StatusDot, CalmTime, BreathingIris } from "@/components/vault";
import { ChatShell } from "@/components/chat/chat-shell";
import { RoomHeader, ConnectionNotice } from "@/components/room/room-chrome";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiJson, setSessionToken, getSessionToken, getRecoveryKey, apiUrl, isRefusal, type ApiError } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BentoCard } from "@/components/BentoCard";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNarrow } from "@/hooks/use-narrow";
import {
  CryptoContext, useRoomCrypto, useSeatCrypto, useEncryptedChat, useAttestations, type Attestation, type AttestResult,
} from "@/lib/e2ee-client";
import { Input } from "@/components/ui/input";
import { RECORD_KINDS, fingerprintFor, type LedgerDocV2, type Support } from "@shared/ledger";
import { turnMs } from "@shared/tiers";
import { RecordBody, SupportLine, SealedRecord, RoomRuleChips, kindLabel } from "@/components/ledger/record";

const isRecord = (k: string) => (RECORD_KINDS as readonly string[]).includes(k);
const STAGES = ["opening", "joint", "caucus", "drafting", "closing"] as const;

type Proposal = {
  id: number; kind: string; agendaItemId: number | null; version: number; carriedFrom: string | null;
  text: string; payload: Record<string, any> | null;
  my: { support: "full" | "reservations" | "objection" | null; reason: string | null; rewording: boolean } | null;
  responded: number; required: number;
};

type PSummary = {
  id: number; version: number; agreements: string; openIssues: string; nextSteps: string;
  disagreements: string; deadlines: string; locked: number; createdAt: number;
  myConfirmation: { confirmed: boolean; note: string | null } | null;
};

type PRoom = {
  room: {
    id: number; code: string; title: string; status: string;
    anonymityMode: string; turnMinutes: number; turnSeconds: number | null;
    tier: string | null; seatCap: number | null; sealThreshold: string; continuesFrom: string | null;
    floorState: string; floorSeatId: number | null; floorEndsAt: number | null;
    turnNumber: number; chathamHouse: boolean; requiresRoleProof: boolean;
    nextStepReview: boolean; fingerprint: string | null; sealedAt: number | null;
    destructionCert: string | null; chainHead: string | null;
    stage: string; stageEndsAt: number | null; inputLocked: boolean;
    caucusSeatId: number | null; sessionAt: string | null;
  };
  seat: {
    id: number; pseudonym: string; realName: string | null; useRealName: boolean;
    status: string; claimedRole: string; roleProofVerified: boolean;
  };
  agenda: { id: number; position: number; title: string; status: string }[];
  entries: {
    id: number; kind: string; status: string; visibility: string; text: string;
    mine: boolean; createdAt: number; released: number; agendaItemId: number | null;
    payload: Record<string, any> | null; support: Support | null;
  }[];
  proposals: Proposal[];
  ledgerVersion: number | null;
  seats: { id: number; label: string; claimedRole: string; status: string; roleProofVerified: boolean; attestation: Attestation }[];
  followups: { id: number; type: string; text: string; ownerLabel: string; dueDate: string | null; status: string }[];
  reviewQueue: { entryId: number; confirmed: boolean }[];
  summary: PSummary | null;
};

/** Export and erasure: reachable from the room, and after a seat has been ended. */
function DataRights() {
  const { t } = useI18n();
  const { toast } = useToast();
  return (
    <>
      <button type="button" className="side-action" data-testid="button-export-data" onClick={async () => {
        try {
          const res = await fetch(apiUrl("/api/participant/export"), {
            headers: { "x-diavanish-session": getSessionToken() ?? "", "x-aperture-session": getSessionToken() ?? "" },
          });
          if (!res.ok) throw new Error(t("error_generic"));
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "diavanish-my-data.json"; a.click();
          URL.revokeObjectURL(url);
        } catch (e: any) {
          toast({ title: e.message || t("error_generic"), variant: "destructive" });
        }
      }}>{t("export_my_data")}</button>
      <button type="button" className="side-action" data-testid="button-erasure" onClick={async () => {
        try {
          await apiJson("POST", "/api/participant/erasure-request");
          toast({ title: t("erasure_sent") });
        } catch (e: any) {
          toast({ title: e.message || t("error_generic"), variant: "destructive" });
        }
      }}>{t("request_erasure")}</button>
      <p className="text-xs text-muted-foreground leading-relaxed text-pretty px-0.5">{t("erasure_note")}</p>
    </>
  );
}

export default function ParticipantRoom() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [view, setView] = useState<string | null>(null);
  const narrow = useNarrow();

  const data = useQuery<PRoom>({
    queryKey: ["/api/participant/room"],
    // An ended seat stays ended: stop asking.
    refetchInterval: (q) => ((q.state.error as ApiError | null)?.code === "seat_ended" ? false : 2000),
  });
  // Why the room stopped answering. A seat that was ended is told so, and can
  // still reach its data; a dropped connection keeps the room on screen and
  // keeps trying; only "you have no seat here" goes back to the join form.
  const err = data.error as ApiError | null;
  const ended = err?.code === "seat_ended" ? (err.reason ?? "gone") : null;
  const refused = !!err && !ended && isRefusal(err);
  // "paused" is the browser reporting no network; an error without a refusal is the server not answering.
  const offline = data.fetchStatus === "paused" || (!!err && !ended && !refused);
  useEffect(() => {
    if (refused) navigate("/join");
  }, [refused]);
  const crypto = useSeatCrypto(data.data?.seat.id, !ended && data.data?.seat.status === "admitted");
  const attest = useAttestations(data.data?.seats, crypto);

  if (ended) {
    const gone = ended === "gone";
    return (
      <Shell>
        <div className="max-w-md py-10" data-testid="block-seat-ended">
          <h1 className="font-display font-semibold text-xl">{t("seat_ended_title")}</h1>
          <p className="text-sm text-muted-foreground mt-2 text-pretty" role="status">
            {t(gone ? "seat_ended_gone" : "seat_ended_removed")}
          </p>
          {!gone && (
            <div className="mt-6 pt-4 border-t border-border space-y-0.5">
              <h2 className="side-title">{t("room_tools")}</h2>
              <DataRights />
            </div>
          )}
          <Button variant="secondary" className="mt-6" data-testid="button-seat-ended-home" onClick={() => {
            setSessionToken(null);
            qc.clear();
            navigate("/");
          }}>{t("not_found_home")}</Button>
        </div>
      </Shell>
    );
  }

  if (!data.data) {
    return (
      <Shell>
        {offline
          ? <ConnectionNotice />
          : <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>}
      </Shell>
    );
  }

  const { room, seat, agenda, entries, seats, followups, reviewQueue, summary } = data.data;
  const proposals = data.data.proposals ?? [];
  const recordEntries = entries.filter((e) => isRecord(e.kind) && e.status === "approved");
  const otherEntries = entries.filter((e) => !isRecord(e.kind));
  const admitted = seat.status === "admitted";
  const speakerLabel = seats.find((s) => s.id === room.floorSeatId)?.label;
  const running = room.floorState === "running";
  const inCaucus = room.caucusSeatId === seat.id;
  const recoveryKey = getRecoveryKey();

  const myLabel = seats.find((s) => s.id === seat.id)?.label ?? seat.pseudonym;
  const pendingReview = (admitted && room.status !== "sealed" ? proposals.filter((p) => !p.my).length : 0)
    + (room.nextStepReview && admitted ? reviewQueue.filter((r) => !r.confirmed).length : 0)
    + (summary && admitted && !summary.myConfirmation?.confirmed ? 1 : 0);
  // Mirrors the server's checks on POST /api/participant/chat, in the same order,
  // so the composer only says "locked" for the reason that actually applies.
  const lock: string | null = inCaucus ? null
    : room.inputLocked ? t("input_locked_banner")
    : room.caucusSeatId ? t("caucus_room_note")
    : running && room.floorSeatId !== seat.id ? t("chat_lock")
    : null;
  // A waiting seat lands on Chat too: that is where the waiting state says what
  // happens next. Drafting is one click away from there.
  const defaultView = room.status === "sealed" ? "ledger" : "chat";
  const current = view ?? defaultView;

  if (seat.status === "left") {
    return (
      <Shell>
        <div className="max-w-md py-10">
          <h1 className="font-display font-semibold text-xl">{t("left_title")}</h1>
          <p className="text-sm text-muted-foreground mt-2 text-pretty">{t("leave_note")}</p>
          <Button variant="secondary" className="mt-6" onClick={() => {
            setSessionToken(null);
            qc.clear();
            navigate("/");
          }}>{t("not_found_home")}</Button>
        </div>
      </Shell>
    );
  }

  return (
    <CryptoContext.Provider value={crypto}>
    <Shell room sessionRole="participant" title={`${room.title} · ${room.code}`}>
      <RoomHeader
        title={room.title} code={room.code} status={room.status}
        chips={
          <>
            {inCaucus && <span className="chip chip-seal">{t("chat_caucus")}</span>}
            {room.inputLocked && !inCaucus && <span className="chip chip-warn">{t("input_paused")}</span>}
            <RoomRuleChips tier={room.tier} seatCap={room.seatCap} turnSeconds={room.turnSeconds} threshold={room.sealThreshold} />
          </>
        }
      />

      {offline && <ConnectionNotice />}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem] gap-6 lg:gap-8 items-start">
        <Tabs value={current} onValueChange={setView} className="min-w-0">
          <div className="tabs-bar mb-4 sm:mb-5 flex flex-wrap items-end justify-between gap-x-4">
            <TabsList aria-label={t("chat")}>
              <TabsTrigger value="chat" data-testid="tab-chat">{t("tab_chat")}</TabsTrigger>
              <TabsTrigger value="ledger" data-testid="tab-ledger">
                {t("tab_ledger")}<span className="count">{entries.length + proposals.length}</span>
                {pendingReview > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warn))]" aria-label={t("needs_you")} />}
              </TabsTrigger>
              <TabsTrigger value="draft" data-testid="tab-draft">{t("tab_draft")}</TabsTrigger>
            </TabsList>
            {!narrow && <FloorStrip room={room} speakerLabel={speakerLabel ?? undefined} />}
          </div>

          <TabsContent value="chat" forceMount className="mt-0 data-[state=inactive]:hidden">
            {admitted ? (
              <ParticipantChat active={current === "chat"} lock={lock} inCaucus={inCaucus}
                caucusElsewhere={!inCaucus && !!room.caucusSeatId} seatId={seat.id} label={myLabel}
                strip={narrow ? <FloorStrip room={room} speakerLabel={speakerLabel ?? undefined} inline /> : null} />
            ) : (
              <div className="px-6 py-14 text-center" data-testid="block-waiting" role="status">
                <BreathingIris />
                <h2 className="font-display font-semibold text-lg mt-7">{t("waiting_admission")}</h2>
                <p className="text-sm text-muted-foreground mt-1.5 text-pretty">{t("chat_waiting_admission")} {t("you_can_draft")}</p>
                <Button variant="secondary" size="sm" className="mt-5" onClick={() => setView("draft")}>{t("tab_draft")}</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ledger" className="mt-0 space-y-8">
            {room.status === "sealed" && room.fingerprint && <SealedNotice room={room} />}

            {admitted && room.status !== "sealed" && (
              <Proposals proposals={proposals} agenda={agenda} openRoom={room.anonymityMode === "open"} />
            )}

            {room.nextStepReview && reviewQueue.length > 0 && admitted && (
              <section>
                <h2 className="section-title pb-2">{t("next_step_review")}</h2>
                <ul className="divide-line border-y border-border">
                  {reviewQueue.map((r) => (
                    <li key={r.entryId} className="py-3 flex items-center gap-4">
                      <span className="mono-data text-xs text-muted-foreground">#{r.entryId}</span>
                      {r.confirmed ? (
                        <span className="text-sm text-primary inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" aria-hidden />{t("confirm_next_step")}</span>
                      ) : (
                        <Button size="sm" data-testid={`button-confirm-${r.entryId}`}
                          onClick={async () => {
                            try {
                              await apiJson("POST", `/api/participant/consents/${r.entryId}`, { confirm: true });
                              qc.invalidateQueries({ queryKey: ["/api/participant/room"] });
                            } catch (err: any) {
                              toast({ title: err.message, variant: "destructive" });
                            }
                          }}>
                          {t("confirm_next_step")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {summary && admitted && <SummaryCard summary={summary} />}

            {room.status !== "sealed" && recordEntries.length > 0 && (
              <section data-testid="section-record">
                <h2 className="section-title pb-2 flex items-baseline gap-2">
                  {t("rec_on_record")}<span className="section-count">{recordEntries.length}</span>
                </h2>
                <ul className="divide-line border-y border-border">
                  {recordEntries.slice().sort((a, b) => RECORD_KINDS.indexOf(a.kind as any) - RECORD_KINDS.indexOf(b.kind as any) || a.id - b.id).map((e) => (
                    <li key={e.id} className="py-4 space-y-2" data-testid={`card-record-p-${e.id}`}>
                      <p className="text-xs font-medium text-muted-foreground">{t(`rk1_${e.kind}`)}</p>
                      <RecordBody kind={e.kind} payload={e.payload} text={e.text} compact />
                      <SupportLine support={e.support} quiet />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(room.status !== "sealed" || data.data.ledgerVersion !== 2) && <section>
              <h2 className="section-title pb-2 flex items-baseline gap-2">
                {t("ledger_entries")}<span className="section-count">{otherEntries.length}</span>
              </h2>
              {otherEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground border-t border-border pt-4">{t("no_items")}</p>
              ) : (
                <ul className="divide-line border-y border-border" data-testid="list-ledger">
                  {otherEntries.slice().sort((a, b) => b.id - a.id).map((e) => (
                    <li key={e.id} data-testid={`card-entry-${e.id}`} className="py-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{kindLabel(t, e.kind)}{e.mine && <> · {t("my_drafts")}</>}</span>
                        <span className={`ms-auto chip ${e.status === "approved" ? "chip-ok" : e.status === "rejected" ? "chip-danger" : "chip-warn"}`}>
                          {t(e.status)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-pretty whitespace-pre-wrap">{e.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>}
          </TabsContent>

          <TabsContent value="draft" className="mt-0">
            {room.status === "live" ? (
              <DraftBox agenda={agenda} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("draft_closed")}</p>
            )}
            {!admitted && room.status === "live" && <p className="text-xs text-muted-foreground mt-3">{t("you_can_draft")}</p>}
          </TabsContent>
        </Tabs>

        {/* Sleek Geist-inspired Bento Grid Right-Hand Panel */}
        <aside className="w-full lg:w-80 flex flex-col gap-3.5 lg:sticky lg:top-20">
          {/* STAGE: High priority, top of the grid */}
          <BentoCard
            title={t("stage")}
            testId="card-stage"
            action={
              <CalmTime
                endsAt={room.stageEndsAt}
                running={!!room.stageEndsAt && room.stageEndsAt > Date.now()}
                testId="text-stage-timer"
              />
            }
          >
            <div className="flex flex-col gap-2.5">
              <div className="flex justify-between items-end">
                <span className="text-zinc-100 font-medium tracking-tight">
                  {t(`stage_${STAGES[Math.max(0, STAGES.indexOf(room.stage as any))]}`)}
                </span>
                <span className="text-xs text-zinc-500 font-mono">
                  {t("stage_of", { n: Math.max(0, STAGES.indexOf(room.stage as any)) + 1, total: STAGES.length })}
                </span>
              </div>
              {/* Subtle Progress Bar */}
              <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden flex gap-1 p-0.5">
                {STAGES.map((st, i) => {
                  const currentIdx = Math.max(0, STAGES.indexOf(room.stage as any));
                  return (
                    <div
                      key={st}
                      title={t(`stage_${st}`)}
                      className={`h-full flex-1 rounded-full transition-all duration-300 ${
                        i < currentIdx
                          ? "bg-emerald-500/80"
                          : i === currentIdx
                          ? "bg-emerald-400"
                          : "bg-zinc-800/80"
                      }`}
                    />
                  );
                })}
              </div>
              {room.inputLocked && !inCaucus && (
                <p className="text-xs text-amber-400 mt-1" data-testid="text-input-locked">
                  {t("input_locked_banner")}
                </p>
              )}
              {inCaucus && <p className="text-xs text-emerald-400 mt-1">{t("caucus_active")}</p>}
              {!inCaucus && room.caucusSeatId && (
                <p className="text-xs text-zinc-500 mt-1">{t("caucus_room_note")}</p>
              )}
            </div>
          </BentoCard>

          {/* SEATS: Scrollable interior if it gets too long */}
          <BentoCard
            title={t("seats")}
            action={
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800/80">
                {seats.filter((s) => s.status === "admitted").length}
              </span>
            }
          >
            <ul className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {seats.filter((s) => s.status === "admitted" || s.status === "waiting").map((s) => {
                const speaking = running && s.id === room.floorSeatId;
                const isMe = s.id === seat.id;
                return (
                  <li
                    key={s.id}
                    className={`flex items-start gap-2.5 p-2 rounded-lg transition-colors ${
                      speaking
                        ? "bg-zinc-900 border border-zinc-800"
                        : isMe
                        ? "bg-emerald-950/20 border border-emerald-900/30"
                        : "hover:bg-zinc-900/40"
                    }`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        isMe
                          ? "bg-emerald-400 ring-2 ring-emerald-500/20"
                          : s.status === "admitted"
                          ? "bg-zinc-600"
                          : "bg-amber-500/80"
                      }`}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`truncate text-sm ${isMe ? "text-emerald-50 font-medium" : "text-zinc-200"}`}>
                        {s.label}{isMe && <span className="text-zinc-500 font-normal"> · {t("you_suffix")}</span>}
                      </span>
                      <span className="text-xs text-zinc-500 truncate">
                        {s.claimedRole}{s.status === "waiting" && <> · {t("waiting")}</>}
                      </span>
                      <RoleBadge result={attest[s.id]} compact />
                    </div>
                  </li>
                );
              })}
            </ul>
          </BentoCard>

          {/* AGENDA: Clean numbered list */}
          {agenda.length > 0 && (
            <BentoCard title={t("agenda")}>
              <ol className="flex flex-col gap-2 list-none m-0 p-0 text-sm">
                {agenda.map((a, i) => {
                  const isCovered = a.status === "covered";
                  const numStr = String(a.position || i + 1).padStart(2, "0");
                  return (
                    <li
                      key={a.id}
                      className={`flex items-start gap-3 text-sm transition-colors ${
                        isCovered ? "text-zinc-600 line-through" : "text-zinc-300"
                      }`}
                    >
                      <span
                        className={`font-mono text-xs shrink-0 mt-0.5 ${
                          isCovered ? "text-zinc-700" : "text-emerald-500/70"
                        }`}
                      >
                        {numStr}
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{a.title}</span>
                    </li>
                  );
                })}
              </ol>
            </BentoCard>
          )}

          {/* IDENTITY: Bottom anchor */}
          <BentoCard
            title={t("identity")}
            action={
              room.anonymityMode === "open" && seat.realName && !seat.useRealName ? (
                <button
                  type="button"
                  data-testid="button-reveal-name"
                  className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 uppercase tracking-wider transition-colors"
                  onClick={async () => {
                    try {
                      await apiJson("POST", "/api/participant/reveal-name");
                      qc.invalidateQueries({ queryKey: ["/api/participant/room"] });
                      toast({ title: t("name_revealed") });
                    } catch (e: any) {
                      toast({ title: e.message, variant: "destructive" });
                    }
                  }}
                >
                  {t("reveal_name")}
                </button>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="font-medium text-zinc-100">
                  {seat.useRealName && seat.realName ? seat.realName : seat.pseudonym}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">{seat.claimedRole}</p>
                <div className="mt-1">
                  <RoleBadge result={attest[seat.id]} />
                </div>
              </div>

              {recoveryKey && (
                <div className="flex flex-col gap-2 mt-1" data-testid="card-recovery">
                  <div className="flex justify-between items-center bg-zinc-900/60 px-3 py-2 rounded-lg border border-zinc-800/60">
                    <span className="font-mono text-xs text-zinc-300 tracking-wider truncate mr-2">{recoveryKey}</span>
                    <button
                      type="button"
                      data-testid="button-copy-recovery-p"
                      aria-label={`${t("copy")}: ${t("recovery_key")}`}
                      className="text-xs font-mono text-zinc-400 hover:text-zinc-100 transition-colors shrink-0"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(recoveryKey);
                          toast({ title: t("copied") });
                        } catch {
                          toast({ title: t("copy_failed"), variant: "destructive" });
                        }
                      }}
                    >
                      {t("copy")}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    {t("recovery_note")}
                  </p>
                </div>
              )}
            </div>
          </BentoCard>

          {/* COMMITMENTS: If present */}
          {followups.length > 0 && (
            <BentoCard title={t("commitments")}>
              <ul className="flex flex-col gap-2.5">
                {followups.map((f) => (
                  <li key={f.id} className="text-xs bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800/40">
                    <p className="text-zinc-200 text-pretty">{f.text}</p>
                    <p className={`text-[11px] font-mono mt-1 ${f.status === "lapsed" ? "text-amber-400" : "text-zinc-500"}`}>
                      {t(f.status === "open" ? "open_status" : f.status)}{f.dueDate && <> · {t("due")}: {f.dueDate}</>}
                    </p>
                  </li>
                ))}
              </ul>
            </BentoCard>
          )}

          {/* ROOM TOOLS & LEAVE */}
          <BentoCard title={t("room_tools")}>
            <div className="flex flex-col gap-3">
              <div className="text-xs text-zinc-400">
                <DataRights />
              </div>
              <div className="pt-2 border-t border-zinc-800/50">
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="w-full text-left text-xs font-medium text-red-400/90 hover:text-red-300 transition-colors py-1 flex items-center justify-between"
                      data-testid="button-leave"
                    >
                      <span>{t("leave_room")}</span>
                      <span className="text-[10px] font-mono text-zinc-600">EXIT</span>
                    </button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-leave" className="bg-[#0e1014] border-neutral-800 text-neutral-200">
                    <DialogHeader>
                      <DialogTitle className="text-white">{t("leave_confirm_title")}</DialogTitle>
                      <DialogDescription className="text-zinc-400">{t("leave_confirm")}</DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-2 justify-end pt-2">
                      <DialogClose asChild>
                        <Button variant="ghost" size="sm" data-testid="button-leave-cancel">{t("cancel")}</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        size="sm"
                        data-testid="button-leave-confirm"
                        onClick={async () => {
                          try {
                            await apiJson("POST", "/api/participant/leave");
                            setSessionToken(null);
                            qc.clear();
                            navigate("/");
                          } catch (e: any) {
                            toast({ title: e.message || t("error_generic"), variant: "destructive" });
                          }
                        }}
                      >
                        {t("leave_room")}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </BentoCard>
        </aside>
      </div>
    </Shell>
    </CryptoContext.Provider>
  );
}

/* ── Stage: where the process is, right now ── */

function StageStrip({ room, inCaucus }: { room: PRoom["room"]; inCaucus: boolean }) {
  const { t } = useI18n();
  const stages = ["opening", "joint", "caucus", "drafting", "closing"] as const;
  const currentIndex = stages.indexOf(room.stage as (typeof stages)[number]);

  return (
    <div data-testid="card-stage">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="side-title">{t("stage")}</h2>
        <CalmTime endsAt={room.stageEndsAt} running={!!room.stageEndsAt && room.stageEndsAt > Date.now()} testId="text-stage-timer" />
      </div>
      <p className="text-sm">
        <span className="font-medium">{t(`stage_${stages[Math.max(0, currentIndex)]}`)}</span>
        <span className="text-muted-foreground"> · {t("stage_of", { n: Math.max(0, currentIndex) + 1, total: stages.length })}</span>
      </p>
      <ol className="flex gap-1 mt-2.5" aria-label={t("stage")}>
        {stages.map((st, i) => (
          <li key={st} aria-current={i === currentIndex ? "step" : undefined} title={t(`stage_${st}`)}
            className={`h-1 flex-1 rounded-sm ${i < currentIndex ? "bg-foreground/35" : i === currentIndex ? "bg-primary" : "bg-foreground/10"}`}>
            <span className="sr-only">{t(`stage_${st}`)}</span>
          </li>
        ))}
      </ol>
      {room.inputLocked && !inCaucus && (
        <p className="text-sm text-[hsl(var(--warn))] mt-3" data-testid="text-input-locked">{t("input_locked_banner")}</p>
      )}
      {inCaucus && <p className="text-sm text-[hsl(var(--seal))] mt-3">{t("caucus_active")}</p>}
      {!inCaucus && room.caucusSeatId && <p className="text-sm text-muted-foreground mt-3">{t("caucus_room_note")}</p>}
    </div>
  );
}

/* ── Outcome summary: dual verification ── */

function SummaryCard({ summary }: { summary: PSummary }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const sections: { key: "agreements" | "openIssues" | "nextSteps" | "disagreements" | "deadlines"; label: string }[] = [
    { key: "agreements", label: t("sec_agreements") },
    { key: "openIssues", label: t("sec_open_issues") },
    { key: "nextSteps", label: t("sec_next_steps") },
    { key: "disagreements", label: t("sec_disagreements") },
    { key: "deadlines", label: t("sec_deadlines") },
  ];

  const verify = async (confirmed: boolean) => {
    try {
      await apiJson("POST", `/api/participant/summary/${summary.id}/verify`, {
        confirmed, note: confirmed ? null : note || null,
      });
      qc.invalidateQueries({ queryKey: ["/api/participant/room"] });
      toast({ title: confirmed ? t("summary_verified_you") : t("summary_change_sent") });
      setNote(""); setShowNote(false);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  return (
    <section className="space-y-4" data-testid="card-summary-p">
      <h2 className="section-title flex flex-wrap items-baseline gap-x-2">
        {t("summary_title")}
        <span className="section-count">v{summary.version}</span>
        {summary.locked ? <span className="text-xs font-normal text-[hsl(var(--seal))]">{t("summary_locked_final")}</span> : null}
      </h2>
      <dl className="divide-line border-y border-border">
        {sections.map((s) => {
          const text = summary[s.key];
          if (!text) return null;
          return (
            <div key={s.key} className="py-3 grid sm:grid-cols-[10rem_minmax(0,1fr)] gap-x-6 gap-y-1">
              <dt className="text-sm text-muted-foreground">{s.label}</dt>
              <dd className="text-[0.9375rem] leading-relaxed text-pretty whitespace-pre-wrap">{text}</dd>
            </div>
          );
        })}
      </dl>
      {showNote && !summary.myConfirmation?.confirmed ? (
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("change_note")} aria-label={t("change_note")} data-testid="input-summary-note" />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {summary.myConfirmation?.confirmed ? (
          <p className="text-sm text-primary inline-flex items-center gap-1.5 me-2" data-testid="text-summary-verified">
            <Check className="h-3.5 w-3.5" aria-hidden />{t("summary_verified_you")}
          </p>
        ) : (
          <>
            <Button size="sm" data-testid="button-verify-summary" onClick={() => verify(true)}>
              {t("verify_summary")}
            </Button>
            {showNote ? (
              <>
                <Button size="sm" variant="secondary" data-testid="button-send-change" disabled={!note.trim()} onClick={() => verify(false)}>
                  {t("request_changes")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowNote(false); setNote(""); }}>{t("cancel")}</Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" data-testid="button-request-changes" onClick={() => setShowNote(true)}>
                {t("request_changes")}
              </Button>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" className="ms-auto" data-testid="button-export-summary-p" onClick={async () => {
          const res = await fetch(apiUrl("/api/participant/summary.md"), {
            headers: { "x-diavanish-session": getSessionToken() ?? "", "x-aperture-session": getSessionToken() ?? "" },
          });
          if (!res.ok) { toast({ title: t("error_generic"), variant: "destructive" }); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "diavanish-summary.md"; a.click();
          URL.revokeObjectURL(url);
        }}>
          {t("export_summary")}
        </Button>
      </div>
    </section>
  );
}

/* ── Floor strip: one line beside the tabs ── */

function FloorStrip({
  room, speakerLabel, inline,
}: {
  room: PRoom["room"];
  speakerLabel?: string;
  /** Rendered as a thin line at the top of the chat panel (phones). */
  inline?: boolean;
}) {
  const { t } = useI18n();
  const running = room.floorState === "running";

  return (
    <div className={inline
      ? `flex items-center gap-2.5 px-4 py-2 border-b border-border text-[0.8125rem] ${running ? "bg-primary/[0.06]" : ""}`
      : "flex items-center gap-2.5 pb-2.5"} data-testid="card-floor">
      <StatusDot tone={running ? "ok" : room.floorState === "paused" ? "warn" : "off"} />
      <p className={inline ? "min-w-0 flex-1 truncate" : "text-sm"} role="status" aria-live="polite" aria-atomic="true">
        {running
          ? <><span className="font-semibold">{speakerLabel}</span> {t("floor_running")}</>
          : room.floorState === "paused" ? t("floor_paused") : t("floor_idle")}
        {!inline && running && <span className="text-muted-foreground"> · {t("turn")} {room.turnNumber}</span>}
      </p>
      <CalmTime endsAt={room.floorEndsAt} running={running} totalMs={turnMs(room)} testId="text-timer" />
    </div>
  );
}

/* ── Draft composer ── */

function DraftBox({ agenda }: { agenda: PRoom["agenda"] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("issue");
  const [agendaItemId, setAgendaItemId] = useState("none");
  const [redacted, setRedacted] = useState(false);
  const [flagCount, setFlagCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const runRedaction = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiJson<{ flags: unknown[] }>("POST", "/api/redact", { text });
      setRedacted(true);
      setFlagCount(res.flags.length);
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await apiJson("POST", "/api/participant/entries", {
        agendaItemId: agendaItemId === "none" ? null : Number(agendaItemId),
        kind, text: text.trim(), redactionChecked: redacted,
      });
      setText(""); setRedacted(false);
      qc.invalidateQueries({ queryKey: ["/api/participant/room"] });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const selectCls = "select-native";
  return (
    <form className="space-y-4 max-w-2xl" aria-labelledby="draft-h" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <h2 id="draft-h" className="section-title">{t("draft_box")}</h2>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls} aria-label={t("kind")}>
          <option value="issue">{t("kind_issue")}</option>
          <option value="summary">{t("kind_summary")}</option>
          <option value="next-step">{t("kind_next_step")}</option>
        </select>
        {agenda.length > 0 && (
          <select value={agendaItemId} onChange={(e) => setAgendaItemId(e.target.value)} className={selectCls} aria-label={t("agenda")}>
            <option value="none">{t("agenda_none")}</option>
            {agenda.map((a) => <option key={a.id} value={String(a.id)}>{a.position}. {a.title}</option>)}
          </select>
        )}
      </div>
      <Textarea rows={4} data-testid="input-draft" value={text}
        onChange={(e) => { setText(e.target.value); setRedacted(false); }} placeholder={t("entry_text")} aria-label={t("entry_text")} />
      {redacted && (
        <p className={`text-xs flex items-center gap-1.5 ${flagCount > 0 ? "text-destructive" : "text-primary"}`} role="status" data-testid="text-redaction-result">
          {flagCount > 0 ? <X className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          {t(flagCount > 0 ? "redaction_flags" : "redaction_clean")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" data-testid="button-send-entry" disabled={!text.trim() || busy}>
          {t("propose")}
        </Button>
        <Button type="button" size="sm" variant="secondary" data-testid="button-redact-p" onClick={runRedaction} disabled={!text.trim() || busy}>
          {t("redaction_check")}
        </Button>
      </div>
    </form>
  );
}

/* ── Sealed ledger notice ── */

function SealedNotice({ room }: { room: PRoom["room"] }) {
  const { t, lang } = useI18n();
  const [result, setResult] = useState<"match" | "mismatch" | null>(null);
  const ledger = useQuery<{ ledgerVersion: 1 | 2; rows: any[]; document?: LedgerDocV2 }>({
    queryKey: [`/api/public/ledger/${room.code}`],
    staleTime: Infinity,
  });
  const doc = ledger.data?.document ?? null;

  const verify = async () => {
    try {
      const res = ledger.data ?? await apiJson<{ ledgerVersion: 1 | 2; rows: any[]; document?: unknown }>("GET", `/api/public/ledger/${room.code}`);
      // v1 hashes the approved rows, v2 the canonical sealed document. Same code as the server.
      const hex = await fingerprintFor(res.ledgerVersion ?? 1, { rows: res.rows, document: res.document });
      setResult(hex === room.fingerprint ? "match" : "mismatch");
    } catch {
      setResult("mismatch");
    }
  };
  const brief = (hash = "") => window.open(apiUrl(`/api/public/ledger/${room.code}/brief.html?lang=${lang}${hash}`), "_blank");

  return (
    <div className="space-y-8">
      <section className="space-y-3" data-testid="card-sealed-p">
        <h2 className="section-title">{t("seal_sealed_title")}</h2>
        <div>
          <p className="text-xs text-muted-foreground">{t("fingerprint")}</p>
          <p className="mono-data text-xs break-all text-[hsl(var(--seal))] mt-0.5" data-testid="text-fingerprint-p">
            {room.fingerprint}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" data-testid="button-verify-p" onClick={verify}>{t("verify_button")}</Button>
          {doc && <Button size="sm" variant="secondary" data-testid="button-brief-p" onClick={() => brief()}>{t("brief_open")}</Button>}
          {doc && <Button size="sm" variant="ghost" onClick={() => brief("#print")}>{t("brief_pdf")}</Button>}
        </div>
        <div role="status" aria-live="polite">
          {result === "match" && (
            <p className="text-sm text-primary flex items-start gap-2" data-testid="text-match">
              <Check className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />{t("match")}
            </p>
          )}
          {result === "mismatch" && (
            <p className="text-sm text-destructive flex items-start gap-2" data-testid="text-mismatch">
              <X className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />{t("mismatch")}
            </p>
          )}
        </div>
        {room.destructionCert ? (
          <details className="disclose" data-testid="card-destruction-cert-p">
            <summary className="text-sm text-muted-foreground hover:text-foreground w-fit">
              <ChevronRight className="chev h-3.5 w-3.5" aria-hidden />{t("destruction_cert")}
            </summary>
            <div className="pt-2 space-y-1.5">
              <p className="mono-data text-xs text-muted-foreground break-all">{room.destructionCert}</p>
              <p className="text-xs text-muted-foreground text-pretty max-w-[65ch]">{t("destruction_cert_note")}</p>
            </div>
          </details>
        ) : null}
      </section>
      {doc && <SealedRecord doc={doc} />}
    </div>
  );
}

/* ── Proposed for the record: one answer per item, per seat ── */

const LEVELS = ["full", "reservations", "objection"] as const;

function Proposals({ proposals, agenda, openRoom }: { proposals: Proposal[]; agenda: PRoom["agenda"]; openRoom: boolean }) {
  const { t } = useI18n();
  if (proposals.length === 0) return null;
  return (
    <section data-testid="section-proposals">
      <h2 className="section-title flex items-baseline gap-2">
        {t("prop_title")}<span className="section-count">{proposals.length}</span>
      </h2>
      <p className="text-sm text-muted-foreground text-pretty max-w-[65ch] mt-1 pb-3">{openRoom ? t("prop_note_open") : t("prop_note")}</p>
      <ul className="divide-line border-y border-border">
        {proposals.map((p) => <ProposalCard key={`${p.id}-${p.version}`} p={p} agendaTitle={agenda.find((a) => a.id === p.agendaItemId)?.title} />)}
      </ul>
    </section>
  );
}

function ProposalCard({ p, agendaTitle }: { p: Proposal; agendaTitle?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(!p.my);
  const [level, setLevel] = useState<(typeof LEVELS)[number] | null>(p.my?.support ?? null);
  const [reason, setReason] = useState(p.my?.reason ?? "");
  const [busy, setBusy] = useState(false);

  const send = async (support: (typeof LEVELS)[number] | null) => {
    setBusy(true);
    try {
      await apiJson("POST", `/api/participant/consents/${p.id}`, { support, reason: support === "objection" ? reason : undefined });
      await qc.invalidateQueries({ queryKey: ["/api/participant/room"] });
      setEditing(false);
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const answered = p.my ? (p.my.rewording ? t("sup_rewording_sent") : t(`sup_${p.my.support}`)) : null;
  const tone = p.my?.rewording ? "text-[hsl(var(--warn))]" : p.my?.support === "objection" ? "text-destructive" : p.my?.support === "reservations" ? "text-[hsl(var(--warn))]" : "text-[hsl(var(--ok))]";

  return (
    <li className="py-4 space-y-3" data-testid={`card-proposal-${p.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {!p.my && <span className="chip chip-warn">{t("needs_you")}</span>}
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground/80">{t(`rk1_${p.kind}`)}</span>
          {agendaTitle && <> · {agendaTitle}</>}
          {p.carriedFrom && !agendaTitle?.includes(p.carriedFrom) && <> · {t("rec_carried", { code: p.carriedFrom })}</>}
        </span>
        <span className="ms-auto whitespace-nowrap">{t("prop_answered", { n: p.responded, m: p.required })}</span>
      </div>
      <RecordBody kind={p.kind} payload={p.payload} text={p.text} />

      {!editing && answered ? (
        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs text-muted-foreground">{t("sup_you")}</span>
          <span className={`text-sm ${tone}`} data-testid={`text-my-support-${p.id}`}>{answered}</span>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setEditing(true)}>{t("sup_change")}</Button>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("sup_you")}>
            {LEVELS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={level === l} data-testid={`button-support-${l}-${p.id}`}
                onClick={() => setLevel(l)}
                className={`min-h-11 rounded-md border px-2 text-[0.8125rem] font-medium transition-colors ${
                  level === l
                    ? l === "objection" ? "border-destructive/60 bg-destructive/10 text-foreground"
                      : l === "reservations" ? "border-[hsl(var(--warn))]/60 bg-[hsl(var(--warn))]/10 text-foreground"
                      : "border-[hsl(var(--ok))]/60 bg-[hsl(var(--ok))]/10 text-foreground"
                    : "border-[var(--line-strong)] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                }`}>
                {t(`sup_${l}_short`)}
              </button>
            ))}
          </div>
          {level === "objection" && (
            <Input value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} aria-label={t("sup_reason")}
              placeholder={t("sup_reason")} data-testid={`input-reason-${p.id}`} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!level || busy} onClick={() => level && send(level)} data-testid={`button-consent-${p.id}`}>
              {t("sup_send")}
            </Button>
            <button type="button" disabled={busy} onClick={() => send(null)} data-testid={`button-rewording-${p.id}`}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline px-1 min-h-9">
              {t("sup_rewording")}
            </button>
            {p.my && <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setEditing(false)}>{t("cancel")}</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

/* ── Role attestation badge — the check runs in this browser ── */

function RoleBadge({ result, compact }: { result?: AttestResult; compact?: boolean }) {
  const { t } = useI18n();
  if (!result || result === "none") return null;
  const tone = result === "verified" ? "text-[hsl(var(--ok))]" : result === "invalid" ? "text-destructive" : "text-muted-foreground";
  const label = result === "verified" ? t("role_attested") : result === "invalid" ? t("role_invalid") : t("role_earlier_key");
  return (
    <span className={`${compact ? "text-xs mt-0.5" : "text-xs mt-2"} flex items-start gap-1 ${tone}`} data-testid={`text-attest-${result}`}>
      {result === "invalid" ? <X className="h-3 w-3 mt-0.5 shrink-0" aria-hidden /> : <Check className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />}{label}
    </span>
  );
}

/* ── Chat — sealed in this browser; the server relays ciphertext only ── */

function ParticipantChat({ active, lock, inCaucus, caucusElsewhere, seatId, label, strip }: {
  active: boolean; lock: string | null; inCaucus?: boolean; caucusElsewhere?: boolean; seatId: number; label: string;
  /** Phone: the floor line sits inside the chat panel instead of above it. */
  strip?: ReactNode;
}) {
  const { t } = useI18n();
  const crypto = useRoomCrypto();
  const { toast } = useToast();
  const channel = inCaucus ? `caucus:${seatId}` : "floor";
  const { lines, send } = useEncryptedChat({
    crypto, channel, getUrl: "/api/participant/chat", postUrl: "/api/participant/chat", label,
    facilitatorName: t("role_facilitator"),
  });
  const ready = crypto.status === "ready";

  const banner = !ready ? (
    <p className="text-sm text-muted-foreground px-5 py-2.5 border-b border-border" role={crypto.status === "error" ? "alert" : "status"} data-testid="text-e2ee-waiting">
      {crypto.status === "error" ? t("e2ee_error") : t("e2ee_waiting")}
    </p>
  ) : inCaucus ? (
    <p className="text-sm text-[hsl(var(--seal))] px-5 py-2.5 border-b border-border bg-[hsl(var(--seal)/0.05)]">{t("caucus_active")}</p>
  ) : caucusElsewhere ? (
    <div className="px-5 py-3 border-b border-border bg-[#0e1014] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)] flex items-start gap-3">
      <span className="w-2 h-2 rounded-full bg-amber-400/90 animate-pulse mt-1 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-neutral-200">{t("caucus_room_note")}</p>
        <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">
          The facilitator is in an executive sidebar with another seat. The main floor is quiet; no messages or keystrokes are logged. You will be rejoined automatically when the sidebar concludes.
        </p>
      </div>
    </div>
  ) : null;

  return (
    <ChatShell
      fill={active}
      compactHeadOnMobile
      lines={lines}
      title={t("chat")}
      headerExtra={
        <span className={`chip ${inCaucus ? "chip-seal" : ""}`}>{inCaucus ? t("chat_caucus") : t("chat_floor")}</span>
      }
      banner={<>{strip}{banner}</>}
      onSend={async (text) => {
        try { await send(text); } catch (e: any) { toast({ title: e.message, variant: "destructive" }); throw e; }
      }}
      canSend={ready && !lock}
      lockedReason={!ready ? t("e2ee_waiting") : lock}
      placeholder={inCaucus ? t("chat_placeholder_caucus") : t("chat_placeholder")}
      emptyBody={crypto.demo ? t("chat_note_demo") : inCaucus ? t("chat_empty_caucus") : t("chat_note")}
      logLabel={inCaucus ? `${t("chat")} · ${t("chat_caucus")}` : t("chat")}
      facilitatorName={t("role_facilitator")}
    />
  );
}
