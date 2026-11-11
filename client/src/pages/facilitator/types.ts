import type { Room, AgendaItem, Seat, Invite, Followup, Note, AuditEntry } from "@shared/schema";
import type { SupportView } from "@shared/ledger";
import type { Decision } from "@shared/tiers";

/** Structured items only. Nothing about the answers until every seat has answered;
 *  then levels only in rooms under seven seats, counts otherwise. Never who answered or what. */
export type Tally = {
  responded: number; required: number; complete: boolean; ready: boolean; detail: "levels" | "counts";
  decision: { passed: boolean; blocker: Decision["blocker"] };
  support: SupportView | null;
  rewording: number | null; consenting: number | null; anyRewording: boolean | null;
};

export type EntryRow = {
  id: number; roomId: number; agendaItemId: number | null; kind: string;
  visibility: string; status: string; authorSeatId: number | null;
  currentVersion: number; conditionText: string | null; released: number;
  redactionChecked: number; approvedAt: number | null; createdAt: number; carriedFrom?: string | null;
  versions: { id: number; entryId: number; version: number; text: string; payload?: string | null; createdAt: number }[];
  consents: { id: number; entryId: number; seatId: number; confirmed: number; createdAt: number }[];
  tally?: Tally | null;
};

export type SummaryRow = {
  id: number; roomId: number; version: number; agreements: string; openIssues: string;
  nextSteps: string; disagreements: string; deadlines: string; locked: number; createdAt: number;
  confirmations: { id: number; summaryVersionId: number; seatId: number; confirmed: number; note: string | null; createdAt: number }[];
};

export type RoomData = {
  room: Room; agenda: AgendaItem[]; seats: Seat[]; entries: EntryRow[];
  invites: Invite[]; followups: Followup[]; notes: Note[]; audit: AuditEntry[];
  summaries: SummaryRow[];
};

export type RedactionFlag = { start: number; end: number; label: string };

/** Runs a facilitator action, refreshes the room and reports errors as a toast. */
export type Call = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
export type SeatName = (id: number | null) => string;
