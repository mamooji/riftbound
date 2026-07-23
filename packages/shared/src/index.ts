/**
 * @riftbound/shared — domain vocabulary shared across the engine, card DB, bot, and UI.
 *
 * Keep this package free of logic and dependencies. It is the common language every
 * other package speaks. Riftbound-specific facts here are for Set 1 (Origins) and may be
 * refined as rules are implemented in @riftbound/engine.
 */

/**
 * The six Riftbound domains (a.k.a. colors). A Legend restricts which domains a deck may use.
 * Names per Set 1; treated as an open enum so refinement stays cheap.
 */
export const DOMAINS = ["fury", "calm", "mind", "body", "chaos", "order"] as const;
export type Domain = (typeof DOMAINS)[number];

/** A card's color: one of the six domains, or colorless (battlefields, some cards). */
export type CardColor = Domain | "colorless";

export function isDomain(x: string): x is Domain {
  return (DOMAINS as readonly string[]).includes(x);
}

/** Card supertypes in Riftbound. */
export const CARD_TYPES = ["legend", "unit", "spell", "gear", "battlefield", "rune"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/** Points needed to win a 1v1 game. */
export const VICTORY_POINTS_TO_WIN = 8;

/** A player's seat identifier within a single game. */
export type PlayerId = 0 | 1;

export function opponentOf(p: PlayerId): PlayerId {
  return (p === 0 ? 1 : 0) as PlayerId;
}

/** Branded id helpers keep loosely-typed string ids from being mixed up. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Stable identifier of a card *definition* (e.g. "OGN-042"). */
export type CardDefId = Brand<string, "CardDefId">;

/** Stable identifier of a battlefield *definition*. */
export type BattlefieldDefId = Brand<string, "BattlefieldDefId">;

/** Runtime identifier of a specific card *instance* within a game. */
export type InstanceId = Brand<number, "InstanceId">;
