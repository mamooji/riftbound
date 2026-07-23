/**
 * Compound spells — the ones whose resolution is more than a single `SPELL_EFFECTS` `TriggerEffect`:
 *  - "starting with the next player" sequences (Cull the Weak, King's Edict, Whirlwind, Acceptable
 *    Losses), chained via each trigger's `onComplete` firing the other player's decision;
 *  - two-step "pick A THEN pick B" chains (Stormbringer, Showstopper, Challenge, Gentlemen's Duel,
 *    Convergent Mutation, Facebreaker, Zenith Blade, Last Breath, Get Excited, Shakedown), where the
 *    first pick's chosen iid is repurposed as the second trigger's `sourceIid` to carry context;
 *  - bespoke inline effects (Time Warp; Salvage/Meditation, whose guaranteed half plus genuine "may"
 *    half can't be modeled by one mandatory/optional flag).
 *
 * Each registers into `triggers.ts`'s shared `ALL_TRIGGERS` table at import time, and exposes its
 * entry point through the exported `SPELL_CASTERS` table that `castSpell` (spells.ts) dispatches on.
 */
import { opponentOf, type InstanceId, type PlayerId } from "@riftbound/shared";
import { drawFromMain } from "./deck.js";
import { applyStun, fireTrigger, register } from "./triggers.js";
import {
  effectiveMight,
  getInstance,
  giveBuff,
  payDeflect,
  unitsAt,
  type CardInstance,
  type GameState,
} from "./state.js";
import { friendlyUnits } from "./queries.js";
import {
  anyUnitTargets,
  battlefieldUnitTargets,
  dealDamageToUnit,
  dealDamageToUnitsWhere,
  enemyBattlefieldUnitTargets,
  enemyUnitTargets,
  friendlyGear,
  gearOnBoard,
  killUnit,
  moveUnitToBattlefield,
  mutualMightDamage,
} from "./spellHelpers.js";
import {
  ACCEPTABLE_LOSSES,
  CHALLENGE,
  CONVERGENT_MUTATION,
  CULL_THE_WEAK,
  FACEBREAKER,
  GENTLEMENS_DUEL,
  GET_EXCITED,
  KINGS_EDICT,
  LAST_BREATH,
  MEDITATION,
  SALVAGE,
  SHAKEDOWN,
  SHOWSTOPPER,
  STORMBRINGER,
  TIME_WARP,
  WHIRLWIND,
  ZENITH_BLADE,
} from "./ids.js";

const SALVAGE_KILL_KIND = `spell:${SALVAGE}:kill`;
register(SALVAGE_KILL_KIND, {
  mandatory: false, // a real "may" -- always offers the choice, even with a single candidate
  legalTargets: (state) => gearOnBoard(state).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
});

const MEDITATION_KIND = `spell:${MEDITATION}`;
register(MEDITATION_KIND, {
  mandatory: false, // "you may exhaust a friendly unit" -- a real may, offered whenever >=1 exists
  legalTargets: (state, player) => friendlyUnits(state, player).filter((i) => !i.exhausted).map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    getInstance(state, targetIid).exhausted = true;
    drawFromMain(state, player);
    drawFromMain(state, player);
  },
  onComplete: (state, player, _source, picked) => {
    if (picked.length === 0) drawFromMain(state, player); // declined -- draw 1 instead of 2
  },
});

// ---------------------------------------------------------------------------------------------
// Cull the Weak / Whirlwind / King's Edict -- sequential "starting with the next player" effects,
// chained via `onComplete` calling `fireTrigger` for the other player, exactly the same "resolve()
// may itself fire another trigger" pattern already used for Sett's death-replacement.
// ---------------------------------------------------------------------------------------------

const CULL_OPPONENT_KIND = `spell:${CULL_THE_WEAK}:opponent`;
const CULL_CASTER_KIND = `spell:${CULL_THE_WEAK}:caster`;
register(CULL_OPPONENT_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
  onComplete: (state, opponent, sourceIid) => {
    fireTrigger(state, CULL_CASTER_KIND, opponentOf(opponent), sourceIid, undefined);
  },
});
register(CULL_CASTER_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
});

const ACCEPTABLE_LOSSES_OPPONENT_KIND = `spell:${ACCEPTABLE_LOSSES}:opponent`;
const ACCEPTABLE_LOSSES_CASTER_KIND = `spell:${ACCEPTABLE_LOSSES}:caster`;
register(ACCEPTABLE_LOSSES_OPPONENT_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyGear(state, player).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
  onComplete: (state, opponent, sourceIid) => {
    fireTrigger(state, ACCEPTABLE_LOSSES_CASTER_KIND, opponentOf(opponent), sourceIid, undefined);
  },
});
register(ACCEPTABLE_LOSSES_CASTER_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyGear(state, player).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
});

const KINGS_EDICT_KIND = `spell:${KINGS_EDICT}`;
register(KINGS_EDICT_KIND, {
  // "each other player chooses a unit you [the caster] don't control" -- in 1v1 that's just the
  // opponent choosing one of their OWN units, so no Deflect check applies (Deflect only gates an
  // opponent choosing YOUR unit, not a player choosing their own).
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, _player, _source, targetIid) => {
    if (targetIid !== undefined) killUnit(state, getInstance(state, targetIid));
  },
});

const WHIRLWIND_OPPONENT_KIND = `spell:${WHIRLWIND}:opponent`;
const WHIRLWIND_CASTER_KIND = `spell:${WHIRLWIND}:caster`;
function whirlwindSpec(nextKind: string | null) {
  return {
    mandatory: false, // "may"
    legalTargets: (state: GameState, player: PlayerId) => anyUnitTargets(state, player),
    resolve: (state: GameState, player: PlayerId, _source: InstanceId, targetIid?: InstanceId) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      const owner = state.players[target.owner];
      target.zone = "hand";
      target.battlefield = null;
      owner.hand.push(targetIid);
      state.log.push(`P${target.owner} returns ${state.defs[target.defId]!.name} to hand (Whirlwind)`);
    },
    onComplete: (state: GameState, player: PlayerId, sourceIid: InstanceId) => {
      if (nextKind) fireTrigger(state, nextKind, opponentOf(player), sourceIid, undefined);
    },
  };
}
register(WHIRLWIND_OPPONENT_KIND, whirlwindSpec(WHIRLWIND_CASTER_KIND));
register(WHIRLWIND_CASTER_KIND, whirlwindSpec(null));

// ---------------------------------------------------------------------------------------------
// Stormbringer / Showstopper -- pick a friendly unit, THEN pick the battlefield destination as a
// SECOND real decision (both by the player, never auto-picked). Two chained pendingTriggers: the
// first resolves onto the chosen unit's own iid as the second trigger's `sourceIid` (the same
// "repurpose sourceIid to carry picked context" trick already used for Sett's death-replacement),
// so the battlefield-pick's `legalBattlefields`/`resolve` can look the unit back up. Not a single
// `resolve` callback since a `TriggerEffect` only ever offers ONE kind of choice (targets XOR
// battlefields) at a time -- so `castSpell` kicks off the first step directly.
// ---------------------------------------------------------------------------------------------

const STORMBRINGER_PICK_UNIT_KIND = `spell:${STORMBRINGER}:unit`;
const STORMBRINGER_PICK_BATTLEFIELD_KIND = `spell:${STORMBRINGER}:battlefield`;
register(STORMBRINGER_PICK_UNIT_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).filter((i) => i.zone === "base").map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    fireTrigger(state, STORMBRINGER_PICK_BATTLEFIELD_KIND, player, targetIid, undefined);
  },
});
register(STORMBRINGER_PICK_BATTLEFIELD_KIND, {
  mandatory: true,
  // `sourceIid` here is the UNIT chosen in the first step, not the spell -- any battlefield with
  // at least one enemy unit is a legal choice; the player picks which, nothing is auto-selected.
  legalBattlefields: (state, player) =>
    state.battlefields
      .filter((bf) => unitsAt(state, bf.index, opponentOf(player)).length > 0)
      .map((bf) => bf.index),
  resolve: (state, player, sourceIid, _target, battlefield) => {
    if (battlefield === undefined) return;
    const unit = getInstance(state, sourceIid);
    const might = effectiveMight(state, unit, undefined);
    dealDamageToUnitsWhere(state, might, (i) => i.battlefield === battlefield && i.controller !== player);
    moveUnitToBattlefield(state, unit, battlefield);
  },
});
function resolveStormbringer(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, STORMBRINGER_PICK_UNIT_KIND, player, sourceIid, undefined);
}

const SHOWSTOPPER_PICK_UNIT_KIND = `spell:${SHOWSTOPPER}:unit`;
const SHOWSTOPPER_PICK_BATTLEFIELD_KIND = `spell:${SHOWSTOPPER}:battlefield`;
register(SHOWSTOPPER_PICK_UNIT_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).filter((i) => i.zone === "base").map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    giveBuff(getInstance(state, targetIid));
    fireTrigger(state, SHOWSTOPPER_PICK_BATTLEFIELD_KIND, player, targetIid, undefined);
  },
});
register(SHOWSTOPPER_PICK_BATTLEFIELD_KIND, {
  mandatory: true,
  legalBattlefields: (state) => state.battlefields.map((bf) => bf.index), // any battlefield is legal
  resolve: (state, _player, sourceIid, _target, battlefield) => {
    if (battlefield === undefined) return;
    moveUnitToBattlefield(state, getInstance(state, sourceIid), battlefield);
  },
});
function resolveShowstopper(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, SHOWSTOPPER_PICK_UNIT_KIND, player, sourceIid, undefined);
}

// ---------------------------------------------------------------------------------------------
// More two-step compound spells -- pick A, THEN pick B, both real player choices (same
// sourceIid-repurposing chain as Stormbringer/Showstopper above).
// ---------------------------------------------------------------------------------------------

// Challenge: choose a friendly unit and an enemy unit; they deal damage equal to their Mights to
// each other.
const CHALLENGE_FRIENDLY_KIND = `spell:${CHALLENGE}:friendly`;
const CHALLENGE_ENEMY_KIND = `spell:${CHALLENGE}:enemy`;
register(CHALLENGE_FRIENDLY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    fireTrigger(state, CHALLENGE_ENEMY_KIND, player, targetIid, undefined);
  },
});
register(CHALLENGE_ENEMY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => enemyUnitTargets(state, player),
  resolve: (state, player, sourceIid, targetIid) => {
    if (targetIid !== undefined) mutualMightDamage(state, player, sourceIid, targetIid);
  },
});
function resolveChallenge(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, CHALLENGE_FRIENDLY_KIND, player, sourceIid, undefined);
}

// Gentlemen's Duel: give a friendly unit +3 Might this turn, THEN choose an enemy unit; they deal
// damage equal to their (now-boosted) Mights to each other.
const GENTLEMENS_DUEL_FRIENDLY_KIND = `spell:${GENTLEMENS_DUEL}:friendly`;
const GENTLEMENS_DUEL_ENEMY_KIND = `spell:${GENTLEMENS_DUEL}:enemy`;
register(GENTLEMENS_DUEL_FRIENDLY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    getInstance(state, targetIid).tempMightDelta += 3;
    fireTrigger(state, GENTLEMENS_DUEL_ENEMY_KIND, player, targetIid, undefined);
  },
});
register(GENTLEMENS_DUEL_ENEMY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => enemyUnitTargets(state, player),
  resolve: (state, player, sourceIid, targetIid) => {
    if (targetIid !== undefined) mutualMightDamage(state, player, sourceIid, targetIid);
  },
});
function resolveGentlemensDuel(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, GENTLEMENS_DUEL_FRIENDLY_KIND, player, sourceIid, undefined);
}

// Convergent Mutation: choose a friendly unit; this turn, increase its Might to the Might of
// ANOTHER friendly unit (a second, distinct pick).
const CONVERGENT_MUTATION_A_KIND = `spell:${CONVERGENT_MUTATION}:a`;
const CONVERGENT_MUTATION_B_KIND = `spell:${CONVERGENT_MUTATION}:b`;
register(CONVERGENT_MUTATION_A_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    fireTrigger(state, CONVERGENT_MUTATION_B_KIND, player, targetIid, undefined);
  },
});
register(CONVERGENT_MUTATION_B_KIND, {
  mandatory: true,
  legalTargets: (state, player, sourceIid) => friendlyUnits(state, player).filter((i) => i.iid !== sourceIid).map((i) => i.iid),
  resolve: (state, _player, sourceIid, targetIid) => {
    if (targetIid === undefined) return;
    const unitA = getInstance(state, sourceIid);
    const unitB = getInstance(state, targetIid);
    const delta = effectiveMight(state, unitB, undefined) - effectiveMight(state, unitA, undefined);
    unitA.tempMightDelta += delta;
  },
});
function resolveConvergentMutation(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, CONVERGENT_MUTATION_A_KIND, player, sourceIid, undefined);
}

// Facebreaker: stun a friendly unit AND an enemy unit at the same battlefield -- picking the
// friendly one first (only battlefields with an enemy present are legal) fixes which battlefield
// the second pick (an enemy there) must come from.
const FACEBREAKER_FRIENDLY_KIND = `spell:${FACEBREAKER}:friendly`;
const FACEBREAKER_ENEMY_KIND = `spell:${FACEBREAKER}:enemy`;
register(FACEBREAKER_FRIENDLY_KIND, {
  mandatory: true,
  legalTargets: (state, player) =>
    friendlyUnits(state, player)
      .filter((i) => i.zone === "battlefield" && unitsAt(state, i.battlefield!, opponentOf(player)).length > 0)
      .map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    applyStun(state, targetIid, player);
    fireTrigger(state, FACEBREAKER_ENEMY_KIND, player, targetIid, undefined);
  },
});
register(FACEBREAKER_ENEMY_KIND, {
  mandatory: true,
  legalTargets: (state, player, sourceIid) => {
    const bf = getInstance(state, sourceIid).battlefield!;
    return unitsAt(state, bf, opponentOf(player)).map((i) => i.iid);
  },
  resolve: (state, player, _source, targetIid) => {
    if (targetIid !== undefined) applyStun(state, targetIid, player);
  },
});
function resolveFacebreaker(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, FACEBREAKER_FRIENDLY_KIND, player, sourceIid, undefined);
}

// Zenith Blade: stun an enemy unit at a battlefield. You may (optional second step) move a
// friendly unit to that enemy unit's battlefield.
const ZENITH_BLADE_ENEMY_KIND = `spell:${ZENITH_BLADE}:enemy`;
const ZENITH_BLADE_MOVE_KIND = `spell:${ZENITH_BLADE}:move`;
register(ZENITH_BLADE_ENEMY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => enemyBattlefieldUnitTargets(state, player),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    payDeflect(state, player, getInstance(state, targetIid));
    applyStun(state, targetIid, player);
    fireTrigger(state, ZENITH_BLADE_MOVE_KIND, player, targetIid, undefined);
  },
});
register(ZENITH_BLADE_MOVE_KIND, {
  mandatory: false, // "you may move a friendly unit..."
  legalTargets: (state, player, sourceIid) => {
    const bf = getInstance(state, sourceIid).battlefield!;
    return friendlyUnits(state, player)
      .filter((i) => !(i.zone === "battlefield" && i.battlefield === bf))
      .map((i) => i.iid);
  },
  resolve: (state, _player, sourceIid, targetIid) => {
    if (targetIid === undefined) return;
    const bf = getInstance(state, sourceIid).battlefield!;
    moveUnitToBattlefield(state, getInstance(state, targetIid), bf);
  },
});
function resolveZenithBlade(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, ZENITH_BLADE_ENEMY_KIND, player, sourceIid, undefined);
}

// Last Breath: ready a friendly unit; it deals damage equal to its Might to an enemy unit at a
// battlefield.
const LAST_BREATH_FRIENDLY_KIND = `spell:${LAST_BREATH}:friendly`;
const LAST_BREATH_ENEMY_KIND = `spell:${LAST_BREATH}:enemy`;
register(LAST_BREATH_FRIENDLY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    getInstance(state, targetIid).exhausted = false;
    fireTrigger(state, LAST_BREATH_ENEMY_KIND, player, targetIid, undefined);
  },
});
register(LAST_BREATH_ENEMY_KIND, {
  mandatory: true,
  legalTargets: (state, player) => enemyBattlefieldUnitTargets(state, player),
  resolve: (state, player, sourceIid, targetIid) => {
    if (targetIid === undefined) return;
    const friendly = getInstance(state, sourceIid);
    payDeflect(state, player, getInstance(state, targetIid));
    dealDamageToUnit(state, targetIid, effectiveMight(state, friendly, undefined));
  },
});
function resolveLastBreath(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, LAST_BREATH_FRIENDLY_KIND, player, sourceIid, undefined);
}

// Get Excited!: discard 1 (a real hand-card choice), then deal ITS Energy cost as damage to a
// unit at a battlefield (a second real choice). The discarded card's defId is still readable via
// its (now-trashed) instance, so its Energy cost survives into the second step.
const GET_EXCITED_DISCARD_KIND = `spell:${GET_EXCITED}:discard`;
const GET_EXCITED_TARGET_KIND = `spell:${GET_EXCITED}:target`;
register(GET_EXCITED_DISCARD_KIND, {
  mandatory: true,
  legalTargets: (state, player) => state.players[player].hand,
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    const inst = getInstance(state, targetIid);
    state.players[player].hand = state.players[player].hand.filter((h) => h !== targetIid);
    inst.zone = "trash";
    fireTrigger(state, GET_EXCITED_TARGET_KIND, player, targetIid, undefined);
  },
});
register(GET_EXCITED_TARGET_KIND, {
  mandatory: true,
  legalTargets: (state, player) => battlefieldUnitTargets(state, player),
  resolve: (state, player, sourceIid, targetIid) => {
    if (targetIid === undefined) return;
    const discardedDef = state.defs[getInstance(state, sourceIid).defId]!;
    payDeflect(state, player, getInstance(state, targetIid));
    dealDamageToUnit(state, targetIid, discardedDef.energy);
  },
});
function resolveGetExcited(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, GET_EXCITED_DISCARD_KIND, player, sourceIid, undefined);
}

// Shakedown: choose an enemy unit. Deal 6 to it UNLESS its controller has you (the caster) draw 2
// instead -- a real decision for the TARGET's controller, not the caster (mirrors King's Edict's
// "the opponent decides" precedent).
const SHAKEDOWN_PICK_KIND = `spell:${SHAKEDOWN}:pick`;
const SHAKEDOWN_RESPONSE_KIND = `spell:${SHAKEDOWN}:response`;
register(SHAKEDOWN_PICK_KIND, {
  mandatory: true,
  legalTargets: (state, player) => enemyUnitTargets(state, player),
  resolve: (state, player, _source, targetIid) => {
    if (targetIid === undefined) return;
    const target = getInstance(state, targetIid);
    payDeflect(state, player, target);
    fireTrigger(state, SHAKEDOWN_RESPONSE_KIND, target.controller, targetIid, undefined);
  },
});
register(SHAKEDOWN_RESPONSE_KIND, {
  mandatory: false, // the TARGET's controller decides -- accept substitutes the draw for the damage
  resolve: (state, opponent) => {
    drawFromMain(state, opponentOf(opponent)); // accepted: the CASTER draws 2 instead
    drawFromMain(state, opponentOf(opponent));
  },
  onComplete: (state, _opponent, sourceIid, picked) => {
    if (picked.length === 0) dealDamageToUnit(state, sourceIid, 6); // declined: the 6 damage goes through
  },
});
function resolveShakedown(state: GameState, player: PlayerId, sourceIid: InstanceId): void {
  fireTrigger(state, SHAKEDOWN_PICK_KIND, player, sourceIid, undefined);
}

/**
 * A "caster" for a spell whose resolution is more than a single registry `TriggerEffect` — see the
 * module header. Registered by defId in `SPELL_CASTERS`; `castSpell` (spells.ts) dispatches on it,
 * falling through to the plain `SPELL_EFFECTS` table for everything without an entry here.
 */
export type SpellCaster = (state: GameState, player: PlayerId, spellInst: CardInstance) => void;

/**
 * Compound-spell dispatch table. Adding a new compound spell means adding one entry here (and its
 * registrations above) — never editing `castSpell`.
 */
export const SPELL_CASTERS: Record<string, SpellCaster> = {
  [CULL_THE_WEAK]: (state, player, inst) =>
    fireTrigger(state, CULL_OPPONENT_KIND, opponentOf(player), inst.iid, undefined),
  [KINGS_EDICT]: (state, player, inst) =>
    fireTrigger(state, KINGS_EDICT_KIND, opponentOf(player), inst.iid, undefined),
  [WHIRLWIND]: (state, player, inst) =>
    fireTrigger(state, WHIRLWIND_OPPONENT_KIND, opponentOf(player), inst.iid, undefined),
  [ACCEPTABLE_LOSSES]: (state, player, inst) =>
    fireTrigger(state, ACCEPTABLE_LOSSES_OPPONENT_KIND, opponentOf(player), inst.iid, undefined),
  [TIME_WARP]: (state, player, inst) => {
    state.players[player].extraTurns += 1;
    inst.zone = "banishment";
    state.log.push(`P${player} takes another turn (Time Warp)`);
  },
  // "Draw 1" always happens; "you may kill a gear" is a genuine may — modeled here rather than as a
  // single registry entry so a lone gear candidate still offers a real decline (mandatory:true would
  // auto-force it; mandatory:false would drop the guaranteed draw when there are no gear). Meditation
  // has the same guaranteed-half + optional-half shape.
  [SALVAGE]: (state, player, inst) => {
    drawFromMain(state, player);
    if (gearOnBoard(state).length > 0) fireTrigger(state, SALVAGE_KILL_KIND, player, inst.iid, undefined);
  },
  [MEDITATION]: (state, player, inst) => {
    const readyFriendlyUnits = friendlyUnits(state, player).filter((i) => !i.exhausted);
    if (readyFriendlyUnits.length === 0) drawFromMain(state, player); // nothing to exhaust — just draw 1
    else fireTrigger(state, MEDITATION_KIND, player, inst.iid, undefined);
  },
  [STORMBRINGER]: (state, player, inst) => resolveStormbringer(state, player, inst.iid),
  [SHOWSTOPPER]: (state, player, inst) => resolveShowstopper(state, player, inst.iid),
  [CHALLENGE]: (state, player, inst) => resolveChallenge(state, player, inst.iid),
  [GENTLEMENS_DUEL]: (state, player, inst) => resolveGentlemensDuel(state, player, inst.iid),
  [CONVERGENT_MUTATION]: (state, player, inst) => resolveConvergentMutation(state, player, inst.iid),
  [FACEBREAKER]: (state, player, inst) => resolveFacebreaker(state, player, inst.iid),
  [ZENITH_BLADE]: (state, player, inst) => resolveZenithBlade(state, player, inst.iid),
  [LAST_BREATH]: (state, player, inst) => resolveLastBreath(state, player, inst.iid),
  [GET_EXCITED]: (state, player, inst) => resolveGetExcited(state, player, inst.iid),
  [SHAKEDOWN]: (state, player, inst) => resolveShakedown(state, player, inst.iid),
};
