/**
 * Sorcery-speed spell effects — Phase 1 of the Chain/Priority/Reaction plan (see the approved
 * plan doc). These are exactly the ~26 Set 1 spells that carry neither [Action] nor [Reaction]:
 * playable only during the caster's own Neutral Open Action Phase, resolving immediately the
 * instant they're played — no queue, no response window, same simplification already used
 * everywhere else in this engine (`abilities.ts`, `triggers.ts`). [Action]/[Reaction] spells stay
 * text-only until the real Chain/Priority system (Phase 2+) exists.
 *
 * Reuses `triggers.ts`'s existing `ALL_TRIGGERS`/`pendingTrigger` machinery wholesale — a spell's
 * effect is registered exactly like any other triggered effect (`register`), and `castSpell`
 * dispatches to it from the `"playCard"` spell branch in `actions.ts`. This means the "up to N
 * picks" / "you may" / chained-trigger patterns already proven for units and legends (Kinkou
 * Monk, Undercover Agent, Sett's death-replacement) work for spells with zero new sub-state.
 *
 * A handful of genuinely compound spells (two independent choices, or a full per-player
 * reveal-and-replay sequence) are deliberately left unscripted this pass: Divine Judgment (each
 * player picks 2 units/2 gear/2 runes/2 hand cards), Promising Future (each player reveals top 5,
 * picks one, then all chosen cards get played in sequence), Party Favors (a Cards-vs-Runes MODE
 * choice, not a game-object target — no primitive for that yet), and Dragon's Rage (move to a
 * chosen destination, then target a SECOND unit found there). Flagged here, not silently dropped.
 */
import { opponentOf, type InstanceId, type PlayerId } from "@riftbound/shared";
import { autoPay, canAfford } from "./resources.js";
import { createToken, SPRITE_TOKEN } from "./tokens.js";
import { drawFromMain, recycleCard, recycleCards } from "./deck.js";
import { startShowdown, updateControl, checkWin } from "./showdown.js";
import {
  applyStun,
  channelRunesExhausted,
  fireTrigger,
  onArrival,
  onKillStunnedEnemy,
  onPlayCard,
  onUnitDeath,
  onUnitDeathAtBattlefield,
  register,
} from "./triggers.js";
import {
  canChooseThroughDeflect,
  effectiveMight,
  getInstance,
  giveBuff,
  payDeflect,
  unitsAt,
  type CardDef,
  type CardInstance,
  type GameState,
} from "./state.js";

function friendlyUnits(state: GameState, player: PlayerId): CardInstance[] {
  return Object.values(state.instances).filter(
    (i) => i.controller === player && (i.zone === "base" || i.zone === "battlefield") && state.defs[i.defId]!.type === "unit",
  );
}

function allUnits(state: GameState): CardInstance[] {
  return Object.values(state.instances).filter(
    (i) => (i.zone === "base" || i.zone === "battlefield") && state.defs[i.defId]!.type === "unit",
  );
}

/** Active Kill (rule 415.1.a.1) — no damage math, just removes a permanent from the board. A
 *  small local duplicate of the kill logic already inlined in `showdown.ts`/`triggers.ts`'s death
 *  loops: those two files can't import each other (showdown.ts already imports triggers.ts), and
 *  this file needs BOTH the death hooks AND `updateControl`, so it composes them itself rather
 *  than risk restructuring either existing call site. */
function killUnit(state: GameState, inst: CardInstance): void {
  if (inst.zone !== "base" && inst.zone !== "battlefield") return;
  const bf = inst.battlefield;
  inst.zone = "trash";
  inst.battlefield = null;
  inst.damage = 0;
  state.log.push(`P${inst.controller} loses ${state.defs[inst.defId]!.name}`);
  onUnitDeath(state, inst);
  onKillStunnedEnemy(state, inst);
  if (bf !== null) {
    onUnitDeathAtBattlefield(state, inst, bf);
    updateControl(state, bf);
  }
}

/** Deals damage to a single unit (rule 404 Deal), killing it if lethal (rule 415.1.a.2). Spell/
 *  ability damage is fully prevented while Unyielding Spirit is active (rule 366 replacement). */
function dealDamageToUnit(state: GameState, targetIid: InstanceId, amount: number): void {
  if (state.preventSpellAbilityDamage) return;
  const inst = state.instances[targetIid as number];
  if (!inst || (inst.zone !== "base" && inst.zone !== "battlefield")) return;
  inst.damage += amount;
  if (inst.damage >= effectiveMight(state, inst, undefined)) killUnit(state, inst);
}

/** Deals flat damage to every unit at a battlefield matching `predicate`, killing lethal ones.
 *  Snapshots victims up front so a mid-loop death can't skip/duplicate anyone. */
function dealDamageToUnitsWhere(state: GameState, amount: number, predicate: (inst: CardInstance) => boolean): void {
  if (state.preventSpellAbilityDamage) return;
  const victims = Object.values(state.instances).filter(
    (i) => i.zone === "battlefield" && state.defs[i.defId]!.type === "unit" && predicate(i),
  );
  for (const v of victims) v.damage += amount;
  for (const v of victims) {
    if (v.zone === "battlefield" && v.damage >= effectiveMight(state, v, undefined)) killUnit(state, v);
  }
}

/** Plays a unit-type card that's already off its normal zone (from trash — The Harrowing; from
 *  the Main Deck directly — Reinforce) straight to BASE, paying only its Power cost (Energy is
 *  waived by `energyDiscount`, clamped to 0). Simplified to always land at base rather than
 *  offering a battlefield-placement choice — the same conservative simplification already used
 *  for Yasuo's and Charm's move effects (neither card's text requires a battlefield destination,
 *  and a free base placement is always legal). */
function playUnitFree(state: GameState, player: PlayerId, iid: InstanceId, energyDiscount: number): void {
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
 *  moved unit, duplicated locally since `spells.ts` can't import from `actions.ts` (that would be
 *  the reverse of `actions.ts` importing `spells.ts` to dispatch spell effects — a cycle). */
function moveUnitToBattlefield(state: GameState, inst: CardInstance, battlefield: number): void {
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
function returnUnitToHand(state: GameState, inst: CardInstance): void {
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
function stealControlAndRecall(state: GameState, inst: CardInstance, newController: PlayerId): void {
  const from = inst.zone === "battlefield" ? inst.battlefield : null;
  inst.controller = newController;
  inst.zone = "base";
  inst.battlefield = null;
  if (from !== null) updateControl(state, from);
}

// ---------------------------------------------------------------------------------------------
// Card ids
// ---------------------------------------------------------------------------------------------
const FALLING_STAR = "ogn-029-298";
const CHARM = "ogn-043-298";
const REINFORCE = "ogn-062-298";
const SINGULARITY = "ogn-105-298";
const PROGRESS_DAY = "ogn-114-298";
const TIME_WARP = "ogn-122-298";
const UNCHECKED_POWER = "ogn-123-298";
const MOBILIZE = "ogn-134-298";
const CATALYST_OF_AEONS = "ogn-138-298";
const SABOTAGE = "ogn-156-298";
const FADING_MEMORIES = "ogn-180-298";
const WHIRLWIND = "ogn-187-298";
const THE_HARROWING = "ogn-198-298";
const INVERT_TIMELINES = "ogn-201-298";
const CULL_THE_WEAK = "ogn-209-298";
const VENGEANCE = "ogn-229-298";
const KINGS_EDICT = "ogn-237-298";
const ICATHIAN_RAIN = "ogn-248-298";
const STORMBRINGER = "ogn-250-298";
const SUPER_MEGA_DEATH_ROCKET = "ogn-252-298";
const SHOWSTOPPER = "ogn-270-298";
const FIRESTORM = "ogs-002-024";

// [Action]-timed spells (playable during your own turn OR a Showdown's Action Window) -- proof
// cases for Phase 2's Chain/Priority machinery. Effect-wise these are no different from Phase 1's
// sorcery-speed spells (same registry, same `castSpell` dispatch); what's new is WHEN they can
// legally be played, gated entirely by `CardDef.timing` in `getLegalActions`/`showdow.ts`, not by
// anything here.
const INCINERATE = "ogs-003-024";
const HEXTECH_RAY = "ogn-009-298";
const PRIMAL_STRENGTH = "ogn-154-298";

// More [Action]/[Reaction] spells -- all with REAL, player-driven targeting (never auto-picked;
// this batch specifically closes out the auto-targeting gaps reported in Stormbringer/Showstopper
// above, plus scripts a broad swath of the remaining targeted spells in the corpus).
const CLEAVE = "ogn-004-298";
const DISINTEGRATE = "ogn-005-298";
const SKY_SPLITTER = "ogn-014-298";
const VOID_SEEKER = "ogn-024-298";
const FALLING_COMET = "ogn-085-298";
const BLAST_OF_POWER = "ogs-012-024";
const FINAL_SPARK = "ogs-022-024";
const RUNE_PRISON = "ogn-050-298";
const EN_GARDE = "ogn-046-298";
const DISCIPLINE = "ogn-058-298";
const WIND_WALL = "ogn-064-298"; // [Reaction] Counter a spell.
const DEFY = "ogn-045-298"; // [Reaction] Counter a spell costing <= 4 Energy and <= 1 rainbow.
const MYSTIC_REVERSAL = "ogn-080-298"; // [Reaction] Gain control of a spell.
const UNYIELDING_SPIRIT = "ogn-145-298"; // [Reaction] Prevent all spell and ability damage this turn.
const CONSULT_THE_PAST = "ogn-083-298"; // [Hidden][Reaction] Draw 2.
const HIDDEN_BLADE = "ogn-213-298"; // [Hidden][Action] Kill a unit at a battlefield. Its controller draws 2.
const FIGHT_OR_FLIGHT = "ogn-168-298"; // [Hidden][Action] Move a unit from a battlefield to its base.
const BLOCK = "ogn-057-298"; // [Hidden][Action] Give a unit [Shield 3] and [Tank] this turn.
const SPRITE_CALL = "ogn-094-298"; // [Hidden][Action] Play a ready 3-Might Sprite token with [Temporary].
const SMOKE_SCREEN = "ogn-093-298";
const STUPEFY = "ogn-095-298";
const LAST_STAND = "ogn-069-298";
const RETREAT = "ogn-104-298";
const GUST = "ogn-169-298";
const REBUKE = "ogn-172-298";
const PORTAL_RESCUE = "ogn-102-298";
const POSSESSION = "ogn-203-298";
const CHALLENGE = "ogn-128-298";
const GENTLEMENS_DUEL = "ogs-008-024";
const BACK_TO_BACK = "ogn-206-298";
const CONVERGENT_MUTATION = "ogn-108-298";
const FACEBREAKER = "ogn-220-298";
const ZENITH_BLADE = "ogn-262-298";
const LAST_BREATH = "ogn-260-298";
const SHAKEDOWN = "ogn-033-298";
const SIPHON_POWER = "ogn-266-298";
const CANNON_BARRAGE = "ogn-127-298";
const FLURRY_OF_BLADES = "ogn-133-298";
const GET_EXCITED = "ogn-008-298";
const BLIND_FURY = "ogn-025-298";
const STACKED_DECK = "ogn-183-298";
const THERMO_BEAM = "ogn-022-298";
const GRAND_STRATEGEM = "ogn-233-298";
const DECISIVE_STRIKE = "ogs-024-024";
const SALVAGE = "ogn-224-298";
const ACCEPTABLE_LOSSES = "ogn-179-298";
const MEDITATION = "ogn-048-298";

// ---------------------------------------------------------------------------------------------
// Simple single/multi-unit-target damage & removal spells
// ---------------------------------------------------------------------------------------------

function anyUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return allUnits(state)
    .filter((i) => canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

/** Spells currently on the Chain (rule 352.8.a.2: "spell" refers to an object on the Chain) — the
 *  legal targets for Counter / gain-control effects. The countering spell itself is already popped
 *  before it resolves, so it is excluded naturally. `predicate` narrows by the target's cost. */
function chainSpellTargets(state: GameState, predicate?: (def: CardDef) => boolean): InstanceId[] {
  return state.chain
    .filter((c) => c.kind === "spell" && (!predicate || predicate(state.defs[getInstance(state, c.sourceIid).defId]!)))
    .map((c) => c.sourceIid);
}

/** Rule 412: mark the Chain item for the given spell instance countered — it will do nothing and be
 *  trashed (not treated as played) when it reaches the top of the Chain. */
function counterChainSpell(state: GameState, targetIid: InstanceId | undefined): void {
  if (targetIid === undefined) return;
  const item = state.chain.find((c) => c.sourceIid === targetIid);
  if (item) {
    item.countered = true;
    state.log.push(`${state.defs[getInstance(state, targetIid).defId]!.name} will be countered`);
  }
}

/** "...a unit at a battlefield" -- narrower than `anyUnitTargets`, excludes units still at base.
 *  Used by the [Action] spells below, which are the first cards to actually exercise the Showdown
 *  Action Window (rule 340-345, `showdown.ts`'s `advanceActionWindow`/`passActionWindow`). */
function battlefieldUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return allUnits(state)
    .filter((i) => i.zone === "battlefield" && canChooseThroughDeflect(state, player, i))
    .map((i) => i.iid);
}

const SPELL_EFFECTS: Record<string, string> = {
  // Falling Star: Deal 3 to a unit. Deal 3 to a unit. -- two independent instructions, so the
  // same unit may legally be chosen for both (unlike Singularity's "each of up to two units",
  // which picks a SET of distinct units).
  [FALLING_STAR]: register(`spell:${FALLING_STAR}`, {
    mandatory: true,
    maxPicks: 2,
    allowRepeatTargets: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 3);
    },
  }),

  // Singularity: Deal 6 to each of up to two units.
  [SINGULARITY]: register(`spell:${SINGULARITY}`, {
    mandatory: true,
    maxPicks: 2,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 6);
    },
  }),

  // Icathian Rain: Deal 2 to a unit, six times over -- same repeatable-target reasoning as Falling
  // Star.
  [ICATHIAN_RAIN]: register(`spell:${ICATHIAN_RAIN}`, {
    mandatory: true,
    maxPicks: 6,
    allowRepeatTargets: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 2);
    },
  }),

  // Super Mega Death Rocket!: Deal 5 to a unit. (Its "return me from trash" half is a separate
  // on-conquer-from-trash hook registered in triggers.ts, keyed to the same card id.)
  [SUPER_MEGA_DEATH_ROCKET]: register(`spell:${SUPER_MEGA_DEATH_ROCKET}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 5);
    },
  }),

  // Vengeance: Kill a unit.
  [VENGEANCE]: register(`spell:${VENGEANCE}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      killUnit(state, target);
    },
  }),

  // Charm: Move an enemy unit. Simplified to the retreat direction only (battlefield -> base) --
  // same documented simplification already used for Yasuo's legend ability.
  [CHARM]: register(`spell:${CHARM}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter(
          (i) =>
            i.zone === "battlefield" &&
            i.controller !== player &&
            state.defs[i.defId]!.type === "unit" &&
            canChooseThroughDeflect(state, player, i),
        )
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      const from = target.battlefield;
      target.zone = "base";
      target.battlefield = null;
      if (from !== null) updateControl(state, from);
      state.log.push(`P${player} moves ${state.defs[target.defId]!.name} to base (Charm)`);
    },
  }),

  // Fading Memories: Give a unit at a battlefield or a gear [Temporary].
  [FADING_MEMORIES]: register(`spell:${FADING_MEMORIES}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter((i) => {
          const isUnitAtBf = i.zone === "battlefield" && state.defs[i.defId]!.type === "unit";
          const isGear = i.zone === "base" && state.defs[i.defId]!.type === "gear";
          return (isUnitAtBf || isGear) && canChooseThroughDeflect(state, player, i);
        })
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.temporary = true;
      state.log.push(`${state.defs[target.defId]!.name} becomes [Temporary] (Fading Memories)`);
    },
  }),

  // Progress Day: Draw 4.
  [PROGRESS_DAY]: register(`spell:${PROGRESS_DAY}`, {
    mandatory: true,
    resolve: (state, player) => {
      for (let i = 0; i < 4; i++) drawFromMain(state, player);
    },
  }),

  // Unchecked Power: Exhaust all friendly units, then deal 12 to ALL units at battlefields.
  [UNCHECKED_POWER]: register(`spell:${UNCHECKED_POWER}`, {
    mandatory: true,
    resolve: (state, player) => {
      for (const u of friendlyUnits(state, player)) u.exhausted = true;
      dealDamageToUnitsWhere(state, 12, () => true);
    },
  }),

  // Firestorm: Deal 3 to all enemy units at a battlefield -- a real battlefield choice.
  [FIRESTORM]: register(`spell:${FIRESTORM}`, {
    mandatory: true,
    legalBattlefields: (state, player) =>
      state.battlefields
        .filter((bf) => unitsAt(state, bf.index, opponentOf(player)).length > 0)
        .map((bf) => bf.index),
    resolve: (state, player, _source, _target, battlefield) => {
      if (battlefield === undefined) return;
      dealDamageToUnitsWhere(state, 3, (i) => i.battlefield === battlefield && i.controller !== player);
    },
  }),

  // Mobilize: Channel 1 rune exhausted. If you can't, draw 1.
  [MOBILIZE]: register(`spell:${MOBILIZE}`, {
    mandatory: true,
    resolve: (state, player) => {
      if (channelRunesExhausted(state, player, 1) < 1) drawFromMain(state, player);
    },
  }),

  // Catalyst of Aeons: Channel 2 runes exhausted. If you couldn't channel 2 this way, draw 1.
  [CATALYST_OF_AEONS]: register(`spell:${CATALYST_OF_AEONS}`, {
    mandatory: true,
    resolve: (state, player) => {
      if (channelRunesExhausted(state, player, 2) < 2) drawFromMain(state, player);
    },
  }),

  // Sabotage: Choose an opponent. They reveal their hand. Choose a non-unit card from it and
  // recycle it. (1v1: "an opponent" is trivially the one opponent.)
  [SABOTAGE]: register(`spell:${SABOTAGE}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      state.players[opponentOf(player)].hand.filter((iid) => state.defs[getInstance(state, iid).defId]!.type !== "unit"),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) recycleCard(state, targetIid);
    },
  }),

  // The Harrowing: Play a unit from your trash, ignoring its Energy cost.
  [THE_HARROWING]: register(`spell:${THE_HARROWING}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter(
          (i) =>
            i.owner === player &&
            i.zone === "trash" &&
            state.defs[i.defId]!.type === "unit" &&
            canAfford(state, player, 0, state.defs[i.defId]!.power),
        )
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const def = state.defs[getInstance(state, targetIid).defId]!;
      playUnitFree(state, player, targetIid, def.energy);
    },
  }),

  // Invert Timelines: Each player discards their hand, then draws 4.
  [INVERT_TIMELINES]: register(`spell:${INVERT_TIMELINES}`, {
    mandatory: true,
    resolve: (state) => {
      for (const p of state.players) {
        for (const iid of p.hand) getInstance(state, iid).zone = "trash";
        p.hand = [];
      }
      for (const p of state.players) {
        for (let i = 0; i < 4; i++) drawFromMain(state, p.id);
      }
    },
  }),

  // Reinforce: Look at the top 5 of your Main Deck. You may banish a unit from among them, then
  // play it (5 Energy cheaper). Recycle the remaining cards.
  [REINFORCE]: register(`spell:${REINFORCE}`, {
    mandatory: false, // "you may banish a unit..."
    legalTargets: (state, player) =>
      state.players[player].mainDeck
        .slice(0, 5)
        .filter((iid) => state.defs[getInstance(state, iid).defId]!.type === "unit"),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const p = state.players[player];
      const top5 = p.mainDeck.slice(0, 5);
      const rest = top5.filter((iid) => iid !== targetIid);
      p.mainDeck = p.mainDeck.filter((iid) => !top5.includes(iid));
      playUnitFree(state, player, targetIid, 5);
      recycleCards(state, player, rest);
    },
    onComplete: (state, player, _source, picked) => {
      if (picked.length > 0) return; // resolve() already handled banish + play + recycle
      const p = state.players[player];
      const top5 = p.mainDeck.slice(0, 5);
      p.mainDeck = p.mainDeck.filter((iid) => !top5.includes(iid));
      recycleCards(state, player, top5);
    },
  }),

  // Incinerate: Deal 2 to a unit at a battlefield.
  [INCINERATE]: register(`spell:${INCINERATE}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 2);
    },
  }),

  // Consult the Past ([Hidden][Reaction]): Draw 2.
  [CONSULT_THE_PAST]: register(`spell:${CONSULT_THE_PAST}`, {
    mandatory: true,
    resolve: (state, player) => {
      drawFromMain(state, player);
      drawFromMain(state, player);
    },
  }),

  // Hidden Blade ([Hidden][Action]): Kill a unit at a battlefield. Its controller draws 2.
  [HIDDEN_BLADE]: register(`spell:${HIDDEN_BLADE}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      const controller = target.controller;
      killUnit(state, target);
      drawFromMain(state, controller);
      drawFromMain(state, controller);
    },
  }),

  // Fight or Flight ([Hidden][Action]): Move a unit from a battlefield to its base.
  [FIGHT_OR_FLIGHT]: register(`spell:${FIGHT_OR_FLIGHT}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      const from = target.battlefield;
      target.zone = "base";
      target.battlefield = null;
      if (from !== null) updateControl(state, from);
    },
  }),

  // Block ([Hidden][Action]): Give a unit [Shield 3] and [Tank] this turn.
  [BLOCK]: register(`spell:${BLOCK}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.shieldThisTurn += 3;
      target.tankThisTurn = true;
    },
  }),

  // Sprite Call ([Hidden][Action]): Play a ready 3-Might Sprite token with [Temporary].
  [SPRITE_CALL]: register(`spell:${SPRITE_CALL}`, {
    mandatory: true,
    resolve: (state, player) => {
      createToken(state, player, SPRITE_TOKEN, "base", null, /* ready */ true);
    },
  }),

  // Hextech Ray: Deal 3 to a unit at a battlefield.
  [HEXTECH_RAY]: register(`spell:${HEXTECH_RAY}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 3);
    },
  }),

  // Primal Strength: Give a unit +7 Might this turn. Deliberately NOT restricted to "at a
  // battlefield" (matches its own text) -- proves the Action Window's totals are computed FRESH at
  // close time (rule 345), since a Might change here must be reflected once combat math runs.
  [PRIMAL_STRENGTH]: register(`spell:${PRIMAL_STRENGTH}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.tempMightDelta += 7;
    },
  }),

  // Cleave: Give a unit [Assault 3] this turn.
  [CLEAVE]: register(`spell:${CLEAVE}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.assaultThisTurn += 3;
    },
  }),

  // Disintegrate: Deal 3 to a unit at a battlefield. If this kills it, draw 1.
  [DISINTEGRATE]: register(`spell:${DISINTEGRATE}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 3);
      if (getInstance(state, targetIid).zone === "trash") drawFromMain(state, player);
    },
  }),

  // Sky Splitter: this spell's Energy cost is reduced by the highest Might among units you control
  // (see costModifiers.ts). Deal 5 to a unit at a battlefield.
  [SKY_SPLITTER]: register(`spell:${SKY_SPLITTER}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 5);
    },
  }),

  // Void Seeker: Deal 4 to a unit at a battlefield. Draw 1.
  [VOID_SEEKER]: register(`spell:${VOID_SEEKER}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 4);
      drawFromMain(state, player);
    },
  }),

  // Falling Comet: Deal 6 to a unit at a battlefield.
  [FALLING_COMET]: register(`spell:${FALLING_COMET}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 6);
    },
  }),

  // Blast of Power: Kill a unit at a battlefield.
  [BLAST_OF_POWER]: register(`spell:${BLAST_OF_POWER}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      killUnit(state, target);
    },
  }),

  // Final Spark: Deal 8 to a unit. NOT restricted to "at a battlefield" (matches its own text).
  [FINAL_SPARK]: register(`spell:${FINAL_SPARK}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      dealDamageToUnit(state, targetIid, 8);
    },
  }),

  // Rune Prison: Stun a unit. NOT restricted to "at a battlefield" (matches its own text).
  [RUNE_PRISON]: register(`spell:${RUNE_PRISON}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      applyStun(state, targetIid, player);
    },
  }),

  // En Garde: Give a friendly unit +1 Might this turn, then an additional +1 Might this turn if
  // it is the only unit you control there (checked fresh at resolve time).
  [EN_GARDE]: register(`spell:${EN_GARDE}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      target.tempMightDelta += 1;
      const alone = Object.values(state.instances).every(
        (i) =>
          i.iid === target.iid ||
          i.controller !== target.controller ||
          i.zone !== target.zone ||
          (target.zone === "battlefield" && i.battlefield !== target.battlefield) ||
          state.defs[i.defId]!.type !== "unit",
      );
      if (alone) target.tempMightDelta += 1;
    },
  }),

  // Discipline: Give a unit +2 Might this turn. Draw 1.
  [DISCIPLINE]: register(`spell:${DISCIPLINE}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.tempMightDelta += 2;
      drawFromMain(state, player);
    },
  }),

  // Wind Wall: Counter a spell. Targets a spell on the Chain (rule 352.8.a.2) — any spell instance
  // currently in the `chain` zone other than Wind Wall itself (already popped by the time this
  // resolves, so it's excluded naturally). Marks its Chain item countered (rule 412): it does
  // nothing and is trashed, not treated as played, when it reaches the top.
  [WIND_WALL]: register(`spell:${WIND_WALL}`, {
    mandatory: true,
    legalTargets: (state) => chainSpellTargets(state),
    resolve: (state, _player, _source, targetIid) => counterChainSpell(state, targetIid),
  }),

  // Defy: Counter a spell that costs no more than 4 Energy and no more than 1 rainbow (Power).
  [DEFY]: register(`spell:${DEFY}`, {
    mandatory: true,
    legalTargets: (state) =>
      chainSpellTargets(state, (def) => def.energy <= 4 && def.power <= 1),
    resolve: (state, _player, _source, targetIid) => counterChainSpell(state, targetIid),
  }),

  // Mystic Reversal: Gain control of a spell. You may make new choices for it. Reassigns the Chain
  // item's controller to the caster; since a spell's targets are chosen as it resolves, the new
  // controller makes all of its choices when it reaches the top (rule 182.2.a).
  [MYSTIC_REVERSAL]: register(`spell:${MYSTIC_REVERSAL}`, {
    mandatory: true,
    legalTargets: (state) => chainSpellTargets(state),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const item = state.chain.find((c) => c.sourceIid === targetIid);
      if (item) {
        item.controller = player;
        getInstance(state, targetIid).controller = player;
        state.log.push(`P${player} gains control of ${state.defs[getInstance(state, targetIid).defId]!.name}`);
      }
    },
  }),

  // Unyielding Spirit: Prevent all spell and ability damage this turn. Sets a turn-scoped flag the
  // damage helpers honor; combat damage (which never routes through them) is unaffected.
  [UNYIELDING_SPIRIT]: register(`spell:${UNYIELDING_SPIRIT}`, {
    mandatory: true,
    resolve: (state) => {
      state.preventSpellAbilityDamage = true;
      state.log.push("Spell and ability damage is prevented this turn (Unyielding Spirit)");
    },
  }),

  // Smoke Screen: Give a unit -4 Might this turn, to a minimum of 1 (effectiveMight already
  // clamps its overall result to >=1, so no extra clamping logic is needed here).
  [SMOKE_SCREEN]: register(`spell:${SMOKE_SCREEN}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.tempMightDelta -= 4;
    },
  }),

  // Stupefy: Give a unit -1 Might this turn, to a minimum of 1. Draw 1.
  [STUPEFY]: register(`spell:${STUPEFY}`, {
    mandatory: true,
    legalTargets: anyUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      target.tempMightDelta -= 1;
      drawFromMain(state, player);
    },
  }),

  // Last Stand: Double a friendly unit's Might this turn. Give it [Temporary].
  [LAST_STAND]: register(`spell:${LAST_STAND}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      target.tempMightDelta += state.defs[target.defId]!.might;
      target.temporary = true;
    },
  }),

  // Retreat: Return a friendly unit to its owner's hand. Its owner channels 1 rune exhausted.
  [RETREAT]: register(`spell:${RETREAT}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      const owner = target.owner;
      returnUnitToHand(state, target);
      channelRunesExhausted(state, owner, 1);
    },
  }),

  // Gust: Return a unit at a battlefield with 3 Might or less to its owner's hand.
  [GUST]: register(`spell:${GUST}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter(
          (i) =>
            i.zone === "battlefield" &&
            state.defs[i.defId]!.type === "unit" &&
            effectiveMight(state, i, undefined) <= 3 &&
            canChooseThroughDeflect(state, player, i),
        )
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      returnUnitToHand(state, target);
    },
  }),

  // Rebuke: Return a unit at a battlefield to its owner's hand.
  [REBUKE]: register(`spell:${REBUKE}`, {
    mandatory: true,
    legalTargets: battlefieldUnitTargets,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      returnUnitToHand(state, target);
    },
  }),

  // Portal Rescue: Banish a friendly unit, then play it to base, ignoring its cost. (A defensive
  // trick: pull a unit about to die in an active Showdown out of danger and replay it fresh.)
  [PORTAL_RESCUE]: register(`spell:${PORTAL_RESCUE}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const inst = getInstance(state, targetIid);
      const from = inst.zone === "battlefield" ? inst.battlefield : null;
      const def = state.defs[inst.defId]!;
      inst.zone = "banishment";
      inst.battlefield = null;
      if (from !== null) updateControl(state, from);
      playUnitFree(state, player, targetIid, def.energy);
    },
  }),

  // Possession: Choose an enemy unit at a battlefield. Take control of it and recall it.
  [POSSESSION]: register(`spell:${POSSESSION}`, {
    mandatory: true,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter(
          (i) =>
            i.zone === "battlefield" &&
            i.controller !== player &&
            state.defs[i.defId]!.type === "unit" &&
            canChooseThroughDeflect(state, player, i),
        )
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const target = getInstance(state, targetIid);
      payDeflect(state, player, target);
      stealControlAndRecall(state, target, player);
    },
  }),

  // Cannon Barrage: Deal 2 to all enemy units in combat (i.e. at the battlefield of the currently
  // active Showdown, if any -- this engine only ever has one Showdown active at a time).
  [CANNON_BARRAGE]: register(`spell:${CANNON_BARRAGE}`, {
    mandatory: true,
    resolve: (state, player) => {
      const sd = state.showdown;
      if (!sd) return;
      dealDamageToUnitsWhere(state, 2, (i) => i.battlefield === sd.battlefield && i.controller !== player);
    },
  }),

  // Flurry of Blades: Deal 1 to all units at battlefields (both sides, everywhere).
  [FLURRY_OF_BLADES]: register(`spell:${FLURRY_OF_BLADES}`, {
    mandatory: true,
    resolve: (state) => {
      dealDamageToUnitsWhere(state, 1, () => true);
    },
  }),

  // Thermo Beam: Kill all gear (BOTH sides -- the card doesn't say "enemy").
  [THERMO_BEAM]: register(`spell:${THERMO_BEAM}`, {
    mandatory: true,
    resolve: (state) => {
      const gear = Object.values(state.instances).filter(
        (i) => i.zone === "base" && state.defs[i.defId]!.type === "gear",
      );
      for (const g of gear) killUnit(state, g);
    },
  }),

  // Grand Strategem: Give friendly units +5 Might this turn (all of them, no choice needed).
  [GRAND_STRATEGEM]: register(`spell:${GRAND_STRATEGEM}`, {
    mandatory: true,
    resolve: (state, player) => {
      for (const u of friendlyUnits(state, player)) u.tempMightDelta += 5;
    },
  }),

  // Decisive Strike: Give friendly units +2 Might this turn (all of them, no choice needed).
  [DECISIVE_STRIKE]: register(`spell:${DECISIVE_STRIKE}`, {
    mandatory: true,
    resolve: (state, player) => {
      for (const u of friendlyUnits(state, player)) u.tempMightDelta += 2;
    },
  }),

  // Back to Back: Give TWO friendly units each +2 Might this turn -- a distinct pair (default
  // dedup, NOT allowRepeatTargets), unlike Falling Star's two independent, repeatable "deal 3"s.
  [BACK_TO_BACK]: register(`spell:${BACK_TO_BACK}`, {
    mandatory: true,
    maxPicks: 2,
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) getInstance(state, targetIid).tempMightDelta += 2;
    },
  }),

  // Siphon Power: Choose a battlefield. Friendly units there +1 Might this turn; enemy units
  // there -1 Might this turn (min 1, handled by effectiveMight's own overall clamp).
  [SIPHON_POWER]: register(`spell:${SIPHON_POWER}`, {
    mandatory: true,
    legalBattlefields: (state) => state.battlefields.map((bf) => bf.index),
    resolve: (state, player, _source, _target, battlefield) => {
      if (battlefield === undefined) return;
      for (const u of unitsAt(state, battlefield, player)) u.tempMightDelta += 1;
      for (const u of unitsAt(state, battlefield, opponentOf(player))) u.tempMightDelta -= 1;
    },
  }),

  // Blind Fury: each opponent reveals the top card of their Main Deck (1v1: just the one
  // opponent); choose one (trivial with a single candidate) and banish it, then play it ignoring
  // its cost. The CASTER becomes its controller (rule 182.1 -- playing a card makes you its
  // controller); its owner stays the original player (rule 174/126). Documented simplification:
  // only a revealed UNIT can be "played" this way (matches The Harrowing/Reinforce's existing
  // units-only scope for reveal-then-play effects) -- "recycle the rest" is a no-op in 1v1 since
  // only one card is ever revealed.
  [BLIND_FURY]: register(`spell:${BLIND_FURY}`, {
    mandatory: true,
    legalTargets: (state, player) => {
      const top = state.players[opponentOf(player)]!.mainDeck[0];
      if (top === undefined) return [];
      return state.defs[getInstance(state, top).defId]!.type === "unit" ? [top] : [];
    },
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const opp = state.players[opponentOf(player)]!;
      opp.mainDeck = opp.mainDeck.filter((iid) => iid !== targetIid);
      const inst = getInstance(state, targetIid);
      inst.zone = "banishment";
      inst.controller = player;
      playUnitFree(state, player, targetIid, state.defs[inst.defId]!.energy);
    },
  }),

  // Stacked Deck: look at the top 3 of your Main Deck, put 1 in hand, recycle the rest.
  [STACKED_DECK]: register(`spell:${STACKED_DECK}`, {
    mandatory: true,
    legalTargets: (state, player) => state.players[player].mainDeck.slice(0, 3),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const p = state.players[player];
      const top3 = p.mainDeck.slice(0, 3);
      const rest = top3.filter((iid) => iid !== targetIid);
      p.mainDeck = p.mainDeck.filter((iid) => !top3.includes(iid));
      getInstance(state, targetIid).zone = "hand";
      p.hand.push(targetIid);
      recycleCards(state, player, rest);
    },
  }),
};

export { SPELL_EFFECTS };

/** Dispatches a just-played spell's effect. Called from `actions.ts`'s `"playCard"` spell branch,
 *  right after the card is placed in the trash (the default; a handful of resolve callbacks
 *  override `zone` again, e.g. Time Warp banishing itself instead). */
export function castSpell(state: GameState, player: PlayerId, spellInst: CardInstance): void {
  if (spellInst.defId === CULL_THE_WEAK) {
    fireTrigger(state, CULL_OPPONENT_KIND, opponentOf(player), spellInst.iid, undefined);
    return;
  }
  if (spellInst.defId === KINGS_EDICT) {
    fireTrigger(state, KINGS_EDICT_KIND, opponentOf(player), spellInst.iid, undefined);
    return;
  }
  if (spellInst.defId === WHIRLWIND) {
    fireTrigger(state, WHIRLWIND_OPPONENT_KIND, opponentOf(player), spellInst.iid, undefined);
    return;
  }
  if (spellInst.defId === TIME_WARP) {
    state.players[player].extraTurns += 1;
    spellInst.zone = "banishment";
    state.log.push(`P${player} takes another turn (Time Warp)`);
    return;
  }
  if (spellInst.defId === STORMBRINGER) {
    resolveStormbringer(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === SHOWSTOPPER) {
    resolveShowstopper(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === SALVAGE) {
    // "Draw 1" always happens; "you may kill a gear" is a genuine may -- special-cased so a lone
    // candidate still offers a real decline, which the generic mandatory:true/false dispatch can't
    // do (mandatory:true auto-forces a single candidate; mandatory:false silently skips the
    // guaranteed draw when there are 0 candidates). See Meditation below for the same shape.
    drawFromMain(state, player);
    if (gearOnBoard(state).length > 0) fireTrigger(state, SALVAGE_KILL_KIND, player, spellInst.iid, undefined);
    return;
  }
  if (spellInst.defId === MEDITATION) {
    const readyFriendlyUnits = friendlyUnits(state, player).filter((i) => !i.exhausted);
    if (readyFriendlyUnits.length === 0) {
      drawFromMain(state, player); // nothing to exhaust -- just draw 1
    } else {
      fireTrigger(state, MEDITATION_KIND, player, spellInst.iid, undefined);
    }
    return;
  }
  if (spellInst.defId === ACCEPTABLE_LOSSES) {
    fireTrigger(state, ACCEPTABLE_LOSSES_OPPONENT_KIND, opponentOf(player), spellInst.iid, undefined);
    return;
  }
  if (spellInst.defId === CHALLENGE) {
    resolveChallenge(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === GENTLEMENS_DUEL) {
    resolveGentlemensDuel(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === CONVERGENT_MUTATION) {
    resolveConvergentMutation(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === FACEBREAKER) {
    resolveFacebreaker(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === ZENITH_BLADE) {
    resolveZenithBlade(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === LAST_BREATH) {
    resolveLastBreath(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === GET_EXCITED) {
    resolveGetExcited(state, player, spellInst.iid);
    return;
  }
  if (spellInst.defId === SHAKEDOWN) {
    resolveShakedown(state, player, spellInst.iid);
    return;
  }
  const kind = SPELL_EFFECTS[spellInst.defId];
  if (kind) fireTrigger(state, kind, player, spellInst.iid, undefined);
}

function gearOnBoard(state: GameState): CardInstance[] {
  return Object.values(state.instances).filter((i) => i.zone === "base" && state.defs[i.defId]!.type === "gear");
}

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

function friendlyGear(state: GameState, player: PlayerId): CardInstance[] {
  return Object.values(state.instances).filter(
    (i) => i.controller === player && i.zone === "base" && state.defs[i.defId]!.type === "gear",
  );
}

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

function enemyUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return Object.values(state.instances)
    .filter(
      (i) =>
        (i.zone === "base" || i.zone === "battlefield") &&
        i.controller !== player &&
        state.defs[i.defId]!.type === "unit" &&
        canChooseThroughDeflect(state, player, i),
    )
    .map((i) => i.iid);
}

function enemyBattlefieldUnitTargets(state: GameState, player: PlayerId): InstanceId[] {
  return Object.values(state.instances)
    .filter(
      (i) =>
        i.zone === "battlefield" &&
        i.controller !== player &&
        state.defs[i.defId]!.type === "unit" &&
        canChooseThroughDeflect(state, player, i),
    )
    .map((i) => i.iid);
}

/** Mutual-damage resolution shared by Challenge and Gentlemen's Duel: `sourceIid` is the
 *  previously-picked friendly unit, `targetIid` the just-picked enemy one -- both amounts are
 *  computed BEFORE either is applied (simultaneous, not sequential, so neither side "strikes
 *  first" and a death from one hit can't change the other's damage amount). */
function mutualMightDamage(state: GameState, player: PlayerId, friendlyIid: InstanceId, enemyIid: InstanceId): void {
  const friendly = getInstance(state, friendlyIid);
  const enemy = getInstance(state, enemyIid);
  payDeflect(state, player, enemy);
  const friendlyMight = effectiveMight(state, friendly, undefined);
  const enemyMight = effectiveMight(state, enemy, undefined);
  dealDamageToUnit(state, friendlyIid, enemyMight);
  dealDamageToUnit(state, enemyIid, friendlyMight);
}

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
