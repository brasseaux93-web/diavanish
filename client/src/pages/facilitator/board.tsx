import { useState } from "react";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { encryptDraft, decryptDraft } from "@/components/vault";
import { apiJson } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Room, AgendaItem, Seat, Note, AuditEntry } from "@shared/schema";
import type { EntryRow, RedactionFlag, Call, SeatName } from "./types";
import { kindLabel } from "@/components/ledger/record";

/* ── Board: agenda beside the ledger, the composer on top ── */

export function BoardTab({
  roomId, room, agenda, seats, entries, notes, audit, seatName, call,
}: {
  roomId: number; room: Room; agenda: AgendaItem[]; seats: Seat[]; entries: EntryRow[];
  notes: Note[]; audit: AuditEntry[]; seatName: SeatName; call: Call;
}) {
  const { t } = useI18n();
  const sorted = entries.slice().sort((a, b) =>
    (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.id - a.id);
  return (
    <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
      <aside className="side-panel order-2 lg:order-none lg:sticky lg:top-20 divide-line [&>section]:py-5 [&>section:first-child]:pt-0">
        <section>
          <p className="side-title">{t("agenda")}</p>
          <ol className="space-y-0.5 mb-3">
            {agenda.length === 0 && <li className="text-sm text-muted-foreground">{t("no_items")}</li>}
            {agenda.map((a) => (
              <li key={a.id} className="group flex items-center gap-2.5 text-sm rounded-lg -mx-2.5 px-2.5 py-1.5 row-hover">
                <span className="mono-data text-xs text-muted-foreground w-4 shrink-0">{a.position}</span>
                <span className={`min-w-0 flex-1 ${a.status === "covered" ? "text-muted-foreground line-through" : ""}`}>{a.title}</span>
                <button type="button" className="touch-target h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                  aria-label={a.status === "covered" ? `${a.title}: ${t("open_status")}` : `${a.title}: ${t("approved")}`}
                  onClick={() => call(() => apiJson("POST", `/api/facilitator/agenda/${a.id}/status`, {
                    status: a.status === "covered" ? "open" : "covered",
                  }))}>
                  {a.status === "covered" ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                </button>
              </li>
            ))}
          </ol>
          <AddAgenda roomId={roomId} />
        </section>
        <section>
          <p className="side-title">{t("facilitator_notes")}</p>
          <NoteBox roomId={roomId} notes={notes} />
        </section>
        <section>
          <details className="disclose">
            <summary className="side-title !mb-0 hover:text-foreground">
              <ChevronRight className="chev h-3.5 w-3.5" aria-hidden />{t("audit_log")}
              <span className="section-count ms-auto">{audit.length}</span>
            </summary>
            <div className="space-y-1 max-h-60 overflow-auto pt-3">
              {audit.map((a) => (
                <div key={a.id} className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-xs">
                  <span className="mono-data text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="mono-data truncate" title={`${a.actor} · ${a.action}`}>{a.action}</span>
                </div>
              ))}
            </div>
          </details>
        </section>
      </aside>

      <div className="min-w-0 space-y-8">
        <Composer roomId={roomId} room={room} agenda={agenda} />
        <section>
          <h2 className="section-title pb-2 flex items-baseline gap-2">
            {t("entries")}<span className="section-count">{entries.length}</span>
          </h2>
          <div className="divide-line border-y border-border">
            {entries.length === 0 && <p className="text-sm text-muted-foreground py-4">{t("no_items")}</p>}
            {sorted.map((e) => (
              <EntryCard key={e.id} e={e} seatName={seatName} agenda={agenda} room={room} seats={seats} call={call} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Agenda add ── */

export function AddAgenda({ roomId }: { roomId: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  // Keep the text until the server has accepted it, so a failure loses nothing.
  async function add() {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await apiJson("POST", `/api/facilitator/rooms/${roomId}/agenda`, { title: value });
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms", String(roomId)] });
    } catch (e: any) {
      toast({ title: e?.message || t("error_generic"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Input value={title} placeholder={t("add_agenda")} aria-label={t("add_agenda")} className="text-sm"
        data-testid="input-agenda" onChange={(e) => setTitle(e.target.value)} />
      <Button type="submit" size="sm" variant="secondary" data-testid="button-agenda-add" disabled={!title.trim() || busy}>{t("add")}</Button>
    </form>
  );
}

/* ── Composer with redaction + AI draft + sealed drafts ── */

export function Composer({ roomId, room, agenda }: { roomId: number; room: Room; agenda: AgendaItem[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [kind, setKind] = useState("issue");
  const [visibility, setVisibility] = useState("all");
  const [text, setText] = useState("");
  const [condition, setCondition] = useState("");
  const [agendaItemId, setAgendaItemId] = useState<string>("none");
  const [flags, setFlags] = useState<RedactionFlag[] | null>(null);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [sealedDrafts, setSealedDrafts] = useState<{ label: string; payload: string }[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [openSealed, setOpenSealed] = useState("");
  const [sealedLabel, setSealedLabel] = useState("");

  const runRedaction = async () => {
    const res = await apiJson<{ flags: RedactionFlag[]; clean: boolean }>("POST", "/api/redact", { text });
    setFlags(res.flags);
    if (!res.clean) toast({ title: t("redaction_flags"), variant: "destructive" });
    else toast({ title: t("redaction_clean") });
  };

  const ai = async () => {
    try {
      const res = await apiJson<{ draft: string }>("POST", `/api/facilitator/rooms/${roomId}/ai-draft`);
      setAiDraft(res.draft);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const propose = async () => {
    try {
      await apiJson("POST", "/api/facilitator/entries", {
        roomId, agendaItemId: agendaItemId === "none" ? null : Number(agendaItemId),
        kind, visibility, conditionText: condition || null, text,
        redactionChecked: flags !== null,
      });
      setText(""); setCondition(""); setFlags(null); setAiDraft(null);
      qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms", String(roomId)] });
      toast({ title: t("propose") });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  const sealDraft = async () => {
    if (!text || !passphrase || !sealedLabel) return;
    const payload = await encryptDraft(text, passphrase);
    setSealedDrafts([...sealedDrafts, { label: sealedLabel, payload }]);
    setPassphrase(""); setSealedLabel("");
  };

  const openSealedDraft = async () => {
    try {
      const pt = await decryptDraft(openSealed, passphrase);
      setText(pt);
    } catch {
      toast({ title: t("wrong_code"), variant: "destructive" });
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="compose-h">
      <h2 id="compose-h" className="section-title">{t("compose")}</h2>

      <div className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("kind")}</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-36" aria-label={t("kind")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="issue">{t("kind_issue")}</SelectItem>
              <SelectItem value="summary">{t("kind_summary")}</SelectItem>
              <SelectItem value="next-step">{t("kind_next_step")}</SelectItem>
              <SelectItem value="attestation">{t("kind_attestation")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("visibility")}</Label>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className="w-40" aria-label={t("visibility")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("vis_all")}</SelectItem>
              <SelectItem value="facilitator">{t("vis_facilitator")}</SelectItem>
              <SelectItem value="conditional">{t("vis_conditional")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex-1 min-w-40">
          <Label className="text-xs">{t("agenda")}</Label>
          <Select value={agendaItemId} onValueChange={setAgendaItemId}>
            <SelectTrigger aria-label={t("agenda")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {agenda.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.position}. {a.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visibility === "conditional" && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("condition_text")}</Label>
          <Input value={condition} aria-label={t("condition_text")} onChange={(e) => setCondition(e.target.value)} />
        </div>
      )}

      <Textarea
        data-testid="input-entry-text"
        aria-label={t("entry_text")}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("entry_text")}
      />

      {flags && flags.length > 0 && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm" role="alert">
          {t("redaction_flags")}
          <div className="mono-data text-xs mt-1 space-y-0.5">
            {flags.map((f, i) => (
              <div key={i}>· {f.label}: …{text.slice(Math.max(0, f.start - 6), f.end + 6)}…</div>
            ))}
          </div>
        </div>
      )}
      {flags && flags.length === 0 && (
        <p className="text-xs text-primary flex items-center gap-1.5" role="status"><Check className="h-3.5 w-3.5" aria-hidden />{t("redaction_clean")}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" data-testid="button-redact" onClick={runRedaction} disabled={!text}>
          {t("redaction_check")}
        </Button>
        <Button variant="ghost" size="sm" data-testid="button-ai" onClick={ai}>
          {t("ai_draft")}
        </Button>
        <Button data-testid="button-propose" className="ms-auto" onClick={propose} disabled={!text}>
          {t("propose")}
        </Button>
      </div>

      {aiDraft && (
        <div className="rounded-md bg-foreground/[0.04] p-4 space-y-3" data-testid="block-summary-draft">
          <p className="text-sm font-medium">{t("ai_draft")}</p>
          <pre className="text-sm whitespace-pre-wrap font-sans">{aiDraft}</pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { setText(aiDraft); setAiDraft(null); }}>
              {t("use_draft")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAiDraft(null)}>{t("cancel")}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("ai_draft_note")}</p>
        </div>
      )}

      {/* Sealed drafts — encrypted in this browser only */}
      <details className="disclose">
        <summary className="text-sm text-muted-foreground hover:text-foreground w-fit">
          <ChevronRight className="chev h-3.5 w-3.5" aria-hidden />{t("sealed_drafts")}
        </summary>
        <div className="space-y-3 pt-3">
        <p className="text-xs text-muted-foreground">{t("sealed_drafts_note")}</p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1.5 flex-1 min-w-32">
            <Label className="text-xs">{t("draft_label")}</Label>
            <Input value={sealedLabel} aria-label={t("draft_label")} onChange={(e) => setSealedLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1 min-w-32">
            <Label className="text-xs">{t("passphrase")}</Label>
            <Input type="password" autoComplete="off" value={passphrase} aria-label={t("passphrase")} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
          <Button variant="secondary" size="sm" className="min-h-10" onClick={sealDraft} disabled={!text || !passphrase || !sealedLabel}>
            {t("seal_draft")}
          </Button>
        </div>
        {sealedDrafts.map((d, i) => (
          <div key={i} className="border-t border-border pt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">{d.label}</span>
            <code className="mono-data text-xs text-muted-foreground break-all max-w-full">{d.payload.slice(0, 56)}…</code>
            <Button size="sm" variant="secondary" className="ms-auto"
              onClick={() => setOpenSealed(d.payload)}>{t("open")}</Button>
          </div>
        ))}
        {openSealed && (
          <div className="flex gap-2 items-end">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">{t("passphrase")}</Label>
              <Input type="password" autoComplete="off" value={passphrase} aria-label={t("passphrase")} onChange={(e) => setPassphrase(e.target.value)} />
            </div>
            <Button size="sm" onClick={openSealedDraft}>{t("open")}</Button>
          </div>
        )}
        </div>
      </details>

      {room.status !== "live" && (
        <p className="text-xs text-muted-foreground">{t("room_not_live")}</p>
      )}
    </section>
  );
}

/* ── Entry card ── */

export function EntryCard({
  e, seatName, agenda, room, seats, call,
}: {
  e: EntryRow;
  seatName: SeatName;
  agenda: AgendaItem[];
  room: Room;
  seats: Seat[];
  call: Call;
}) {
  const { t } = useI18n();
  const [revising, setRevising] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const current = e.versions.find((v) => v.version === e.currentVersion);
  const item = agenda.find((a) => a.id === e.agendaItemId);
  const confirmed = e.consents.filter((c) => c.confirmed).length;
  const requiredConfirmations = room.nextStepReview && e.kind === "next-step"
    ? Math.max(1, seats.filter((s) => s.status === "admitted").length) : 0;

  return (
    <div data-testid={`card-entry-${e.id}`} className="py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className={`chip ${e.status === "approved" ? "chip-ok" : e.status === "rejected" ? "chip-danger" : "chip-warn"}`}>{t(e.status)}</span>
        <span>
          {kindLabel(t, e.kind)}
          {e.currentVersion > 1 && <> · v{e.currentVersion}</>}
          {e.visibility !== "all" && <> · {t(e.visibility === "facilitator" ? "vis_facilitator" : "vis_conditional")}</>}
          {" · "}{seatName(e.authorSeatId)}
          {item && <> · {item.title}</>}
        </span>
        <span className="ms-auto mono-data">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {revising ? (
        <div className="mt-3 space-y-2">
          <Textarea rows={3} value={reviseText} aria-label={t("revise")} onChange={(ev) => setReviseText(ev.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => {
              await call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/revise`, { text: reviseText }));
              setRevising(false);
            }}>{t("revise")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setRevising(false)}>{t("cancel")}</Button>
          </div>
        </div>
      ) : (
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-pretty whitespace-pre-wrap">{current?.text}</p>
      )}

      {e.kind === "next-step" && room.nextStepReview && (
        <p className="text-xs text-muted-foreground mt-2">
          {t("next_step_review")} · {t("confirmed_count", { n: confirmed, total: requiredConfirmations })}
        </p>
      )}
      {e.visibility === "conditional" && !e.released && (
        <p className="text-xs text-muted-foreground mt-2">{t("condition_text")}: {e.conditionText}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {e.status !== "approved" && (
          <Button size="sm" data-testid={`button-approve-${e.id}`}
            onClick={() => call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/approve`, { requiredConfirmations }), t("approved"))}>
            {t("approve")}
          </Button>
        )}
        {!revising && (
          <Button size="sm" variant="secondary" onClick={() => { setReviseText(current?.text ?? ""); setRevising(true); }}>
            {t("revise")}
          </Button>
        )}
        {e.status !== "rejected" && (
          <Button size="sm" variant="destructive"
            onClick={() => call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/reject`))}>
            {t("reject")}
          </Button>
        )}
        {e.visibility === "conditional" && !e.released && (
          <Button size="sm" data-testid={`button-release-${e.id}`}
            onClick={() => call(() => apiJson("POST", `/api/facilitator/entries/${e.id}/release`))}>
            {t("release")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Notes ── */

export function NoteBox({ roomId, notes }: { roomId: number; notes: Note[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await apiJson("POST", `/api/facilitator/rooms/${roomId}/notes`, { text: value });
      setText("");
      await qc.invalidateQueries({ queryKey: ["/api/facilitator/rooms", String(roomId)] });
    } catch (e: any) {
      toast({ title: e?.message || t("error_generic"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <div key={n.id} className="text-sm text-pretty">
          {n.text}
          <span className="block text-xs text-muted-foreground mt-0.5">{new Date(n.createdAt).toLocaleString()}</span>
        </div>
      ))}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={text} placeholder={t("write_note")} aria-label={t("write_note")}
          data-testid="input-note" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary" data-testid="button-note-add" disabled={!text.trim() || busy}>{t("add_note")}</Button>
      </form>
    </div>
  );
}
