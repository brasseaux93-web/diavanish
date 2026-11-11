import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CircleAlert, CircleCheck, ExternalLink, FileJson } from "lucide-react";
import { Shell } from "@/components/vault";
import { apiJson, apiUrl } from "@/lib/queryClient";
import { fingerprintFor, type LedgerDocV2 } from "@shared/ledger";
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
      const hex = await fingerprintFor(res.ledgerVersion ?? 1, { rows: res.rows, document: res.document });
      setResult(hex === res.room.fingerprint ? "match" : "mismatch");
    } catch (e: any) {
      setError(e.message || "Not found");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const c = params?.code;
    if (c) { setCode(c); verify(c); }
  }, [params?.code]);

  return (
    <Shell>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="font-serif text-3xl text-white">Verify sealed record</h1>
          <p className="mt-1 text-sm text-zinc-400 font-mono">Recompute fingerprint locally</p>
        </div>

        <div className="bento-panel p-6">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <Label className="text-xs uppercase tracking-wider text-zinc-400">Room code</Label>
            <div className="flex gap-2">
              <Input className="font-mono tracking-wider flex-1" value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="submit" disabled={busy || !code} className="bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40">
                {busy ? "Verifying…" : "Verify"}
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>

          {ledger && (
            <div className="mt-8 pt-6 border-t border-white/[0.06] space-y-6">
              {result && (
                <div className={`flex items-start gap-3 p-4 border ${
                  result === "match" ? "border-emerald-800/40 bg-emerald-950/20" : "border-red-800/40 bg-red-950/20"
                }`}>
                  {result === "match" ? <CircleCheck className="h-5 w-5 text-emerald-400 shrink-0" /> : <CircleAlert className="h-5 w-5 text-red-400 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-white">{result === "match" ? "Fingerprint matches" : "Fingerprint mismatch"}</p>
                    <p className="text-xs text-zinc-400 mt-1">Computed locally against the sealed document.</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <h2 className="font-serif text-lg text-white truncate">{ledger.room.title}</h2>
                    <p className="text-xs font-mono text-zinc-500 mt-0.5">{ledger.room.code} · Sealed {new Date(ledger.room.sealedAt).toLocaleDateString(lang)}</p>
                  </div>
                  <a href={apiUrl(`/api/public/ledger/${ledger.room.code}/artifact.json`)} download className="text-xs border border-white/[0.12] px-2 py-1 hover:border-white/20 shrink-0">
                    Receipt
                  </a>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Fingerprint</p>
                  <p className="font-mono text-xs break-all text-zinc-300 bg-black border border-white/[0.06] p-2">{ledger.room.fingerprint}</p>
                </div>
              </div>

              {ledger.rows.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Approved outcomes</h3>
                  <ul className="space-y-3">
                    {ledger.rows.slice(0, 6).map((r) => (
                      <li key={r.id} className="border-t border-white/[0.06] pt-3">
                        <p className="text-xs text-zinc-500 font-mono">{r.author} · {r.kind}</p>
                        <p className="text-sm text-zinc-300 mt-1 line-clamp-3">{r.text}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
