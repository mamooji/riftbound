/**
 * Starter decks — faithful, Set-1-only archetype builds of two of the three official Origins
 * Champion Decks (Viktor, Lee Sin), plus all four Origins: Proving Grounds starter decks (Annie,
 * Master Yi, Lux, Garen). Jinx is excluded from the Origins trio: several of her cards are on the
 * Standard ban list, so her precon isn't legal to reproduce as shipped.
 *
 * Proving Grounds (set id OGS) is a 24-card starter-only companion set published the same day as
 * Origins — still part of Set 1. Each of its 4 legends gets exactly one Signature card and 2
 * champion units (one per domain) exclusive to that set; those + its handful of support
 * spells/units are used as this deck's priority cards, same as Viktor/Lee Sin below, and its
 * Chosen Champion + Signature are the tag-matched OGS champion/signature pair.
 *
 * These are NOT guaranteed card-for-card matches to the physical retail product — the exact
 * printed decklists aren't reliably available (the community sites that list them return 403s,
 * and generic web search only surfaces later-set tournament evolutions of these decks, which
 * include cards that don't exist in Set 1 at all). Instead each deck is hand-built from REAL Set
 * 1 cards around the deck's known, confirmed archetype: Viktor is Mind/Order Recruit-token value;
 * Lee Sin is Calm/Body buff/reposition. The Chosen Champion and rune split are correct.
 */
import type { DeckDefinition } from "@riftbound/engine";
import { CARDS, type CatalogCard } from "./catalog.js";
import { buildDeck, signatureEligible } from "./decks.js";
import { isBanned } from "./banned.js";

const MAIN_SIZE = 40;
const MAX_COPIES = 3;

interface PreconSpec {
  id: StarterDeckId;
  name: string;
  legendName: string;
  championName: string;
  tagline: string;
  playstyle: string;
  /** Named synergy pieces to prioritize, each capped at MAX_COPIES. Listed by priority order. */
  priorityCards: string[];
  /** The legend's tag-matched Signature card, if this deck has one (auto-included, MAX_COPIES). */
  signatureName?: string;
  /** Rune count per legend.domains[0]/[1] (must sum to 12). */
  runeSplit: [number, number];
}

const SPECS: PreconSpec[] = [
  {
    id: "viktor",
    name: "Viktor Champion Deck",
    legendName: "Viktor - Herald of the Arcane",
    championName: "Viktor - Leader",
    tagline: "Overwhelm with Recruits.",
    playstyle: "Mind/Order value — flood the board with Recruit tokens, then scale them up.",
    priorityCards: [
      "Vanguard Captain",
      "Faithful Manufactor",
      "Noxian Drummer",
      "Forge of the Future",
      "Machine Evangel",
      "Viktor - Innovator",
    ],
    runeSplit: [6, 6], // mind, order
  },
  {
    id: "leesin",
    name: "Lee Sin Champion Deck",
    legendName: "Lee Sin - Blind Monk",
    championName: "Lee Sin - Ascetic",
    tagline: "Buff up, then break through.",
    playstyle: "Calm/Body buffs — stack +1 Might buffs onto your units and push through Shield/Tank bodies.",
    priorityCards: [
      "Pit Rookie",
      "Cithria of Cloudfield",
      "Kinkou Monk",
      "Spirit's Refuge",
      "Poro Herder",
      "Wildclaw Shaman",
      "Wizened Elder",
      "Arena Bar",
      "Sett - Brawler",
      "Lee Sin - Centered",
    ],
    runeSplit: [6, 6], // calm, body
  },
  {
    id: "annie",
    name: "Annie Starter Deck",
    legendName: "Annie - Dark Child (Starter)",
    championName: "Annie - Fiery",
    tagline: "Everything burns.",
    playstyle: "Fury/Chaos burn — Annie's bonus spell damage stacks with direct-damage spells to finish units and races alike.",
    priorityCards: ["Annie - Stubborn", "Firestorm", "Incinerate", "Flash"],
    signatureName: "Tibbers",
    runeSplit: [6, 6], // fury, chaos
  },
  {
    id: "masteryi",
    name: "Master Yi Starter Deck",
    legendName: "Master Yi - Wuju Bladesman (Starter)",
    championName: "Master Yi - Honed",
    tagline: "Strike, then strike again.",
    playstyle: "Calm/Body tempo — Ganking units hop between battlefields while solo defenders punch above their weight.",
    priorityCards: ["Master Yi - Meditative", "Zephyr Sage", "Garen - Rugged", "Gentlemen's Duel"],
    signatureName: "Highlander",
    runeSplit: [6, 6], // calm, body
  },
  {
    id: "lux",
    name: "Lux Starter Deck",
    legendName: "Lux - Lady of Luminosity (Starter)",
    championName: "Lux - Illuminated",
    tagline: "Light finds a way.",
    playstyle: "Mind/Order big spells — expensive spells draw cards and swing Might, building toward a lethal Final Spark.",
    priorityCards: ["Lux - Crownguard", "Garen - Commander", "Blast of Power", "Recruit the Vanguard", "Vanguard Attendant"],
    signatureName: "Final Spark",
    runeSplit: [6, 6], // mind, order
  },
  {
    id: "garen",
    name: "Garen Starter Deck",
    legendName: "Garen - Might of Demacia (Starter)",
    championName: "Garen - Commander",
    tagline: "Demacia stands together.",
    playstyle: "Body/Order go-wide — flood a battlefield with bodies and Recruit tokens, then conquer for the card draw.",
    priorityCards: ["Garen - Rugged", "Master Yi - Honed", "Lux - Crownguard", "Blast of Power", "Recruit the Vanguard", "Vanguard Attendant", "Gentlemen's Duel"],
    signatureName: "Decisive Strike",
    runeSplit: [6, 6], // body, order
  },
];

function buildPrecon(spec: PreconSpec): DeckDefinition {
  const legend = CARDS.find((c) => c.name === spec.legendName)!;
  const champion = CARDS.find((c) => c.name === spec.championName)!;
  const domains = legend.domains.filter((d) => d !== "colorless");

  const legal = (c: CatalogCard) =>
    ["unit", "spell", "gear"].includes(c.type) &&
    c.supertype !== "token" &&
    c.supertype !== "signature" && // signature is a separate, tag-restricted slot; not auto-filled
    c.domains.length > 0 &&
    c.domains.every((d) => domains.includes(d)) &&
    !isBanned(c.id);

  const main: CatalogCard[] = [];
  const copies: Record<string, number> = {};
  function add(c: CatalogCard, count: number) {
    const n = Math.min(count, MAX_COPIES - (copies[c.id] ?? 0));
    for (let i = 0; i < n; i++) main.push(c);
    copies[c.id] = (copies[c.id] ?? 0) + n;
  }

  // The Chosen Champion's card may also appear in the main deck (up to 2 more copies, since the
  // zone copy already counts toward the 3-copy cap).
  if (legal(champion)) add(champion, MAX_COPIES - 1);

  // Signature cards are tag-restricted (not domain-only), so they're excluded from `legal()`'s
  // auto-fill and must be added explicitly here, once eligibility against this legend is confirmed.
  if (spec.signatureName) {
    const sig = CARDS.find((c) => c.name === spec.signatureName);
    if (sig && signatureEligible(sig, legend) && !isBanned(sig.id)) add(sig, MAX_COPIES);
  }

  for (const name of spec.priorityCards) {
    if (main.length >= MAIN_SIZE) break;
    const c = CARDS.find((x) => x.name === name);
    if (c && legal(c)) add(c, MAX_COPIES);
  }

  const filler = CARDS.filter((c) => legal(c) && !(c.id in copies)).sort(
    (a, b) => (a.energy ?? 0) - (b.energy ?? 0),
  );
  let i = 0;
  while (main.length < MAIN_SIZE && filler.length > 0) {
    const c = filler[i % filler.length]!;
    if ((copies[c.id] ?? 0) < MAX_COPIES) add(c, 1);
    i++;
    if (i > filler.length * MAX_COPIES + 1) break; // safety valve
  }

  const runes = domains.flatMap((d, idx) => {
    const rune = CARDS.find((c) => c.type === "rune" && c.domains.includes(d))!;
    return Array.from({ length: spec.runeSplit[idx] ?? 0 }, () => rune);
  });

  return buildDeck(legend, main.slice(0, MAIN_SIZE), runes, champion);
}

export interface DeckMeta {
  id: StarterDeckId;
  name: string;
  domain: import("@riftbound/shared").Domain;
  tagline: string;
  playstyle: string;
  legendName: string;
  deck: DeckDefinition;
}

export type StarterDeckId = "viktor" | "leesin" | "annie" | "masteryi" | "lux" | "garen";

export const DECK_LIST: DeckMeta[] = SPECS.map((spec) => {
  const deck = buildPrecon(spec);
  return {
    id: spec.id,
    name: spec.name,
    domain: deck.legend.colors[0]! as import("@riftbound/shared").Domain,
    tagline: spec.tagline,
    playstyle: spec.playstyle,
    legendName: deck.legend.name,
    deck,
  };
});

export const DECKS_BY_ID: Record<StarterDeckId, DeckMeta> = Object.fromEntries(
  DECK_LIST.map((d) => [d.id, d]),
) as Record<StarterDeckId, DeckMeta>;

export const STARTER_DECKS: Record<StarterDeckId, DeckDefinition> = Object.fromEntries(
  DECK_LIST.map((d) => [d.id, d.deck]),
) as Record<StarterDeckId, DeckDefinition>;
