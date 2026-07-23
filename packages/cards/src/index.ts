/**
 * @riftbound/cards — Set 1 (Origins) card data for the app + engine.
 */
export type { CatalogCard } from "./catalog.js";
export {
  ALL_CARDS,
  CARDS,
  CARDS_BY_ID,
  cardsByType,
  cardColor,
  cardDomains,
  renderCardText,
  SET_META,
} from "./catalog.js";

export type { BanFormat, BanEntry } from "./banned.js";
export { BANS, STANDARD_BANS, TEAM_ONLY_BANS, isBanned } from "./banned.js";

export { toCardDef, buildDeck, chosenChampionEligible, signatureEligible } from "./decks.js";
export type { DeckDefinition } from "./decks.js";
export { STARTER_DECKS, DECK_LIST, DECKS_BY_ID } from "./starter.js";
export type { StarterDeckId, DeckMeta } from "./starter.js";
export { BATTLEFIELD_POOL } from "./battlefields.js";
