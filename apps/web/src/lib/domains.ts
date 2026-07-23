import type { CardColor, Domain } from "@riftbound/shared";

interface DomainStyle {
  label: string;
  /** CSS color usable in inline styles / gradients. */
  color: string;
  soft: string;
}

/** Visual identity for each Riftbound domain (mirrors the CSS vars in index.css). */
export const DOMAIN_STYLES: Record<Domain, DomainStyle> = {
  fury: { label: "Fury", color: "hsl(0 72% 58%)", soft: "hsl(0 72% 58% / 0.16)" },
  calm: { label: "Calm", color: "hsl(152 55% 50%)", soft: "hsl(152 55% 50% / 0.16)" },
  mind: { label: "Mind", color: "hsl(214 80% 60%)", soft: "hsl(214 80% 60% / 0.16)" },
  body: { label: "Body", color: "hsl(38 85% 55%)", soft: "hsl(38 85% 55% / 0.16)" },
  chaos: { label: "Chaos", color: "hsl(275 65% 62%)", soft: "hsl(275 65% 62% / 0.16)" },
  order: { label: "Order", color: "hsl(220 15% 82%)", soft: "hsl(220 15% 82% / 0.16)" },
};

const COLORLESS = "hsl(220 10% 60%)";

export function colorHex(color: CardColor | undefined): string {
  if (!color || color === "colorless") return COLORLESS;
  return DOMAIN_STYLES[color].color;
}

export function colorLabel(color: CardColor): string {
  return color === "colorless" ? "Colorless" : DOMAIN_STYLES[color].label;
}
