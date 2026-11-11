/* Pure grouping for the chat log: day separators and runs of lines from one sender. */
import type { ChatLine } from "@/lib/e2ee-client";

type Readable = Extract<ChatLine, { text: string }>;
export type ChatItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "system"; key: string; seq: number }
  | { kind: "group"; key: string; from: number | "facilitator" | null; mine: boolean; verified: boolean; name: string; facilitator: boolean; at: number; lines: Readable[] };

/** Lines from one sender within this window share a header. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * A group never mixes verified and unverified lines, or ours and theirs, so a
 * forged line cannot hide under a genuine sender's verified header.
 */
export function buildItems(lines: ChatLine[], facilitatorName: string, dayLabel: (ms: number) => string): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDay = "";
  let group: Extract<ChatItem, { kind: "group" }> | null = null;
  for (const l of lines) {
    if ("unreadable" in l) {
      group = null;
      items.push({ kind: "system", key: `u${l.seq}`, seq: l.seq });
      continue;
    }
    const at = l.sentAt || 0;
    const dk = at ? dayKey(at) : lastDay;
    if (at && dk !== lastDay) {
      items.push({ kind: "day", key: `d${dk}`, label: dayLabel(at) });
      lastDay = dk;
      group = null;
    }
    const prev = group?.lines[group.lines.length - 1];
    const same = group && group.mine === l.mine && group.verified === l.verified && group.name === l.name && group.from === l.from
      && (!prev || !at || !prev.sentAt || Math.abs(at - prev.sentAt) < GROUP_GAP_MS);
    if (same && group) {
      group.lines.push(l);
    } else {
      group = {
        kind: "group", key: `g${l.seq}`, from: l.from, mine: l.mine, verified: l.verified, name: l.name,
        facilitator: l.verified && l.from === "facilitator" && l.name === facilitatorName, at, lines: [l],
      };
      items.push(group);
    }
  }
  return items;
}
