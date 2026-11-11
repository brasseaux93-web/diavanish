/*
 * Facilitator room. This file is the page frame (header, tabs, data); each
 * tab lives in ./facilitator/.
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Shell } from "@/components/vault";
import { apiJson, isRefusal } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useNarrow } from "@/hooks/use-narrow";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CryptoContext, useFacilitatorCrypto } from "@/lib/e2ee-client";
import { RoomHeader, ConnectionNotice } from "@/components/room/room-chrome";
import type { RoomData, Call } from "./facilitator/types";
import { FloorTab } from "./facilitator/floor";
import { BoardTab } from "./facilitator/board";
import { SeatsTab } from "./facilitator/seats";
import { FollowupPanel } from "./facilitator/follow";
import { SummaryPanel } from "./facilitator/summary";
import { SealPanel, type Colleague } from "./facilitator/seal";
import { RecordTab } from "./facilitator/record";
import { RoomRuleChips } from "@/components/ledger/record";
import { RECORD_KINDS } from "@shared/ledger";
import { formatMinutes, turnMs } from "@shared/tiers";

const MORE_TABS = ["board", "follow", "summary", "seal"];
const isRecord = (k: string) => (RECORD_KINDS as readonly string[]).includes(k);

export default function FacilitatorRoom({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const roomId = Number(params.id);
  const [tab, setTab] = useState<string | null>(null);
  const compactTabs = useNarrow("(max-width: 479px)");

  const data = useQuery<RoomData>({
    queryKey: ["/api/facilitator/rooms", String(roomId)],
    refetchInterval: 2500,
  });
  // Colleagues a room can be handed to. (Not the admin list, which a facilitator may not read.)
  const colleagues = useQuery<Colleague[]>({ queryKey: ["/api/facilitator/colleagues"] });
  const session = useQuery({ queryKey: ["/api/auth/session"] });

  // Leave only when the server refuses (signed out, or not this facilitator's
  // room). A dropped connection keeps the room on screen and keeps trying.
  const refused = !!data.error && isRefusal(data.error);
  // "paused" is the browser reporting no network; an error without a refusal is the server not answering.
  const offline = data.fetchStatus === "paused" || (!!data.error && !refused);
  useEffect(() => {
    if (refused || session.data === null) navigate("/facilitate");
  }, [refused, session.data]);
  // Sender certificates bind the name this screen shows for each seat.
  const certLabels = Object.fromEntries((data.data?.seats ?? []).map((s) =>
    [s.id, s.useRealName && s.realName ? s.realName : s.pseudonym]));
  const crypto = useFacilitatorCrypto(roomId, data.data?.room.status === "live", certLabels);

  const call: Call = async (fn, ok) => {
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms", String(roomId)] });
      if (ok) toast({ title: ok });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  if (!data.data) {
    return <Shell room>{offline ? <ConnectionNotice /> : <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>}</Shell>;
  }

  const { room, agenda, seats, entries, invites, followups, notes, audit, summaries } = data.data;
  const admitted = seats.filter((s) => s.status === "admitted");
  const waiting = seats.filter((s) => s.status === "waiting").length;
  const boardEntries = entries.filter((e) => !isRecord(e.kind));
  const pending = boardEntries.filter((e) => e.status === "pending").length;
  const recordPending = entries.filter((e) => isRecord(e.kind) && e.status === "pending").length;
  const turnLabel = formatMinutes(turnMs(room) / 1000);
  const seatName = (id: number | null) => {
    const s = seats.find((x) => x.id === id);
    if (!s) return t("role_facilitator");
    return s.useRealName && s.realName ? s.realName : s.pseudonym;
  };
  const current = tab ?? (room.status === "live" ? "floor" : "board");

  return (
    <CryptoContext.Provider value={crypto}>
    <Shell room sessionRole="facilitator" crumbs={[{ label: t("crumb_rooms"), to: "/facilitate/rooms" }, { label: room.title }]}>
      <RoomHeader
        title={room.title} code={room.code} status={room.status}
        chips={
          <>
            {room.status === "live" && <span className="chip">{t(`stage_${room.stage}`)}</span>}
            {room.inputLocked ? <span className="chip chip-warn">{t("input_paused")}</span> : null}
            {room.caucusSeatId ? <span className="chip chip-seal">{t("chat_with", { name: seatName(room.caucusSeatId) })}</span> : null}
            <RoomRuleChips tier={room.tier} seatCap={room.seatCap} turnSeconds={room.turnSeconds} threshold={room.sealThreshold} />
          </>
        }
        leading={
          <button data-testid="link-back-rooms" onClick={() => navigate("/facilitate/rooms")} aria-label={t("crumb_rooms")}
            className="sm:hidden -ms-2 inline-grid place-items-center h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
        }
        details={
          <p className="text-sm text-muted-foreground">
            {room.anonymityMode === "open" ? t("anonymity_open") : t("anonymity_anon")} · {turnLabel}
          </p>
        }
        actions={room.status === "draft" ? (
          <Button data-testid="button-open-room"
            onClick={() => call(() => apiJson("POST", `/api/facilitator/rooms/${roomId}/open`))}>
            {t("open_room")}
          </Button>
        ) : null}
      />

      {offline && <ConnectionNotice />}

      <Tabs value={current} onValueChange={setTab}>
        <div className="tabs-bar mb-4 sm:mb-6">
        <TabsList>
          <TabsTrigger value="floor">{t("tab_floor")}</TabsTrigger>
          <TabsTrigger value="record" data-testid="tab-record">
            {t("tab_record")}{recordPending > 0 && <span className="count">{recordPending}</span>}
          </TabsTrigger>
          {!compactTabs && (
            <TabsTrigger value="board">
              {t("tab_board")}{pending > 0 && <span className="count">{pending}</span>}
            </TabsTrigger>
          )}
          <TabsTrigger value="seats">
            {t("tab_seats")}{waiting > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warn))]" aria-label={t("waiting")} />}
          </TabsTrigger>
          {!compactTabs && (
            <>
              <TabsTrigger value="follow">{t("tab_follow")}</TabsTrigger>
              <TabsTrigger value="summary">{t("tab_summary")}</TabsTrigger>
              <TabsTrigger value="seal">{t("tab_seal")}</TabsTrigger>
            </>
          )}
        </TabsList>
          {compactTabs && (
            // Outside the tablist: a menu button is not an allowed child of role="tablist".
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-testid="button-more-tabs" data-current={MORE_TABS.includes(current) || undefined}
                  className="more-tabs-btn"
                  aria-label={MORE_TABS.includes(current) ? `${t("more_tabs")}: ${t(`tab_${current}`)}` : t("more_tabs")}>
                  {MORE_TABS.includes(current) ? t(`tab_${current}`) : t("more_tabs")}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MORE_TABS.map((v) => (
                  <DropdownMenuItem key={v} data-testid={`menu-tab-${v}`} onSelect={() => setTab(v)} className="min-h-11">
                    {t(`tab_${v}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <TabsContent value="floor" forceMount className="mt-0 data-[state=inactive]:hidden">
          <FloorTab room={room} admitted={admitted} seatName={seatName} call={call} active={current === "floor"} />
        </TabsContent>

        <TabsContent value="record" className="mt-0">
          <RecordTab room={room} agenda={agenda} seats={seats} entries={entries} call={call} />
        </TabsContent>

        <TabsContent value="board" className="mt-0">
          <BoardTab roomId={roomId} room={room} agenda={agenda} seats={seats} entries={boardEntries}
            notes={notes} audit={audit} seatName={seatName} call={call} />
        </TabsContent>

        <TabsContent value="seats" className="mt-0">
          <SeatsTab roomId={roomId} invites={invites} seats={seats} requiresRoleProof={!!room.requiresRoleProof} call={call} />
        </TabsContent>

        <TabsContent value="follow" className="mt-0">
          <FollowupPanel roomId={roomId} seats={admitted} followups={followups} seatName={seatName} call={call} />
        </TabsContent>

        <TabsContent value="summary" className="mt-0">
          <SummaryPanel room={room} admitted={admitted} summaries={summaries} seatName={seatName} call={call} />
        </TabsContent>

        <TabsContent value="seal" className="mt-0">
          <SealPanel room={room} call={call} colleagues={colleagues.data ?? []} navigate={navigate} />
        </TabsContent>
      </Tabs>
    </Shell>
    </CryptoContext.Provider>
  );
}
