/**
 * Serialization + deterministic replay.
 *
 * Because GameState is plain JSON and applyAction is pure, a game is fully described by its
 * initial state plus its action log. This is the backbone of replays, debugging, and self-play
 * record generation.
 */
import type { Action } from "./actions.js";
import { applyAction } from "./actions.js";
import type { GameState } from "./state.js";

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  return JSON.parse(json) as GameState;
}

/** Re-runs an action log from an initial state, returning the final state. */
export function replay(initial: GameState, actions: Action[]): GameState {
  let state = initial;
  for (const action of actions) state = applyAction(state, action);
  return state;
}
