import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Shell, PageHead, useStartDemo } from "@/components/vault";
import { apiJson, setSessionToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

type InviteInfo = {
  roomTitle: string;
  anonymityMode: "anonymous" | "open";
  requiresRoleProof: boolean;
  turnMinutes: number;
  boundRole: string | null;
  roleAttested: boolean;
};

export default function Join({ params }: { params?: { mode?: string } }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [code, setCode] = useState("");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [nameChoice, setNameChoice] = useState<"pseudonym" | "real">("pseudonym");
  const [name, setName] = useState("");
  const [realName, setRealName] = useState("");
  const [claimedRole, setClaimedRole] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<{ recoveryKey: string } | null>(null);
  const [recoverMode, setRecoverMode] = useState(params?.mode === "recover");
  useEffect(() => { setRecoverMode(params?.mode === "recover"); }, [params?.mode]);
  const demo = useStartDemo();
  const [recover, setRecover] = useState({ roomCode: "", pseudonym: "", recoveryKey: "" });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [recoverMode, info]);

  const copyKey = async () => {
    if (!joined) return;
    try {
      await navigator.clipboard.writeText(joined.recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const lookup = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<InviteInfo>("GET", `/api/public/invite-lookup/${encodeURIComponent(code.trim())}`);
      setInfo(res);
      if (res.boundRole) setClaimedRole(res.boundRole);
    } catch (e: any) {
      setError(e.message || "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ token: string; recoveryKey: string }>("POST", "/api/join", {
        inviteToken: code.trim(),
        nameChoice: info?.anonymityMode === "open" ? nameChoice : "pseudonym",
        name: name || null,
        realName: nameChoice === "pseudonym" ? realName || null : null,
        claimedRole,
        adult,
      });
      setSessionToken(res.token, res.recoveryKey);
      setJoined({ recoveryKey: res.recoveryKey });
    } catch (e: any) {
      setError(e.message || "Could not join");
    } finally {
      setBusy(false);
    }
  };

  const recoverSeat = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ token: string }>("POST", "/api/recover", recover);
      setSessionToken(res.token);
      navigate("/p");
    } catch (e: any) {
      setError(e.message || "Recovery failed");
    } finally {
      setBusy(false);
    }
  };

  if (joined) {
    return (
      <Shell>
        <div className="max-w-md mx-auto bento-panel p-6 sm:p-8">
          <h1 className="font-serif text-2xl text-white mb-2">Recovery key</h1>
          <p className="text-sm text-zinc-400 mb-6">Store this once. It will not be shown again.</p>
          <div className="border border-white/[0.08] bg-black px-4 py-4 flex items-center gap-3">
            <code className="font-mono text-lg tracking-wider text-white break-all flex-1">{joined.recoveryKey}</code>
            <Button type="button" variant="ghost" size="sm" onClick={copyKey}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button className="w-full mt-6" onClick={() => navigate("/p")}>Enter room</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="max-w-md mx-auto bento-panel p-6 sm:p-8">
        {recoverMode ? (
          <>
            <h1 className="font-serif text-2xl text-white mb-1">Recover seat</h1>
            <p className="text-sm text-zinc-400 mb-6">Use room code, pseudonym, and recovery key.</p>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); recoverSeat(); }}>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Room code</Label>
                <Input className="font-mono" value={recover.roomCode} onChange={(e) => setRecover({ ...recover, roomCode: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Pseudonym</Label>
                <Input value={recover.pseudonym} onChange={(e) => setRecover({ ...recover, pseudonym: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Recovery key</Label>
                <Input className="font-mono" value={recover.recoveryKey} onChange={(e) => setRecover({ ...recover, recoveryKey: e.target.value })} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !recover.roomCode || !recover.pseudonym || !recover.recoveryKey}>
                {busy ? "Recovering…" : "Recover"}
              </Button>
            </form>
            <button className="text-xs text-zinc-500 hover:text-zinc-300 mt-6 inline-flex items-center gap-1" onClick={() => setRecoverMode(false)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back to join
            </button>
          </>
        ) : !info ? (
          <>
            <h1 className="font-serif text-2xl text-white mb-1">Join room</h1>
            <p className="text-sm text-zinc-400 mb-6">Enter the invite code from your facilitator.</p>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Invite code</Label>
                <Input className="font-mono tracking-wider" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !code}>
                {busy ? "Looking up…" : "Continue"}
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t border-white/[0.06] space-y-2">
              <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setRecoverMode(true)}>Recover existing seat</button>
              {demo.available && (
                <button className="text-xs text-zinc-500 hover:text-zinc-300 block" onClick={() => demo.start("participant")} disabled={!!demo.busy}>
                  {demo.busy ? "Starting…" : "Try demo"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl text-white mb-1 truncate">{info.roomTitle}</h1>
            <p className="text-sm text-zinc-400 mb-6">Confirm identity and role to enter.</p>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); join(); }}>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-zinc-400">Role</Label>
                <Input value={claimedRole} onChange={(e) => setClaimedRole(e.target.value)} readOnly={!!info.boundRole} />
              </div>
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <Checkbox checked={adult} onCheckedChange={(v) => setAdult(v === true)} className="mt-0.5" />
                I confirm I am an adult
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !name || !claimedRole || !adult}>
                {busy ? "Joining…" : "Join room"}
              </Button>
            </form>
            <button className="text-xs text-zinc-500 hover:text-zinc-300 mt-6 inline-flex items-center gap-1" onClick={() => { setInfo(null); setName(""); setClaimedRole(""); }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Change code
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}
