/**
 * The testable-card inventory: every card the engine scripts, categorized for the checklist.
 * Driven by the engine's own `scriptedCardIds()` so it's always complete and never drifts.
 */
import { scriptedCardIds, type CardDef } from "@riftbound/engine";
import { CARDS_BY_ID, toCardDef } from "@riftbound/cards";

export type Category = "Legends" | "Spells" | "Gear" | "Units";
export const CATEGORIES: Category[] = ["Legends", "Spells", "Gear", "Units"];

export interface TestCard {
  defId: string;
  name: string;
  type: CardDef["type"];
  text: string;
  domains: string[];
  category: Category;
  def: CardDef;
}

function categoryFor(type: CardDef["type"]): Category {
  if (type === "legend") return "Legends";
  if (type === "spell") return "Spells";
  if (type === "gear") return "Gear";
  return "Units";
}

let cache: TestCard[] | null = null;

/** All scripted cards, sorted by category then name. */
export function inventory(): TestCard[] {
  if (cache) return cache;
  const out: TestCard[] = [];
  for (const defId of scriptedCardIds()) {
    const cat = CARDS_BY_ID[defId];
    if (!cat) continue; // e.g. a synthesized/token id with no catalog entry
    const def = toCardDef(cat);
    out.push({
      defId,
      name: cat.name,
      type: def.type,
      text: cat.text,
      domains: cat.domains,
      category: categoryFor(def.type),
      def,
    });
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  cache = out;
  return out;
}

/** Every catalog card projected to an engine CardDef, keyed by id — the pool the builder draws from. */
let defCache: Record<string, CardDef> | null = null;
export function allDefs(): Record<string, CardDef> {
  if (defCache) return defCache;
  defCache = {};
  for (const c of Object.values(CARDS_BY_ID)) {
    try {
      defCache[c.id] = toCardDef(c);
    } catch {
      /* skip anything that can't project (shouldn't happen for Set 1) */
    }
  }
  return defCache;
}
