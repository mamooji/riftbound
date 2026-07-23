/**
 * Static cost-reduction text ("I cost N less") — a small, hardcoded-by-id table (same philosophy
 * as abilities.ts/triggers.ts), applied wherever a card's own play cost is checked or paid.
 * Distinct from [Accelerate], which is an ADDITIONAL alternate cost paid on top, not a discount to
 * the base one.
 */
import type { CardDefId, PlayerId } from "@riftbound/shared";
import { effectiveMight, type CardDef, type GameState } from "./state.js";
import { NOXUS_HOPEFUL, RHASA_THE_SUNDERER, SKY_SPLITTER } from "./ids.js";

/** Energy discount for a specific card id, if any (never below 0 -- clamped by the caller). */
function energyDiscount(state: GameState, player: PlayerId, defId: CardDefId): number {
  switch (defId as string) {
    case NOXUS_HOPEFUL:
      // [Legion] -- I cost 2 Energy less.
      return state.players[player].playedCardThisTurn ? 2 : 0;
    case RHASA_THE_SUNDERER: {
      // I cost 1 Energy less for each card in your trash.
      let trashCount = 0;
      for (const inst of Object.values(state.instances)) {
        if (inst.owner === player && inst.zone === "trash") trashCount++;
      }
      return trashCount;
    }
    case SKY_SPLITTER: {
      // This spell's Energy cost is reduced by the highest Might among units you control.
      let highest = 0;
      for (const inst of Object.values(state.instances)) {
        if (
          inst.controller === player &&
          (inst.zone === "base" || inst.zone === "battlefield") &&
          state.defs[inst.defId]!.type === "unit"
        ) {
          highest = Math.max(highest, effectiveMight(state, inst, undefined));
        }
      }
      return highest;
    }
    default:
      return 0;
  }
}

/** The card's actual play cost right now, after any discount (never negative). Power is currently
 *  never discounted by anything in the Set 1 corpus, so it passes through unchanged. */
export function effectivePlayCost(
  state: GameState,
  player: PlayerId,
  def: CardDef,
): { energy: number; power: number } {
  const discount = energyDiscount(state, player, def.id);
  return { energy: Math.max(0, def.energy - discount), power: def.power };
}
