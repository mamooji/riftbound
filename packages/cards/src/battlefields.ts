/**
 * Battlefield pool for Set 1 setup, projected to engine CardDefs. Banned battlefields excluded.
 */
import type { CardDef } from "@riftbound/engine";
import { cardsByType } from "./catalog.js";
import { toCardDef } from "./decks.js";
import { isBanned } from "./banned.js";

export const BATTLEFIELD_POOL: CardDef[] = cardsByType("battlefield")
  .filter((c) => !isBanned(c.id))
  .map(toCardDef);
