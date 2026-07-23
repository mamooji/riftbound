/**
 * Shared building blocks for spell effects — the removal/damage/movement primitives and the
 * target-enumeration helpers used by BOTH the plain `SPELL_EFFECTS` registry (spells.ts) and the
 * multi-step compound spells (spellsCompound.ts).
 *
 * Lives in its own module so those two registries can each import what they need without importing
 * each other: spells.ts pulls in `SPELL_CASTERS` from spellsCompound.ts, so spellsCompound.ts must
 * not depend back on spells.ts — the shared helpers therefore can't live in either registry file.
 */
import { opponentOf, type InstanceId, type PlayerId } from "@riftbound/shared";
import { autoPay } from "./resources.js";
import { checkWin, startShowdown, updateControl } from "./showdown.js";
import { killUnit as killUnitCore, onArrival, onPlayCard } from "./triggers.js";
import {
  canChooseThroughDeflect,
  effectiveMight,
  getInstance,
  payDeflect,
  unitsAt,
  type CardDef,
  type CardInstance,
  type GameState,
} from "./state.js";
import { enemyUnits, gearInPlay, unitsInPlay as allUnits } from "./queries.js";

// --- Removal & damage -------------------------------------------------------------------------

/** Active Kill (rule 415.1.a.1) as a spell effect sees it: the shared `killUnit` core (board
 *  removal + every death hook, defined once in triggers.ts) plus a battlefield-control recompute,
 *  which spell removal always wants (combat resolution recomputes control itself, so the core
 *  leaves it to callers). */
export function killUnit(state: GameState, inst: CardInstance): void {
  const bf = inst.zone === "battlefield" ? inst.battlefield : null;
  killUnitCore(state, inst);
  if (bf !== null) updateControl(state, bf);
}

/** Deals damage to a single unit (rule 404 Deal), killing it if lethal (rule 415.1.a.2). Spell/
 *  ability damage is fully prevented while Unyielding Spirit is active (rule 366 replacement). */
export function dealDamageToUnit(state: GameState, targetIid: InstanceId, amount: number): void {
  if (state.preventSpellAbilityDamage) return;
  const inst = state.instances[targetIid as number];
  if (!inst || (inst.zone !== "base" && inst.zone !== "battlefield")) return;
  inst.damage += amount;
  if (inst.damage >= effectiveMight(state, inst, undefined)) killUnit(state, inst);
}

/** Deals flat damage to every unit at a battlefield matching `predicate`, killing lethal ones.
 *  Snapshots victims up front so a mid-loop death can't skip/duplicate anyone. */
export function dealDamageToUnitsWhere(
  state: GameState,
  amount: number,
  predicate: (inst: CardInstance) => boolean,
): void {
  if (state.preventSpellAbilityDamage) return;
  const victims = Object.values(state.instances).filter(
    (i) => i.zone === "battlefield" && state.defs[i.defId]!.type === "unit" && predicate(i),
  );
  for (const v of victims) v.damage += amount;
  for (const v of victims) {
    if (v.zone === "battlefield" && v.damage >= effectiveMight(state, v, undefined)) killUnit(state, v);
  }
}

/** Mutual-damage resolution shared by Challenge and Gentlemen's Duel: `friendlyIid` and `enemyIid`
 *  deal damage equal to their Mights to each other. Both amounts are computed BEFORE either is
 *  applied (simultaneous, not sequential — neither side "strikes first," so a death from one hit
 *  can't change the other's damage amount). */
export function mutualMightDamage(
  state: GameState,
  player: PlayerId,
  friendlyIid: InstanceId,
  enemyIid: InstanceId,
): void {
  const friendly = getInstance(state, friendlyIid);
  const enemy = getInstance(state, enemyIid);
  payDeflect(state, player, enemy);
  const friendlyMight = effectiveMight(state, friendly, undefined);
  const enemyMight = effectiveMight(state, enemy, undefined);
  dealDamageToUnit(state, friendlyIid, enemyMight);
  dealDamageToUnit(state, enemyIid, friendlyMight);
}

// --- Movement / replay ------------------------------------------------------------------------

/** Plays a unit-type card that's already off its normal zone (from trash — The Harrowing; from
 *  the Main Deck directly — Reinforce) straight to BASE, paying only its Power cost (Energy is
 *  waived by `energyDiscount`, clamped to 0). Simplified to always land at base rather than
 *  offering a battlefield-placement choice — the same conservative simplification already used
 *  for Yasuo's and Charm's move effects (neither card's text requires a battlefield destination,
 *  and a free base placement is always legal). */
export function playUnitFree(state: GameState, player: PlayerId, iid: InstanceId, energyDiscount: number): void {
  const inst = getInstance(state, iid);
  const def = state.defs[inst.defId]!;
  const energy = Math.max(0, def.energy - energyDiscount);
  autoPay(state, player, energy, def.power ?? 0);
  inst.zone = "base";
  inst.battlefield = null;
  inst.exhausted = !def.entersReady;
  state.log.push(`P${player} plays ${def.name}`);
  onPlayCard(state, player, inst);
}

/** Moves a unit onto a battlefield as a spell effect would (Showstopper, Stormbringer) — the same
 *  contested/Showdown-or-updateControl branch `actions.ts`'s `resolveArrival` uses for a played or
 *  moved unit, duplicated locally since spell code can't import from `actions.ts` (that would be
 *  the reverse of `actions.ts` importing the spell registries to dispatch effects — a cycle). */
export function moveUnitToBattlefield(state: GameState, inst: CardInstance, battlefield: number): void {
  const from = inst.zone === "battlefield" ? inst.battlefield : null;
  inst.zone = "battlefield";
  inst.battlefield = battlefield;
  if (unitsAt(state, battlefield, opponentOf(inst.controller)).length > 0) {
    startShowdown(state, battlefield, inst.controller);
  } else {
    updateControl(state, battlefield);
  }
  onArrival(state, battlefield, inst);
  if (from !== null) updateControl(state, from);
  checkWin(state);
}

/** Returns a unit to its OWNER's hand (not necessarily the same as its controller -- e.g. after
 *  Possession) and re-checks control at any vacated battlefield. Matches rule 109: a card leaving
 *  the board for a non-board zone stops tracking Temporary Modifications, but this engine (like
 *  the pre-existing Teemo ability) doesn't reset damage/buffed/stunned on the instance here --
 *  a known, pre-existing simplification, not new to this pass. */
export function returnUnitToHand(state: GameState, inst: CardInstance): void {
  const from = inst.zone === "battlefield" ? inst.battlefield : null;
  inst.zone = "hand";
  inst.battlefield = null;
  const owner = state.players[inst.owner];
  if (!owner.hand.includes(inst.iid)) owner.hand.push(inst.iid);
  if (from !== null) updateControl(state, from);
}

/** Possession-style control theft: the unit's OWNER never changes (rule 174/126 -- ownership is
 *  fixed at "who brought it into the game"), only its controller, then it's recalled to the NEW
 *  controller's base. */
export function stealControlAndRecall(state: GameState, inst: CardInstance, newController: PlayerId): void {
  const from = inst.zone === "battlefield" ? inst.battlefield : null;
  inst.controller = newController;
  inst.zone = "base";
  inst.battlefield = null;
  if (from !== null) updateControl(state, from);
}

// --- Target enumeration -----------------------------------------------------------------------

/** Any unit in play the acting player may legally choose (Deflect-aware). */
export function anyUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return allUnits(state)
    .filter((i) => canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

/** "...a unit at a battlefield" — narrower than `anyUnitTargets`, excludes units still at base.
 *  Used by the [Action] spells, the first cards to exercise the Showdown Action Window. */
export function battlefieldUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return allUnits(state)
    .filter((i) => i.zone === "battlefield" && canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

/** Any enemy unit in play the acting player may legally choose (Deflect-aware). */
export function enemyUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return enemyUnits(state, player)
    .filter((i) => canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

/** Enemy units at a battlefield the acting player may legally choose (Deflect-aware). */
export function enemyBattlefieldUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return enemyUnits(state, player)
    .filter((i) => i.zone === "battlefield" && canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

/** Gear in play (both sides). */
export function gearOnBoard(state: GameState): CardInstance[] {
  return gearInPlay(state);
}

/** Gear `player` controls. */
export function friendlyGear(state: GameState, player: PlayerId): CardInstance[] {
  return gearInPlay(state, player);
}

// --- Chain (Counter / gain-control) targeting -------------------------------------------------

/** Spells currently on the Chain (rule 352.8.a.2: "spell" refers to an object on the Chain) — the
 *  legal targets for Counter / gain-control effects. The countering spell itself is already popped
 *  before it resolves, so it is excluded naturally. `predicate` narrows by the target's cost. */
export function chainSpellTargets(state: GameState, predicate?: (def: CardDef) => boolean): InstanceId[] {
  return state.chain
    .filter((c) => c.kind === "spell" && (!predicate || predicate(state.defs[getInstance(state, c.sourceIid).defId]!)))
    .map((c) => c.sourceIid);
}

/** Rule 412: mark the Chain item for the given spell instance countered — it will do nothing and be
 *  trashed (not treated as played) when it reaches the top of the Chain. */
export function counterChainSpell(state: GameState, targetIid: InstanceId | undefined): void {
  if (targetIid === undefined) return;
  const item = state.chain.find((c) => c.sourceIid === targetIid);
  if (item) {
    item.countered = true;
    state.log.push(`${state.defs[getInstance(state, targetIid).defId]!.name} will be countered`);
  }
}
