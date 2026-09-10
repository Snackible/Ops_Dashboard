import { TIER_CONFIG, TIER_ORDER } from "./TierBadge";
import type { Tier } from "../lib/types";

/** Inline click-to-set tier control — same visual language as the tier filter pills. */
export function TierPicker({ value, onChange }: { value: Tier; onChange: (tier: Tier) => void }) {
  return (
    <div className="flex items-center gap-1">
      {TIER_ORDER.map((tier) => (
        <button
          key={tier}
          type="button"
          onClick={() => tier !== value && onChange(tier)}
          title={TIER_CONFIG[tier].label}
          aria-label={`Set tier to ${TIER_CONFIG[tier].label}`}
          aria-pressed={tier === value}
          className={`h-4 w-4 rounded-full transition-transform ${TIER_CONFIG[tier].solid} ${
            tier === value ? "scale-125 ring-2 ring-ink-faint ring-offset-1 ring-offset-paper-raised" : "opacity-40 hover:opacity-80"
          }`}
        />
      ))}
    </div>
  );
}
