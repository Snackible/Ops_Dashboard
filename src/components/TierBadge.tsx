import type { Tier } from "../lib/types";

export const TIER_ORDER: Tier[] = ["green", "yellow", "orange", "red"];

export const TIER_CONFIG: Record<Tier, { label: string; solid: string; text: string; soft: string; border: string; borderSolid: string }> = {
  green: { label: "Green", solid: "bg-success", text: "text-success", soft: "bg-success-soft", border: "border-success", borderSolid: "border-l-success" },
  yellow: { label: "Yellow", solid: "bg-warning", text: "text-warning", soft: "bg-warning-soft", border: "border-warning", borderSolid: "border-l-warning" },
  orange: { label: "Orange", solid: "bg-tier-orange", text: "text-tier-orange", soft: "bg-tier-orange-soft", border: "border-tier-orange", borderSolid: "border-l-tier-orange" },
  red: { label: "Red", solid: "bg-danger", text: "text-danger", soft: "bg-danger-soft", border: "border-danger", borderSolid: "border-l-danger" },
};

/** A plain, vivid color swatch — no label. The color alone is the signal. */
export function TierBadge({ tier, size = "sm" }: { tier: Tier; size?: "sm" | "md" }) {
  const c = TIER_CONFIG[tier];
  const dim = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <span
      title={c.label}
      aria-label={`Tier: ${c.label}`}
      className={`inline-block shrink-0 rounded-full ring-2 ring-paper-raised ${dim} ${c.solid}`}
    />
  );
}
