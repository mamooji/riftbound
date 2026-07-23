/**
 * The Set 1 (Origins) card catalog — the committed snapshot loaded as typed data.
 *
 * This is the single source of truth for card data across the app (deck builder, engine defs,
 * card display). No network at runtime. Card art stays as Riot-hosted URLs (never bundled).
 */
import type { CardColor, CardType } from "@riftbound/shared";
import origins from "../data/origins.json" with { type: "json" };
import provingGrounds from "../data/provinggrounds.json" with { type: "json" };

export interface CatalogCard {
  id: string;
  name: string;
  number: number;
  type: string;
  supertype: string | null;
  domains: string[];
  rarity: string;
  energy: number | null;
  power: number | null;
  might: number | null;
  text: string;
  flavour: string;
  image: string | null;
  artist: string | null;
  tags: string[];
  alternateArt: boolean;
  signature: boolean;
}

interface OriginsFile {
  set: string;
  count: number;
  byType: Record<string, number>;
  cards: CatalogCard[];
}

const data = origins as OriginsFile;
const ogsData = provingGrounds as OriginsFile;

/**
 * Every card print across Set 1: Origins (OGN, 298 unique cards) plus Origins: Proving Grounds
 * (OGS, 24 cards) — a starter-deck-only companion set published the same day as Origins. Includes
 * alternate arts + tokens.
 */
export const ALL_CARDS: CatalogCard[] = [...data.cards, ...ogsData.cards];

/**
 * Primary prints only: drops parallel/special prints (keeps one entry per unique card).
 * "Showcase" is Riftbound's rarity tier for EVERY parallel print — alternate art, "(Signature)"
 * foil legend/champion prints, and "(Overnumbered)" prints all carry `rarity: "showcase"` (not
 * just the ones with `alternateArt: true` — that flag alone misses the Signature/Overnumbered
 * legend variants, which would otherwise show up as extra duplicate legend/champion options).
 * Verified: excluding showcase rarity yields exactly 298 unique Origins cards (every `riftbound_id`
 * ends in "-298") plus all 24 Proving Grounds cards (none of which have showcase prints).
 */
export const CARDS: CatalogCard[] = ALL_CARDS.filter((c) => c.rarity !== "showcase");

export const CARDS_BY_ID: Record<string, CatalogCard> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.id, c]),
);

export function cardsByType(type: CardType): CatalogCard[] {
  return CARDS.filter((c) => c.type === type);
}

export function cardColor(c: CatalogCard): CardColor {
  return (c.domains[0] as CardColor) ?? "colorless";
}

/** Deck-building color identity (the six domains a card belongs to; drops colorless). */
export function cardDomains(c: CatalogCard): CardColor[] {
  return c.domains as CardColor[];
}

/**
 * Renders Riftcodex rich-text tokens (":rb_exhaust:", ":rb_energy_1:", "[Keyword]") into a
 * readable string with unicode glyphs. Good enough for card text display; not a full parser.
 */
const TOKEN_GLYPHS: Record<string, string> = {
  rb_exhaust: "↷",
  rb_ready: "↺",
  rb_might: "⚔",
  rb_power: "◆",
  rb_energy: "⚡",
  rb_rune_fury: "🔴",
  rb_rune_calm: "🟢",
  rb_rune_mind: "🔵",
  rb_rune_body: "🟠",
  rb_rune_chaos: "🟣",
  rb_rune_order: "⚪",
  rb_rune_rainbow: "🌈",
  rb_rune: "🪙",
};

export function renderCardText(text: string): string {
  return text.replace(/:([a-z0-9_]+):/gi, (_m, token: string) => {
    const key = token.toLowerCase();
    if (key in TOKEN_GLYPHS) return TOKEN_GLYPHS[key]!;
    const energy = /^rb_energy_(\d+)$/.exec(key);
    if (energy) return `⚡${energy[1]}`;
    const might = /^rb_might_(\d+)$/.exec(key);
    if (might) return `${might[1]}⚔`;
    return token.replace(/^rb_/, "").replace(/_/g, " ");
  });
}

/** Origins (OGN) set metadata only; Proving Grounds isn't counted here since nothing reads this beyond display. */
export const SET_META = { set: data.set, count: data.count, byType: data.byType };
