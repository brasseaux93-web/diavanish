import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ChevronRight, CircleAlert, CircleCheck, ExternalLink, FileJson } from "lucide-react";
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
    <div className="rounded-lg bg-[#090a0c] border border-neutral-800/80 p-2.5">
      <dt className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">{label}</dt>
      <dd className="font-mono text-xs break-all text-neutral-200 mt-1 select-all">{value}</dd>
    </div>
  ) : null;

  return (
    <Shell>
      <div className="relative max-w-3xl mx-auto pt-2 sm:pt-6">
        <div aria-hidden="true" className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 -z-10 h-72 w-96 rounded-full bg-emerald-500/5 blur-[90px]" />
        
        {/* Verification Card */}
        <div className="rounded-2xl border border-neutral-800/80 bg-[#0e1014] p-6 sm:p-8 shadow-2xl [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]">
          <PageHead title={t("verify_title")} note={t("verify_note")} />

          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && code) verify(); }}>
            <Label htmlFor="vcode" className="text-xs font-medium text-neutral-300">{t("room_code")}</Label>
            <div className="flex flex-wrap gap-2.5">
              <Input
                id="vcode"
                data-testid="input-verify-code"
                className="font-mono flex-1 min-w-[12rem] bg-[#12141a] border-neutral-800 text-white tracking-wider text-base"
                autoComplete="off"
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-describedby={error ? "verify-error" : undefined}
                aria-invalid={!!error}
              />
              <button
                type="submit"
                data-testid="button-verify"
                disabled={busy || !code}
                className="bg-white text-black hover:bg-neutral-200 font-medium px-5 py-2.5 rounded-lg text-sm transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {t("verify_button")}
              </button>
            </div>
            {error && <p id="verify-error" role="alert" data-testid="text-verify-error" className="text-sm text-red-400 pt-1">{error}</p>}
          </form>

          {ledger && (
            <div className="mt-8 pt-8 border-t border-neutral-800/80 space-y-6">
              {/* Verification Answer Result */}
              {result && (
                <div
                  role={result === "match" ? "status" : "alert"}
                  className={`flex items-start gap-3.5 rounded-xl p-4.5 border ${
                    result === "match"
                      ? "bg-emerald-950/30 border-emerald-800/60 text-emerald-300 [box-shadow:inset_0_1px_0_0_rgba(16,185,129,0.15)]"
                      : "bg-red-950/30 border-red-800/60 text-red-300 [box-shadow:inset_0_1px_0_0_rgba(239,68,68,0.15)]"
                  }`}
                >
                  {result === "match" ? (
                    <CircleCheck className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" aria-hidden />
                  ) : (
                    <CircleAlert className="h-5 w-5 shrink-0 text-red-400 mt-0.5" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p data-testid="text-verify-result" className={`font-semibold text-sm ${result === "match" ? "text-white" : "text-red-300"}`}>
                      {t(result)}
                    </p>
                    <p className="text-xs text-neutral-300 leading-relaxed text-pretty mt-1">{t(`${result}_note`)}</p>
                  </div>
                </div>
              )}

              {/* Room Details & Cryptographic Fingerprint */}
              <div className="rounded-xl border border-neutral-800/80 bg-[#12141a] p-5 space-y-4 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-3 border-b border-neutral-800/80">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-base text-white tracking-tight text-pretty">{ledger.room.title}</h2>
                    <p className="text-xs text-neutral-400 mt-1">
                      <span className="font-mono text-neutral-300">{ledger.room.code}</span>
                      <span aria-hidden> · </span>
                      {t("sealed_at")} {new Date(ledger.room.sealedAt).toLocaleString(lang)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={apiUrl(`/api/public/ledger/${ledger.room.code}/artifact.json`)}
                      download={`diavanish-receipt-${ledger.room.code}.json`}
                      data-testid="button-verify-receipt"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-xs font-medium text-neutral-200 transition-colors shadow-sm"
                    >
                      <FileJson className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
                      Receipt (.json)
                    </a>
                    {ledger.document && (
                      <button
                        type="button"
                        data-testid="button-verify-brief"
                        onClick={() => window.open(apiUrl(`/api/public/ledger/${ledger.room.code}/brief.html?lang=${lang}`), "_blank")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-xs font-medium text-neutral-200 transition-colors shadow-sm"
                      >
                        {t("brief_open")}<ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>

                <dl className="space-y-3" data-testid="card-fingerprint">
                  <div>
                    <dt className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">{t("fingerprint")}</dt>
                    <dd className="font-mono text-xs break-all text-amber-400 mt-1 select-all bg-[#090a0c] border border-neutral-800/80 rounded-lg p-2.5">
                      {ledger.room.fingerprint}
                    </dd>
                  </div>
                </dl>

                {ledger.room.destructionCert && (
                  <details className="disclose border-t border-neutral-800/80 pt-3" data-testid="card-non-retention">
                    <summary className="py-2 text-xs font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5">
                      <ChevronRight className="chev h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("non_retention_title")}
                    </summary>
                    <div className="pt-3 pb-2 space-y-3">
                      <p className="text-xs text-neutral-300 text-pretty">{t("non_retention_note")}</p>
                      <ul className="space-y-1 text-xs list-disc ps-5 text-neutral-400">
                        <li className="text-pretty">{t("nr_point_memory")}</li>
                        <li className="text-pretty">{t("nr_point_media")}</li>
                        <li className="text-pretty">{t("nr_point_persist")}</li>
                      </ul>
                      <dl className="space-y-2 pt-1">
                        {hashRow(t("destruction_cert"), ledger.room.destructionCert)}
                        {hashRow(t("chain_head"), ledger.room.chainHead)}
                      </dl>
                      <p className="text-[11px] text-neutral-500 text-pretty pt-1">{t("destruction_cert_note")}</p>
                    </div>
                  </details>
                )}
              </div>

              {ledger.document ? (
                <SealedRecord doc={ledger.document} />
              ) : (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-white tracking-tight">{t("ledger_entries")}</h2>
                  {ledger.rows.length === 0 ? (
                    <p className="text-xs text-neutral-400">{t("no_items")}</p>
                  ) : (
                    <ul className="divide-y divide-neutral-800/80 border-y border-neutral-800/80 rounded-xl bg-[#12141a] px-4" data-testid="list-verify-ledger">
                      {ledger.rows.map((r) => (
                        <li key={r.id} className="py-3.5">
                          <p className="text-xs text-neutral-400">
                            {kindLabel(t, r.kind)}<span aria-hidden> · </span>{r.author}{r.agenda && <><span aria-hidden> · </span>{r.agenda}</>}
                          </p>
                          <p className="mt-1 text-sm text-neutral-200 leading-relaxed text-pretty whitespace-pre-wrap">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
