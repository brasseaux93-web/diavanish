import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ChevronRight, CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import { Shell, PageHead } from "@/components/vault";
import { apiJson, apiUrl } from "@/lib/queryClient";
import { fingerprintFor, type LedgerDocV2 } from "@shared/ledger";
import { SealedRecord, kindLabel } from "@/components/ledger/record";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SealedLedger = {
  room: {
    code: string; title: string; sealedAt: number; fingerprint: string;
    destructionCert: string | null; chainHead: string | null;
  };
  rows: { id: number; kind: string; text: string; author: string; agenda: string | null; approvedAt: number }[];
  ledgerVersion?: 1 | 2;
  document?: LedgerDocV2;
};

export default function Verify({ params }: { params?: { code?: string } }) {
  const { t, lang } = useI18n();
  const [code, setCode] = useState("");
  const [ledger, setLedger] = useState<SealedLedger | null>(null);
  const [result, setResult] = useState<"match" | "mismatch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async (override?: string) => {
    const target = (override ?? code).trim().toUpperCase();
    if (!target) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLedger(null);
    try {
      const res = await apiJson<SealedLedger>("GET", `/api/public/ledger/${target}`);
      setLedger(res);
      // Recompute the fingerprint in this browser, by ledger version:
      // v1 hashes the approved rows; v2 hashes the canonical sealed document.
      const hex = await fingerprintFor(res.ledgerVersion ?? 1, { rows: res.rows, document: res.document });
      setResult(hex === res.room.fingerprint ? "match" : "mismatch");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Deep link: #/verify/XXXXXX recomputes on arrival (used by the verifier demo)
  useEffect(() => {
    const c = params?.code;
    if (c) { setCode(c); verify(c); }
  }, [params?.code]);

  const hashRow = (label: string, value: string | null) => value ? (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mono-data text-xs break-all text-foreground/80 mt-0.5 select-all">{value}</dd>
    </div>
  ) : null;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto">
        <PageHead title={t("verify_title")} note={t("verify_note")} />

        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!busy && code) verify(); }}>
          <Label htmlFor="vcode">{t("room_code")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="vcode" data-testid="input-verify-code" className="mono-data flex-1 min-w-[10rem] max-w-xs" autoComplete="off" autoCapitalize="characters"
              value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={error ? "verify-error" : undefined} aria-invalid={!!error} />
            <Button type="submit" data-testid="button-verify" disabled={busy || !code}>
              {t("verify_button")}
            </Button>
          </div>
          {error && <p id="verify-error" role="alert" data-testid="text-verify-error" className="text-sm text-destructive pt-1">{error}</p>}
        </form>

        {ledger && (
          <div className="mt-10 space-y-8">
            {/* The answer first. Everything below it is the evidence. */}
            {result && (
              <div
                role={result === "match" ? "status" : "alert"}
                className={`flex gap-3 rounded-md p-4 ${result === "match" ? "bg-primary/10" : "bg-destructive/10"}`}
              >
                {result === "match"
                  ? <CircleCheck className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden />
                  : <CircleAlert className="h-5 w-5 shrink-0 text-destructive mt-0.5" aria-hidden />}
                <div className="min-w-0">
                  <p data-testid="text-verify-result" className={`font-medium ${result === "match" ? "text-foreground" : "text-destructive"}`}>
                    {t(result)}
                  </p>
                  <p className="text-sm text-muted-foreground text-pretty mt-0.5">{t(`${result}_note`)}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <h2 className="font-display font-semibold text-lg tracking-[-0.01em] text-pretty">{ledger.room.title}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <span className="mono-data">{ledger.room.code}</span>
                    <span aria-hidden> · </span>
                    {t("sealed_at")} {new Date(ledger.room.sealedAt).toLocaleString(lang)}
                  </p>
                </div>
                {ledger.document && (
                  <Button size="sm" variant="secondary" data-testid="button-verify-brief"
                    onClick={() => window.open(apiUrl(`/api/public/ledger/${ledger.room.code}/brief.html?lang=${lang}`), "_blank")}>
                    {t("brief_open")}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </div>

              <dl className="space-y-3" data-testid="card-fingerprint">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("fingerprint")}</dt>
                  <dd className="mono-data text-xs break-all text-[hsl(var(--seal))] mt-0.5 select-all">{ledger.room.fingerprint}</dd>
                </div>
              </dl>

              {ledger.room.destructionCert && (
                <details className="disclose border-y border-border" data-testid="card-non-retention">
                  <summary className="py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronRight className="chev h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t("non_retention_title")}
                  </summary>
                  <div className="pb-4 space-y-4">
                    <p className="text-sm text-muted-foreground text-pretty">{t("non_retention_note")}</p>
                    <ul className="space-y-1.5 text-sm list-disc ps-5 marker:text-muted-foreground/60">
                      <li className="text-pretty">{t("nr_point_memory")}</li>
                      <li className="text-pretty">{t("nr_point_media")}</li>
                      <li className="text-pretty">{t("nr_point_persist")}</li>
                    </ul>
                    <dl className="space-y-3">
                      {hashRow(t("destruction_cert"), ledger.room.destructionCert)}
                      {hashRow(t("chain_head"), ledger.room.chainHead)}
                    </dl>
                    <p className="text-xs text-muted-foreground text-pretty">{t("destruction_cert_note")}</p>
                  </div>
                </details>
              )}
            </div>

            {ledger.document ? (
              <SealedRecord doc={ledger.document} />
            ) : (
              <section>
                <h2 className="section-title mb-2">{t("ledger_entries")}</h2>
                {ledger.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("no_items")}</p>
                ) : (
                  <ul className="divide-line border-y border-border" data-testid="list-verify-ledger">
                    {ledger.rows.map((r) => (
                      <li key={r.id} className="py-3.5">
                        <p className="text-xs text-muted-foreground">
                          {kindLabel(t, r.kind)}<span aria-hidden> · </span>{r.author}{r.agenda && <><span aria-hidden> · </span>{r.agenda}</>}
                        </p>
                        <p className="mt-1 text-[0.9375rem] leading-relaxed text-pretty whitespace-pre-wrap">{r.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
