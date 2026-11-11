/*
 * Room tier and sealing threshold, chosen at creation. Three cards, not a form:
 * the tier sets the seat range and turn length; seats and turn can be tuned
 * inside the tier's range, and the full-round time is shown as seats × turn.
 */
import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TIERS, TIER_SPECS, THRESHOLDS, cycleSeconds, formatMinutes, clamp, type Tier, type Threshold } from "@shared/tiers";

export type TierValue = { tier: Tier; seatCap: number; turnSeconds: number };

export function TierPicker({ value, onChange }: { value: TierValue; onChange: (v: TierValue) => void }) {
  const { t } = useI18n();
  const spec = TIER_SPECS[value.tier];
  const turns: number[] = [];
  for (let s = spec.turn.min; s <= spec.turn.max; s += spec.turn.step) turns.push(s);
  const total = cycleSeconds(value.seatCap, value.turnSeconds);
  const crowded = spec.softCeiling != null && value.seatCap > spec.softCeiling;

  return (
    <div className="space-y-4" data-testid="tier-picker">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={t("tier_title")}>
        {TIERS.map((id) => {
          const s = TIER_SPECS[id];
          const on = value.tier === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} data-testid={`button-tier-${id}`}
              onClick={() => onChange({ tier: id, seatCap: s.seats.default, turnSeconds: s.turn.default })}
              className={`group relative flex flex-col items-start justify-start text-start rounded-md border px-3.5 py-3 transition-colors ${
                on ? "border-[hsl(var(--foreground)/0.32)] bg-[var(--slate-control)]"
                   : "border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full shrink-0 ${on ? "bg-foreground" : "border border-[var(--line-strong)]"}`} aria-hidden />
                <span className="text-sm font-medium">{t(`tier_${id}`)}</span>
              </span>
              <span className="mt-2 flex items-baseline gap-2 sm:block">
                <span className="block mono-data text-xs text-foreground/80">
                  {id === "plenary" ? t("tier_upto", { max: s.seats.max }) : t("tier_range", { min: s.seats.min, max: s.seats.max })}
                </span>
                <span className="block sm:mt-1 text-xs text-muted-foreground">{t(`tier_${id}_sub`)}</span>
              </span>
              <span className="hidden sm:block mt-2 text-xs leading-snug text-muted-foreground text-pretty">{t(`tier_${id}_line`)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("tier_seats")}</p>
          <div className="inline-flex items-center rounded-md border border-[var(--line-strong)]">
            <button type="button" aria-label={t("seats_fewer")} data-testid="button-seats-minus" disabled={value.seatCap <= spec.seats.min}
              onClick={() => onChange({ ...value, seatCap: clamp(value.seatCap - 1, spec.seats.min, spec.seats.max) })}
              className="h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center mono-data text-sm tabular-nums" data-testid="text-seat-cap">{value.seatCap}</span>
            <button type="button" aria-label={t("seats_more")} data-testid="button-seats-plus" disabled={value.seatCap >= spec.seats.max}
              onClick={() => onChange({ ...value, seatCap: clamp(value.seatCap + 1, spec.seats.min, spec.seats.max) })}
              className="h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="space-y-1.5 min-w-0 max-w-full">
          <p className="text-xs text-muted-foreground">{t("tier_turn")}</p>
          <div className="segmented segmented-box" role="radiogroup" aria-label={t("tier_turn")}>
            {turns.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={value.turnSeconds === s}
                onClick={() => onChange({ ...value, turnSeconds: s })}>
                {formatMinutes(s)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3">
        <p className="text-xs text-muted-foreground">{t("tier_cycle")}</p>
        <p className="mono-data text-sm tabular-nums" data-testid="text-cycle">
          {t("tier_cycle_calc", { seats: value.seatCap, turn: formatMinutes(value.turnSeconds), total: formatMinutes(total) })}
        </p>
      </div>
      {crowded && (
        <p className="text-xs text-[hsl(var(--warn))] text-pretty" role="note" data-testid="text-tier-warn">
          {t("tier_warn")}
        </p>
      )}
    </div>
  );
}

export function ThresholdPicker({ value, onChange }: { value: Threshold; onChange: (v: Threshold) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" data-testid="threshold-picker">
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("th_title")}>
        {THRESHOLDS.map((th) => (
          <button key={th} type="button" role="radio" aria-checked={value === th}
            data-testid={`button-threshold-${th}`} onClick={() => onChange(th)}
            className={`min-h-10 rounded-md border px-2 py-1.5 text-[0.8125rem] leading-tight font-medium transition-colors ${
              value === th ? "border-[hsl(var(--foreground)/0.32)] bg-[var(--slate-control)] text-foreground"
                : "border-[var(--line)] text-muted-foreground hover:text-foreground hover:border-[var(--line-strong)]"
            }`}>
            {t(`th_${th}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground text-pretty">{t(`th_${value}_line`)} {t("th_note")}</p>
    </div>
  );
}
