import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Passkey = {
  id: number;
  nickname: string | null;
  createdAt: number;
  lastUsedAt: number | null;
};

export function PasskeyManager() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const keys = useQuery<Passkey[]>({ queryKey: ["/api/auth/passkeys"] });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await apiJson<any>("POST", "/api/auth/passkey/register/options");
      const response = await startRegistration({ optionsJSON: options });
      await apiJson("POST", "/api/auth/passkey/register/verify", { response });
      await qc.invalidateQueries({ queryKey: ["/api/auth/passkeys"] });
      toast({ title: t("passkey_added") });
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await apiJson("DELETE", `/api/auth/passkeys/${id}`);
      await qc.invalidateQueries({ queryKey: ["/api/auth/passkeys"] });
      toast({ title: t("passkey_removed") });
    } catch (e: any) {
      toast({ title: e.message || t("error_generic"), variant: "destructive" });
    }
  };

  const rows = keys.data ?? [];
  return (
    <div className="space-y-4" data-testid="passkey-manager">
      <div>
        <h2 className="section-title">{t("passkeys_title")}</h2>
        <p className="text-sm text-muted-foreground mt-1 text-pretty">{t("passkeys_lede")}</p>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("passkey_empty")}</p>}
      <ul className={rows.length ? "divide-line border-y border-border" : "hidden"}>
        {rows.map((k) => (
          <li key={k.id} data-testid={`passkey-${k.id}`} className="py-3 flex items-center gap-3">
            <Fingerprint className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{k.nickname || t("passkey_unnamed")}</p>
              <p className="text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleDateString()}</p>
            </div>
            <Button data-testid={`button-passkey-remove-${k.id}`} size="sm" variant="ghost" className="max-sm:min-w-11" onClick={() => remove(k.id)} aria-label={t("passkey_remove")}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button data-testid="button-passkey-add" onClick={add} disabled={busy} variant="secondary" size="sm">
        <Plus className="h-4 w-4" aria-hidden />
        {busy ? t("passkey_starting") : t("passkey_add")}
      </Button>
    </div>
  );
}
