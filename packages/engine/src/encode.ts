/**
 * State encoding for machine learning (the thin engine<->net boundary).
 *
 * `encodeState` turns a GameState into a fixed-length numeric vector from one player's point of
 * view. Keeping this the ONLY place engine internals become tensors means the net never couples
 * to engine data structures. The fixed action-index space is deferred until the action set settles.
 */
import type { PlayerId } from "@riftbound/shared";
import { opponentOf, VICTORY_POINTS_TO_WIN } from "@riftbound/shared";
import { maxEnergy, maxPower } from "./resources.js";
import { readyRunes, totalMightAt, type GameState } from "./state.js";

export function encodeState(state: GameState, player: PlayerId): Float32Array {
  const opp = opponentOf(player);
  const me = state.players[player];
  const you = state.players[opp];

  const features: number[] = [
    me.points / VICTORY_POINTS_TO_WIN,
    you.points / VICTORY_POINTS_TO_WIN,
    maxEnergy(state, player) / 12,
    maxPower(state, player) / 12,
    me.runePool.length / 12,
    readyRunes(state, player).length / 12,
    me.hand.length / 10,
    you.hand.length / 10,
    me.mainDeck.length / 40,
    you.mainDeck.length / 40,
    state.activePlayer === player ? 1 : 0,
    state.showdown ? 1 : 0,
  ];

  for (const bf of state.battlefields) {
    features.push(
      bf.controller === player ? 1 : bf.controller === opp ? -1 : 0,
      Math.tanh((totalMightAt(state, bf.index, player) - totalMightAt(state, bf.index, opp)) / 6),
    );
  }

  return Float32Array.from(features);
}

export function encodedStateSize(battlefieldCount: number): number {
  return 12 + battlefieldCount * 2;
}
