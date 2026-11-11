import { useState, useEffect } from "react";
import { Sparkles, Key, Check, AlertCircle, ArrowRight, ShieldCheck, RefreshCw, Cpu, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { apiJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface NeutralityVariants {
  objective: string;
  interests: string;
  action: string;
  rationale: string;
  model: string;
  simulated?: boolean;
}

export interface NeutralityDialogProps {
  currentText: string;
  kind?: string;
  onApply: (refinedText: string) => void;
  trigger?: React.ReactNode;
}

export function NeutralityDialog({ currentText, kind, onApply, trigger }: NeutralityDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("diavanish_groq_key") || "");
  const [showConfig, setShowConfig] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestedOk, setKeyTestedOk] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const [variants, setVariants] = useState<NeutralityVariants | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<"objective" | "interests" | "action">("objective");
  const [error, setError] = useState<string | null>(null);

  // Check server configured status on mount
  useEffect(() => {
    if (open) {
      apiJson<{ configured: boolean; model: string }>("GET", "/api/neutrality/status")
        .then((res) => {
          if (!res.configured && !apiKey) {
            setShowConfig(true);
          }
        })
        .catch(() => {});
    }
  }, [open, apiKey]);

  const testKey = async () => {
    if (!apiKey.trim()) return;
    setTestingKey(true);
    setError(null);
    try {
      const res = await apiJson<{ ok: boolean; models?: string[]; error?: string }>("POST", "/api/neutrality/test-key", {
        apiKey: apiKey.trim(),
      });
      if (res.ok) {
        setKeyTestedOk(true);
        sessionStorage.setItem("diavanish_groq_key", apiKey.trim());
        toast({ title: "Groq API Key Verified", description: "In-memory connection active." });
      } else {
        setError(res.error || "Invalid Groq API key.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to reach Groq Cloud.");
    } finally {
      setTestingKey(false);
    }
  };

  const runTransform = async () => {
    if (!currentText.trim()) {
      setError("Please write a draft statement first.");
      return;
    }
    setTransforming(true);
    setError(null);
    try {
      const res = await apiJson<NeutralityVariants>("POST", "/api/neutrality/reword", {
        text: currentText,
        kind,
        apiKey: apiKey.trim() || undefined,
      });
      setVariants(res);
    } catch (err: any) {
      setError(err.message || "Failed to generate neutral variants.");
    } finally {
      setTransforming(false);
    }
  };

  const handleApply = (text: string) => {
    onApply(text);
    setOpen(false);
    toast({
      title: "Wording Applied",
      description: kind === "chat_message" ? "Refined phrasing placed in message composer." : "Neutralized phrasing placed in form.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
          >
            <Sparkles className="h-3 w-3 text-amber-400" aria-hidden="true" />
            <span>Neutralize (Groq)</span>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto bg-[#0e1014] border border-neutral-800 text-neutral-200 p-6 sm:p-7 shadow-2xl [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pb-2 border-b border-neutral-800/80">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-400">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <DialogTitle className="text-base font-semibold text-white tracking-tight">
                  Groq Neutrality Engine
                </DialogTitle>
                <DialogDescription className="text-xs text-neutral-400">
                  Harvard Negotiation reframing · In-memory & zero disk logs
                </DialogDescription>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-neutral-800 bg-[#14171d] hover:bg-neutral-800 text-[11px] font-mono text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <Key className="h-3 w-3" aria-hidden="true" />
              <span>{showConfig ? "Hide Config" : "API Key"}</span>
            </button>
          </div>
        </DialogHeader>

        {/* GROQ API KEY CONFIGURATION TEMPLATE */}
        {showConfig && (
          <div className="rounded-xl border border-neutral-800 bg-[#12141a] p-4 space-y-3.5 my-3 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono uppercase tracking-wider text-neutral-400">
                Groq API Configuration
              </span>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
              >
                <span>Get Groq Key</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                placeholder="gsk_..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyTestedOk(false);
                }}
                className="flex-1 rounded-lg border border-neutral-800 bg-[#090a0c] px-3 py-1.5 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
              />
              <button
                type="button"
                onClick={testKey}
                disabled={testingKey || !apiKey.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-40 transition-colors shrink-0"
              >
                {testingKey ? "Testing..." : keyTestedOk ? "Valid ✓" : "Test Key"}
              </button>
            </div>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Your key is held strictly in session memory and used for in-flight requests. It is never logged to disk or saved in databases.
            </p>
          </div>
        )}

        {/* INPUT STATEMENT DISPLAY */}
        <div className="space-y-1.5 pt-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            Original Statement
          </span>
          <div className="rounded-lg bg-[#12141a] border border-neutral-800/80 p-3 text-xs text-neutral-300 leading-relaxed max-h-24 overflow-y-auto">
            {currentText || <span className="italic text-neutral-600">No text provided.</span>}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-red-900/60 bg-red-950/20 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* ACTION TRIGGER BUTTON */}
        {!variants && (
          <div className="pt-2">
            <button
              type="button"
              onClick={runTransform}
              disabled={transforming || !currentText.trim()}
              className="w-full bg-white text-black hover:bg-neutral-200 font-medium py-2.5 rounded-lg text-xs transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {transforming ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Synthesizing Harvard Variants...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Generate 3 Neutral Variants</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* TRANSFORMED VARIANTS CONTAINER */}
        {variants && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                Calibrated Reframings
              </span>
              <button
                type="button"
                onClick={runTransform}
                disabled={transforming}
                className="text-[11px] font-mono text-neutral-400 hover:text-white inline-flex items-center gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${transforming ? "animate-spin" : ""}`} />
                <span>Regenerate</span>
              </button>
            </div>

            {/* 3 VARIANT TABS */}
            <div className="grid grid-cols-3 gap-2">
              {([
                ["objective", "Observable Facts"],
                ["interests", "Shared Interests"],
                ["action", "Action Step"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedVariant(k)}
                  className={`py-2 px-2.5 rounded-lg border text-xs font-medium transition-all text-center ${
                    selectedVariant === k
                      ? "border-emerald-700/80 bg-emerald-950/40 text-emerald-300 shadow-sm"
                      : "border-neutral-800 bg-[#12141a] text-neutral-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* VARIANT BODY PREVIEW */}
            <div className="rounded-xl border border-neutral-800 bg-[#12141a] p-4 space-y-3 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <p className="text-sm text-neutral-100 leading-relaxed text-pretty">
                "{variants[selectedVariant]}"
              </p>
              <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-400">
                <span className="italic">{variants.rationale}</span>
                <span className="font-mono text-[10px] text-neutral-500">
                  {variants.model}
                </span>
              </div>
            </div>

            {/* APPLY BUTTON */}
            <button
              type="button"
              onClick={() => handleApply(variants[selectedVariant])}
              className="w-full bg-white text-black hover:bg-neutral-200 font-medium py-2.5 rounded-lg text-xs transition-all shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.4)] flex items-center justify-center gap-1.5"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{kind === "chat_message" ? "Apply Refined Message" : "Apply This Wording to Ledger"}</span>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
