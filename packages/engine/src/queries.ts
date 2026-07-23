/**
 * Shared board queries — the single definition of recurring "what's on the board" questions.
 *
 * Before this module, the pattern `Object.values(state.instances).filter(i => (zone base|
 * battlefield) && type === "unit" && ...)` was inlined dozens of times across spells.ts,
 * triggers.ts, and abilities.ts, and "friendly units in play" was defined three separate times.
 * Centralizing it means the meaning of "a unit in play" (which zones count, what a unit is) lives
 * in exactly one place. All queries return `CardInstance[]`; callers that want ids `.map(i => i.iid)`.
 */
import type { PlayerId } from "@riftbound/shared";
import { opponentOf } from "@riftbound/shared";
import type { CardInstance, EngineCardType, GameState } from "./state.js";

/** A permanent is "in play" for these purposes while it sits at a base or a battlefield. */
export function isInPlay(inst: CardInstance): boolean {
  return inst.zone === "base" || inst.zone === "battlefield";
}

function inPlayOfType(state: GameState, type: EngineCardType): CardInstance[] {
  return Object.values(state.instances).filter(
    (i) => isInPlay(i) && state.defs[i.defId]!.type === type,
  );
}

/** Every unit currently in play (either player), at a base or a battlefield. */
export function unitsInPlay(state: GameState): CardInstance[] {
  return inPlayOfType(state, "unit");
}

/** Units in play controlled by `player`. Pass `exclude` to omit one instance (e.g. "OTHER
 *  friendly units"), matching the source unit by its instance id. */
export function friendlyUnits(
  state: GameState,
  player: PlayerId,
  exclude?: CardInstance["iid"],
): CardInstance[] {
  return unitsInPlay(state).filter((i) => i.controller === player && i.iid !== exclude);
}

/** Units in play NOT controlled by `player`. */
export function enemyUnits(state: GameState, player: PlayerId): CardInstance[] {
  return unitsInPlay(state).filter((i) => i.controller === opponentOf(player));
}

/** Gear in play (gear sits at a base). Optionally restricted to a single controller. */
export function gearInPlay(state: GameState, player?: PlayerId): CardInstance[] {
  return inPlayOfType(state, "gear").filter((i) => player === undefined || i.controller === player);
}
