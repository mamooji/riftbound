/**
 * Showdown combat + battlefield control.
 *
 * When a battlefield becomes contested (both players have units there), a Showdown starts. Each
 * side deals damage equal to its total effective Might (base Might + [Assault N] while attacking,
 * + [Shield N] while defending), distributing it among the OTHER side's units with two rules: you
 * must assign LETHAL to a unit before wounding another, and excess CARRIES OVER. [Tank] units must
 * be targeted before any non-Tank unit on the same side. Assignment is collected one side at a
 * time (attacker first) but is conceptually simultaneous — it is applied to the pre-combat board,
 * so nobody strikes first. Survivors then heal to full.
 *
 * "Skip when forced": whenever a side has no meaningful choice (<=1 target, or enough damage to
 * kill everything targetable), the engine auto-assigns so the game never rests waiting on a
 * non-decision.
 */
import { opponentOf, VICTORY_POINTS_TO_WIN, type PlayerId } from "@riftbound/shared";
import { dealsDamage, effectiveMight, getInstance, hasTank, unitsAt, totalMightAt, type CardInstance, type GameState } from "./state.js";
import { canAfford } from "./resources.js";
import { effectivePlayCost } from "./costModifiers.js";
import {
  legendDefenderMightBonus,
  onAttackDeclared,
  onConquer,
  onKillStunnedEnemy,
  onUnitDeath,
  onUnitDeathAtBattlefield,
} from "./triggers.js";

/** A unit's Might for this Showdown's purposes (base + Assault/Shield per its side, plus any
 *  legend passive that applies — e.g. Master Yi - Wuju Bladesman (Starter)'s lone-defender bonus). */
function mightIn(state: GameState, inst: CardInstance): number {
  const sd = state.showdown!;
  const isDefender = inst.controller !== sd.attacker;
  return (
    effectiveMight(state, inst, sd.attacker) +
    legendDefenderMightBonus(state, inst, sd.battlefield, isDefender)
  );
}

/**
 * Units the given assigning side may still target. [Tank] units on the opposing side must be
 * assigned damage before any non-Tank unit there — while any Tank unit lacks an assignment, it is
 * the only legal target.
 */
export function availableTargets(state: GameState, side: PlayerId): CardInstance[] {
  const sd = state.showdown;
  if (!sd) return [];
  const all = unitsAt(state, sd.battlefield, opponentOf(side)).filter(
    (u) => !(u.iid in sd.assigned),
  );
  const tanks = all.filter((u) => hasTank(state, u));
  return tanks.length > 0 ? tanks : all;
}

function sideComplete(state: GameState, side: PlayerId): boolean {
  const sd = state.showdown!;
  return sd.remaining[side] <= 0 || availableTargets(state, side).length === 0;
}

/** True when the side has no meaningful assignment choice. */
function forced(state: GameState, side: PlayerId): boolean {
  const sd = state.showdown!;
  const targets = availableTargets(state, side);
  if (targets.length <= 1) return true;
  const totalMight = targets.reduce((s, t) => s + mightIn(state, t), 0);
  return sd.remaining[side] >= totalMight; // everything targetable dies regardless of order
}

/** True when `player` must make a real damage-assignment decision right now. */
export function needsAssignment(state: GameState, player: PlayerId): boolean {
  const sd = state.showdown;
  return (
    sd !== null &&
    sd.toAssign === player &&
    !sideComplete(state, player) &&
    !forced(state, player)
  );
}

/**
 * Whether `player` has anything legal to do during a Showdown's Action Window right now: an
 * affordable spell (in hand or the Champion Zone) carrying the `[Action]` or `[Reaction]` timing
 * keyword (rule 308.1.a/339.1 — a plain sorcery-speed card can't be played here at all). Used both
 * to auto-advance the window past a side with nothing to do, and by `getLegalActions` to decide
 * whether to offer that side anything beyond "pass".
 */
export function hasLegalActionSpell(state: GameState, player: PlayerId): boolean {
  const p = state.players[player];
  const candidates = [...p.hand, ...(p.championZone !== null ? [p.championZone] : [])];
  return candidates.some((iid) => {
    const def = state.defs[getInstance(state, iid).defId]!;
    if (def.type !== "spell" || def.timing === "sorcery") return false;
    const cost = effectivePlayCost(state, player, def);
    return canAfford(state, player, cost.energy, cost.power);
  });
}

/** Skips a side past the Action Window while they have nothing legal to play, closing the window
 *  (and starting normal damage-assignment math) once both players have passed in a row. */
function advanceActionWindow(state: GameState): void {
  const sd = state.showdown;
  if (!sd || !sd.windowOpen) return;

  while (sd.windowOpen) {
    if (hasLegalActionSpell(state, sd.focus)) return; // a real decision — wait for the player
    sd.passesInRow += 1;
    if (sd.passesInRow >= 2) {
      closeActionWindow(state);
      return;
    }
    sd.focus = opponentOf(sd.focus);
  }
}

/** After a spell is played (or fully resolved, if it opened its own targeting decision) during an
 *  open Action Window: Focus passes to the other player and the "passed in a row" streak resets
 *  (rule 343/344.4) — then auto-advance again in case the new holder also has nothing to do. */
export function onActionWindowPlay(state: GameState): void {
  const sd = state.showdown;
  if (!sd || !sd.windowOpen) return;
  sd.passesInRow = 0;
  sd.focus = opponentOf(sd.focus);
  advanceActionWindow(state);
}

/** A real (not auto-) pass by the Focus holder — rule 344.3/344.3.a/344.4: closes the window if
 *  this is the second consecutive pass, otherwise Focus moves on and the window keeps advancing
 *  past anyone else with nothing to do. */
export function passActionWindow(state: GameState): void {
  const sd = state.showdown;
  if (!sd || !sd.windowOpen) throw new Error("passActionWindow: no open Action Window");
  sd.passesInRow += 1;
  if (sd.passesInRow >= 2) {
    closeActionWindow(state);
  } else {
    sd.focus = opponentOf(sd.focus);
    advanceActionWindow(state);
  }
}

/** Rule 345: closes the Action Window and computes the REAL damage totals fresh (any Might
 *  changes from spells played during the window, e.g. Primal Strength's "+7 Might this turn",
 *  must be reflected — this is why totals are computed here, not at Showdown creation). */
function closeActionWindow(state: GameState): void {
  const sd = state.showdown!;
  sd.windowOpen = false;
  const attacker = sd.attacker;
  const defender = opponentOf(attacker);

  // Any legend passive bonus (e.g. Master Yi - Wuju Bladesman (Starter)'s lone-defender +2) isn't
  // part of `totalMightAt`'s plain Assault/Shield math (that lives in state.ts, which can't import
  // triggers.ts without a cycle) — add it here, matching the same per-unit math `mightIn` uses.
  const defenderBonus = unitsAt(state, sd.battlefield, defender)
    .filter(dealsDamage)
    .reduce((sum, u) => sum + legendDefenderMightBonus(state, u, sd.battlefield, true), 0);

  sd.remaining[attacker] = totalMightAt(state, sd.battlefield, attacker, attacker);
  sd.remaining[defender] = totalMightAt(state, sd.battlefield, defender, attacker) + defenderBonus;
  sd.toAssign = attacker;
  state.log.push(
    `Showdown at ${state.battlefields[sd.battlefield]!.name}: ` +
      `P${attacker} ${sd.remaining[attacker]} vs P${defender} ${sd.remaining[defender]}`,
  );
  advanceShowdown(state);
}

export function startShowdown(state: GameState, battlefield: number, attacker: PlayerId): void {
  onAttackDeclared(state, battlefield, attacker); // may apply "this turn" modifiers before totals are computed
  state.showdown = {
    battlefield,
    attacker,
    remaining: [0, 0],
    assigned: {},
    toAssign: null,
    windowOpen: true,
    focus: attacker, // rule 341: the player who applied Contested status gains Focus first
    passesInRow: 0,
  };
  advanceActionWindow(state);
}

/** Applies one player's chosen target (assign lethal, carrying over). */
export function assignToTarget(state: GameState, side: PlayerId, targetIid: number): void {
  const sd = state.showdown;
  if (!sd || sd.toAssign !== side) throw new Error("assignToTarget: not this side's turn");
  const target = availableTargets(state, side).find((t) => (t.iid as number) === targetIid);
  if (!target) throw new Error("assignToTarget: invalid target");
  const dmg = Math.min(sd.remaining[side], mightIn(state, target));
  sd.assigned[targetIid] = dmg;
  sd.remaining[side] -= dmg;
  advanceShowdown(state);
}

function autoAssign(state: GameState, side: PlayerId): void {
  const sd = state.showdown!;
  const targets = availableTargets(state, side).sort((a, b) => mightIn(state, b) - mightIn(state, a));
  for (const t of targets) {
    if (sd.remaining[side] <= 0) break;
    const dmg = Math.min(sd.remaining[side], mightIn(state, t));
    sd.assigned[t.iid as number] = dmg;
    sd.remaining[side] -= dmg;
  }
}

/**
 * Drives the showdown forward: auto-assigns forced/complete sides and flips who assigns, until a
 * real decision is needed (then it waits) or both sides are done (then it resolves).
 */
export function advanceShowdown(state: GameState): void {
  const sd = state.showdown;
  if (!sd || sd.windowOpen) return; // the Action Window governs progression until it closes

  while (sd.toAssign !== null) {
    const side = sd.toAssign;
    if (sideComplete(state, side)) {
      sd.toAssign = nextAssigner(state, side);
      continue;
    }
    if (forced(state, side)) {
      autoAssign(state, side);
      sd.toAssign = nextAssigner(state, side);
      continue;
    }
    return; // genuine choice — wait for the player
  }
  resolveShowdown(state);
}

function nextAssigner(state: GameState, side: PlayerId): PlayerId | null {
  const other = opponentOf(side);
  if (!sideComplete(state, other)) return other;
  return null;
}

function resolveShowdown(state: GameState): void {
  const sd = state.showdown!;
  const bf = sd.battlefield;

  for (const [iidStr, dmg] of Object.entries(sd.assigned)) {
    const inst = state.instances[Number(iidStr)];
    if (inst) inst.damage += dmg;
  }

  // Deaths (effective Might — a Shielded defender needs more damage to die).
  for (const inst of Object.values(state.instances)) {
    if (
      inst.zone === "battlefield" &&
      inst.battlefield === bf &&
      state.defs[inst.defId]!.type === "unit" &&
      inst.damage >= effectiveMight(state, inst, sd.attacker)
    ) {
      inst.zone = "trash";
      inst.battlefield = null;
      inst.damage = 0;
      state.log.push(`P${inst.controller} loses ${state.defs[inst.defId]!.name}`);
      onUnitDeath(state, inst);
      onKillStunnedEnemy(state, inst);
      onUnitDeathAtBattlefield(state, inst, bf);
    }
  }

  // Survivors heal.
  for (const inst of Object.values(state.instances)) {
    if (inst.zone === "battlefield" && inst.battlefield === bf) inst.damage = 0;
  }

  state.showdown = null;
  updateControl(state, bf);
  checkWin(state);
}

/**
 * Recomputes who holds a battlefield: the sole player with units there controls it (scoring +1 on
 * a change of control); if both or neither have units, it is uncontrolled.
 */
export function updateControl(state: GameState, bf: number): void {
  const p0 = unitsAt(state, bf, 0).length;
  const p1 = unitsAt(state, bf, 1).length;
  let controller: PlayerId | null;
  if (p0 > 0 && p1 === 0) controller = 0;
  else if (p1 > 0 && p0 === 0) controller = 1;
  else controller = null;

  const field = state.battlefields[bf]!;
  if (controller !== null && controller !== field.controller) {
    field.controller = controller;
    state.players[controller].points += 1;
    state.log.push(
      `P${controller} takes ${field.name} (+1, total ${state.players[controller].points})`,
    );
    onConquer(state, bf, controller);
  } else if (controller === null) {
    field.controller = null;
  }
}

export function checkWin(state: GameState): void {
  if (state.winner !== null) return;
  for (const p of state.players) {
    if (p.points >= VICTORY_POINTS_TO_WIN) {
      state.winner = p.id;
      state.log.push(`P${p.id} wins with ${p.points} points`);
      return;
    }
  }
}
