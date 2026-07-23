/**
 * @riftbound/engine — public API.
 *
 * A pure, deterministic, serializable Riftbound (Set 1) rules engine driven by discrete actions.
 * Consumed identically by the UI, the bot, and self-play.
 */
export type {
  CardDef,
  CardInstance,
  PlayerState,
  Battlefield,
  Showdown,
  PendingTrigger,
  GameState,
  Zone,
  EngineCardType,
  RuneColor,
} from "./state.js";
export {
  getInstance,
  unitsAt,
  totalMightAt,
  effectiveMight,
  readyRunes,
  isMighty,
  hasGanking,
  dealsDamage,
  windowIsOpen,
} from "./state.js";

export type { AbilitySpec, AbilityCost } from "./abilities.js";
export { ABILITIES, canActivate } from "./abilities.js";

export type { TriggerEffect } from "./triggers.js";
export { ALL_TRIGGERS } from "./triggers.js";

export { RECRUIT_TOKEN, SPRITE_TOKEN } from "./tokens.js";

export { effectivePlayCost } from "./costModifiers.js";

export type { RngState } from "./rng.js";
export { createRng, nextFloat, nextInt, shuffle } from "./rng.js";

export type { DeckDefinition, NewGameOptions } from "./setup.js";
export { createGame, startTurn, endOfTurnPhase } from "./setup.js";

export {
  floatEnergy,
  floatPower,
  canAfford,
  autoPay,
  maxEnergy,
  maxPower,
} from "./resources.js";

export {
  availableTargets,
  needsAssignment,
  updateControl,
} from "./showdown.js";

export type { Action } from "./actions.js";
export { getLegalActions, applyAction, isTerminal, getReward } from "./actions.js";

export { serialize, deserialize, replay } from "./serialize.js";
export { encodeState, encodedStateSize } from "./encode.js";
