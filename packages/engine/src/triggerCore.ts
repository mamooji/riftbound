/**
 * The generic trigger engine — the reusable machinery behind every scripted card effect, with no
 * knowledge of any specific card. A `TriggerEffect` describes one "may / must, maybe choosing among
 * targets" decision; `register` files them into the shared `ALL_TRIGGERS` table; `fireTrigger`
 * runs one (auto-resolving when there's no real choice, else parking a `pendingTrigger`); and
 * `resolvePendingTrigger` applies the player's answer, including the "up to N picks" loop.
 *
 * The Set-1 card content that USES this engine (legend/unit/spell triggers) lives in triggers.ts,
 * spells.ts, and spellsCompound.ts — all of which import `register`/`fireTrigger` from here.
 */
import type { InstanceId, PlayerId } from "@riftbound/shared";
import type { GameState } from "./state.js";

export interface TriggerEffect {
  mandatory: boolean;
  /** "Up to N" multi-target abilities (e.g. Kinkou Monk's "buff up to two", Undercover Agent's
   *  "discard 2") — default 1. Each accepted pick calls `resolve` once and stays pending (offering
   *  the remaining legal targets minus anything already picked) until N picks or a decline. Not
   *  used by `legalBattlefields` triggers, which only ever offer a single one-shot pick. */
  maxPicks?: number;
  /** By default, a target already picked this sequence is excluded from the next pick (right for
   *  "buff up to two OTHER units" or "discard 2" — you wouldn't re-pick the same one). A handful of
   *  cards are N truly INDEPENDENT instructions instead (Falling Star's "Deal 3 to a unit. Deal 3
   *  to a unit.", Icathian Rain's six "Deal 2 to a unit"s) where the SAME unit may legally be
   *  targeted again by a later instruction. Set true to allow that. */
  allowRepeatTargets?: boolean;
  condition?: (state: GameState, player: PlayerId, sourceIid: InstanceId, ctx: unknown) => boolean;
  legalTargets?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => InstanceId[];
  /** For effects that target a BATTLEFIELD rather than a game object (e.g. "deal 3 to all enemy
   *  units at a battlefield") — mutually exclusive with `legalTargets`. Always a single, immediate
   *  pick (no multi-pick concept; no Set 1 card needs to choose more than one battlefield). */
  legalBattlefields?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => number[];
  resolve: (
    state: GameState,
    player: PlayerId,
    sourceIid: InstanceId,
    targetIid?: InstanceId,
    battlefield?: number,
  ) => void;
  /** For "do X per pick, THEN do Y once" abilities (e.g. Undercover Agent's "discard 2, then draw
   *  2") — called exactly once when the pick sequence ends (maxPicks reached, declined, or no more
   *  legal targets), including the 0/1-target auto-resolve path. `picked` is however many targets
   *  were actually picked (may be fewer than `maxPicks` if there weren't enough legal ones). */
  onComplete?: (state: GameState, player: PlayerId, sourceIid: InstanceId, picked: InstanceId[]) => void;
}

/** Every registered trigger, keyed by the same `kind` string used in `pendingTrigger.kind` — one
 *  merged table so `resolvePendingTrigger` (and `getLegalActions`, to enumerate target choices)
 *  can look any of them back up after a decision. Exported so other registries (e.g. `spells.ts`)
 *  can feed the same shared table/pending-decision machinery instead of inventing a second one. */
export const ALL_TRIGGERS: Record<string, TriggerEffect> = {};
export function register(kind: string, spec: TriggerEffect): string {
  ALL_TRIGGERS[kind] = spec;
  return kind;
}

/** Exported so other registries (`spells.ts`) can chain a SECOND trigger from within an `onComplete`
 *  callback — e.g. a "each player does X, starting with the next player" spell fires one player's
 *  decision, then its `onComplete` fires the other's via this same function. */
export function fireTrigger(
  state: GameState,
  kind: string,
  player: PlayerId,
  sourceIid: InstanceId,
  ctx: unknown,
): void {
  if (state.pendingTrigger) return; // one pending decision at a time (see triggers.ts header)
  const spec = ALL_TRIGGERS[kind]!;
  if (spec.condition && !spec.condition(state, player, sourceIid, ctx)) return;

  if (spec.legalBattlefields) {
    const bfs = spec.legalBattlefields(state, player, sourceIid);
    if (bfs.length === 0) {
      if (spec.mandatory) spec.onComplete?.(state, player, sourceIid, []);
      return;
    }
    if (spec.mandatory && bfs.length === 1) {
      spec.resolve(state, player, sourceIid, undefined, bfs[0]);
      spec.onComplete?.(state, player, sourceIid, []);
      return;
    }
    state.pendingTrigger = { kind, sourceIid, player, maxPicks: 1, picked: [] };
    return;
  }

  const targets = spec.legalTargets ? spec.legalTargets(state, player, sourceIid) : null;

  if (targets !== null && targets.length === 0) {
    // Nothing to target -- most triggers just no-op, but a mandatory "X, then Y" effect (e.g.
    // Undercover Agent's "discard 2, then draw 2") still needs its "then Y" half to happen even
    // when there was nothing to discard.
    if (spec.mandatory) spec.onComplete?.(state, player, sourceIid, []);
    return;
  }
  if (spec.mandatory && (targets === null || targets.length <= 1)) {
    spec.resolve(state, player, sourceIid, targets?.[0]);
    spec.onComplete?.(state, player, sourceIid, targets ?? []);
    return;
  }
  state.pendingTrigger = { kind, sourceIid, player, maxPicks: spec.maxPicks ?? 1, picked: [] };
}

export function resolvePendingTrigger(
  state: GameState,
  accept: boolean,
  targetIid?: InstanceId,
  battlefield?: number,
): void {
  const pending = state.pendingTrigger;
  if (!pending) throw new Error("resolvePendingTrigger: nothing pending");
  const spec = ALL_TRIGGERS[pending.kind]!;
  if (!accept) {
    state.pendingTrigger = null;
    spec.onComplete?.(state, pending.player, pending.sourceIid, pending.picked);
    return;
  }

  if (spec.legalBattlefields) {
    const legalBfs = spec.legalBattlefields(state, pending.player, pending.sourceIid);
    if (battlefield === undefined || !legalBfs.includes(battlefield)) {
      throw new Error("resolvePendingTrigger: invalid battlefield");
    }
    state.pendingTrigger = null;
    spec.resolve(state, pending.player, pending.sourceIid, undefined, battlefield);
    spec.onComplete?.(state, pending.player, pending.sourceIid, []);
    return;
  }

  let legal: InstanceId[] = [];
  if (spec.legalTargets) {
    legal = spec.legalTargets(state, pending.player, pending.sourceIid);
    if (!spec.allowRepeatTargets) legal = legal.filter((t) => !pending.picked.includes(t));
    if (targetIid === undefined || !legal.includes(targetIid)) {
      throw new Error("resolvePendingTrigger: invalid target");
    }
  }
  // Clear BEFORE calling resolve() -- resolve() may itself fire another trigger (e.g. Solari
  // Shieldbearer's stun -> Leona's onStun reaction), which `fireTrigger`'s "one pending decision
  // at a time" guard would otherwise block if this one were still considered "pending."
  state.pendingTrigger = null;
  spec.resolve(state, pending.player, pending.sourceIid, targetIid);
  if (!spec.legalTargets) return; // plain yes/no trigger, no multi-pick concept

  // If resolve() itself opened a NEW pending decision (a chained trigger), let that run first --
  // don't clobber it by re-opening this "up to N" prompt underneath it (and defer onComplete,
  // since the sequence isn't really done from the player's point of view until that resolves too).
  if (state.pendingTrigger !== null) return;

  const picked = [...pending.picked, targetIid!];
  let stillLegal = spec.legalTargets(state, pending.player, pending.sourceIid);
  if (!spec.allowRepeatTargets) stillLegal = stillLegal.filter((t) => !picked.includes(t));
  if (picked.length < pending.maxPicks && stillLegal.length > 0) {
    state.pendingTrigger = { ...pending, picked };
  } else {
    spec.onComplete?.(state, pending.player, pending.sourceIid, picked);
  }
}
