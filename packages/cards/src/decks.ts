/**
 * Projects catalog cards into engine CardDefs and assembles DeckDefinitions.
 */
import type { CardColor } from "@riftbound/shared";
import type { CardDef, DeckDefinition } from "@riftbound/engine";
import type { CatalogCard } from "./catalog.js";

export type { DeckDefinition } from "@riftbound/engine";

/**
 * Units/gear normally enter exhausted; a handful enter ready unconditionally per their text
 * (e.g. "I enter ready."). Deliberately narrow: [Accelerate] cards (an OPTIONAL paid alternate
 * cost — see `accelerateCost` below, now modeled separately) or a condition on game state ("If an
 * opponent controls a battlefield, I enter ready.") or an effect on OTHER units (e.g. Sun Disc's
 * activated ability, or Confront's spell effect) don't make the card itself unconditionally
 * ready, and scripting the game-state-conditional ones is future work (see the stack/priority
 * system). Until then the conservative default (enters exhausted) is correct for all of them;
 * only the plain, unconditional "I enter ready." sentence is honored here.
 */
function entersReady(c: CatalogCard): boolean {
  return /(^|[.)])\s*(I|This) enters? ready\b/i.test(c.text);
}

/**
 * [Accelerate]'s alternate cost: "You may pay ⟨energy⟩⟨rune of one color⟩ as an additional cost
 * to have me enter ready." Matches all 10 occurrences in the Set 1 corpus.
 */
function accelerateCost(c: CatalogCard): { energy: number; rune: CardColor } | null {
  const m = /\[Accelerate\]\s*\(You may pay :rb_energy_(\d+)::rb_rune_(\w+):/i.exec(c.text);
  if (!m) return null;
  return { energy: Number(m[1]), rune: m[2]!.toLowerCase() as CardColor };
}

/**
 * The run of `[Keyword]` / `[Keyword N]` (optionally followed by a `(reminder)`) tokens at the
 * VERY START of a card's text. A keyword only counts as an unconditional, always-on property of
 * the card if its token appears in this leading run — many cards grant keywords only
 * conditionally ("If you've discarded a card this turn, I have [Assault] and [Ganking].", "While
 * I'm [Mighty], I have ... [Ganking] ...") and those must NOT be treated as always active.
 * Verified against every Ganking/Assault/Shield/Tank occurrence in the Set 1 corpus (18/11/14/12
 * cards) with zero misclassifications.
 */
const LEADING_KEYWORDS = /^(?:\[[A-Za-z][A-Za-z0-9 ]*\]\s*(?:\([^)]*\))?\s*)+/;

function leadingKeywordTokens(text: string): string[] {
  const m = LEADING_KEYWORDS.exec(text);
  if (!m) return [];
  return [...m[0].matchAll(/\[([A-Za-z][A-Za-z0-9 ]*)\]/g)].map((x) => x[1]!);
}

/** Leading keyword token matching `name` (optionally "Name N"), or null. Case-sensitive on name. */
function leadingKeyword(tokens: string[], name: string): string | null {
  return tokens.find((t) => t === name || t.startsWith(`${name} `)) ?? null;
}

/** Numeric suffix on a keyword token ("Assault 2" -> 2); bare keyword ("Assault") -> 1. */
function keywordValue(token: string | null): number {
  if (token === null) return 0;
  const m = /(\d+)$/.exec(token);
  return m ? Number(m[1]) : 1;
}

function keywordFlags(c: CatalogCard) {
  const leading = leadingKeywordTokens(c.text);
  return {
    ganking: leadingKeyword(leading, "Ganking") !== null,
    assault: keywordValue(leadingKeyword(leading, "Assault")),
    shield: keywordValue(leadingKeyword(leading, "Shield")),
    tank: leadingKeyword(leading, "Tank") !== null,
    deflect: keywordValue(leadingKeyword(leading, "Deflect")),
  };
}

/** "You may play me to an open battlefield" — an uncontested field, narrower than the base rule
 *  that lets any unit be played to a battlefield you already control. Matches exactly 3 cards. */
function playToOpenBattlefield(c: CatalogCard): boolean {
  return /you may play me to an open battlefield/i.test(c.text);
}

/** "While I'm buffed, I have an additional +N Might" (e.g. Wizened Elder) — on top of the
 *  standard +1 every buffed unit gets. Matches exactly 1 card in the Set 1 corpus. */
function extraMightWhileBuffed(c: CatalogCard): number {
  const m = /while i'm buffed, i have an additional \+(\d+) :rb_might:/i.exec(c.text);
  return m ? Number(m[1]) : 0;
}

/** "Other friendly units have +N Might here" (e.g. Darius - Executioner, Garen - Commander) —
 *  matches exactly 2 cards in the Set 1 + Proving Grounds corpus. */
function auraMightBonus(c: CatalogCard): number {
  const m = /other friendly units? have \+(\d+) :rb_might: here/i.exec(c.text);
  return m ? Number(m[1]) : 0;
}

/** "While I'm buffed, I have [Ganking]" (e.g. Bilgewater Bully) — matches exactly 1 card. */
function gankingWhileBuffed(c: CatalogCard): boolean {
  return /while i'm buffed, i have \[ganking\]/i.test(c.text);
}

/** A spell's timing keyword (rule 152.2) — [Action]/[Reaction] are always the leading token on
 *  spells that have them (same leading-keyword-run convention as Ganking/Assault/etc., verified
 *  against the corpus: every [Action]/[Reaction] spell leads with it). Neither present -> sorcery
 *  speed (the default for every other card type too, where this field is unused). */
function timing(c: CatalogCard): CardDef["timing"] {
  const leading = leadingKeywordTokens(c.text);
  if (leadingKeyword(leading, "Reaction") !== null) return "reaction";
  if (leadingKeyword(leading, "Action") !== null) return "action";
  return "sorcery";
}

export function toCardDef(c: CatalogCard): CardDef {
  const flags = keywordFlags(c);
  return {
    id: c.id as CardDef["id"],
    name: c.name,
    type: (c.type as CardDef["type"]) ?? "unit",
    colors: c.domains as CardColor[],
    tags: c.tags,
    energy: c.energy ?? 0,
    power: c.power ?? 0,
    might: c.might ?? 0,
    text: c.text,
    entersReady: entersReady(c),
    ganking: flags.ganking,
    assault: flags.assault,
    shield: flags.shield,
    tank: flags.tank,
    deflect: flags.deflect,
    extraMightWhileBuffed: extraMightWhileBuffed(c),
    auraMightBonus: auraMightBonus(c),
    gankingWhileBuffed: gankingWhileBuffed(c),
    playToOpenBattlefield: playToOpenBattlefield(c),
    accelerateCost: accelerateCost(c),
    timing: timing(c),
    image: c.image,
  };
}

export function buildDeck(
  legend: CatalogCard,
  main: CatalogCard[],
  runes: CatalogCard[],
  championZone?: CatalogCard,
): DeckDefinition {
  return {
    legend: toCardDef(legend),
    main: main.map(toCardDef),
    runes: runes.map(toCardDef),
    championZone: championZone ? toCardDef(championZone) : null,
  };
}

/** A champion card is Chosen-Champion-legal only if it shares a character tag with the legend. */
export function chosenChampionEligible(card: CatalogCard, legend: CatalogCard): boolean {
  return card.supertype === "champion" && card.tags.some((t) => legend.tags.includes(t));
}

/** A Signature card must share a character tag with the legend (narrower than domain-only). */
export function signatureEligible(card: CatalogCard, legend: CatalogCard): boolean {
  return card.supertype === "signature" && card.tags.some((t) => legend.tags.includes(t));
}
