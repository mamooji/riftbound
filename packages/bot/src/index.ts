/**
 * @riftbound/bot — decision policies over the engine's action interface.
 *
 * A Policy only ever sees getLegalActions/applyAction, so every policy here (random today,
 * MCTS and NN-guided MCTS later) is a drop-in opponent for the UI and for self-play.
 */
import type { PlayerId } from "@riftbound/shared";
import { opponentOf } from "@riftbound/shared";
import {
  applyAction,
  createRng,
  getLegalActions,
  needsAssignment,
  nextInt,
  windowIsOpen,
  type Action,
  type GameState,
  type RngState,
} from "@riftbound/engine";

/** Whoever must act next: mulligan, then a pending trigger's own decider (may be either player --
 *  e.g. King's Edict/Cull the Weak/Whirlwind offer the OPPONENT a choice mid the active player's
 *  own turn), then a Showdown's Action Window Focus holder (may also be either player -- the
 *  DEFENDER can hold Focus mid the attacker's own turn), then the Showdown damage assigner, else
 *  the active player. Mirrors the exact same priority order `getLegalActions` itself checks in
 *  `actions.ts`. */
export function actingPlayer(state: GameState): PlayerId {
  if (state.mulligan.pending !== null) return state.mulligan.pending;
  if (state.pendingTrigger !== null) return state.pendingTrigger.player;
  if (state.chain.length > 0) return state.priority!; // Closed State: the Priority holder responds
  const sd = state.showdown;
  if (sd && windowIsOpen(sd)) return state.priority!;
  if (sd && sd.toAssign !== null && needsAssignment(state, sd.toAssign)) return sd.toAssign;
  return state.activePlayer;
}

export interface Policy {
  readonly name: string;
  choose(state: GameState, player: PlayerId): Action;
}

/** Uniformly random legal action. Deterministic given its seed. */
export class RandomPolicy implements Policy {
  readonly name = "random";
  private rng: RngState;
  constructor(seed = 1) {
    this.rng = createRng(seed);
  }
  choose(state: GameState, player: PlayerId): Action {
    const legal = getLegalActions(state, player);
    const r = nextInt(this.rng, legal.length);
    this.rng = r.next;
    return legal[r.value]!;
  }
}

/**
 * Static evaluation of a position from `player`'s perspective. Higher is better.
 * Points dominate; battlefield control and board power break ties and give the greedy
 * policy something to climb toward.
 */
export function evaluate(state: GameState, player: PlayerId): number {
  const opp = opponentOf(player);
  const me = state.players[player];
  const you = state.players[opp];

  let score = 10 * (me.points - you.points);
  for (const bf of state.battlefields) {
    if (bf.controller === player) score += 2;
    else if (bf.controller === opp) score -= 2;
  }
  for (const inst of Object.values(state.instances)) {
    if (inst.zone === "battlefield" || inst.zone === "base") {
      const might = state.defs[inst.defId]!.might;
      const onBoard = inst.zone === "battlefield" ? 1 : 0.5; // reward committing to battlefields
      score += (inst.controller === player ? 0.3 : -0.3) * might * onBoard;
    }
  }
  return score;
}

/**
 * Greedy 1-ply lookahead: apply each legal action, keep the one whose resulting position
 * evaluates best for us. Ties broken by preferring non-endTurn (stay active) then randomly.
 */
export class HeuristicPolicy implements Policy {
  readonly name = "heuristic";
  private rng: RngState;
  constructor(seed = 1) {
    this.rng = createRng(seed);
  }
  choose(state: GameState, player: PlayerId): Action {
    // Rely on auto-pay for resources; don't burn runes on speculative floats.
    const all = getLegalActions(state, player);
    const legal = all.filter((a) => a.type !== "floatEnergy" && a.type !== "floatPower");
    const pool = legal.length > 0 ? legal : all;
    let best: Action = pool[0]!;
    let bestScore = -Infinity;
    for (const action of pool) {
      const next = applyAction(state, action);
      let s = evaluate(next, player);
      if (action.type === "endTurn") s -= 0.01; // slight bias to develop before passing
      const r = nextInt(this.rng, 1000);
      this.rng = r.next;
      s += r.value * 1e-6; // tiny random tiebreak
      if (s > bestScore) {
        bestScore = s;
        best = action;
      }
    }
    return best;
  }
}

/** Plays a full game between two policies and returns the final state. */
export function runGame(
  initial: GameState,
  policies: [Policy, Policy],
): GameState {
  let state = initial;
  let guard = 0;
  while (state.winner === null) {
    const player = actingPlayer(state);
    const action = policies[player].choose(state, player);
    state = applyAction(state, action);
    if (++guard > 200000) throw new Error("runGame exceeded ply guard");
  }
  return state;
}
