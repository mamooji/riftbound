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
import { opponentOf, type PlayerId } from "@riftbound/shared";
import { canAfford } from "./resources.js";
import { createToken, SPRITE_TOKEN } from "./tokens.js";
import { drawFromMain, recycleCard, recycleCards } from "./deck.js";
import { updateControl } from "./showdown.js";
import { applyStun, channelRunesExhausted, fireTrigger, register } from "./triggers.js";
import {
  canChooseThroughDeflect,
  effectiveMight,
  getInstance,
  payDeflect,
  unitsAt,
  type CardInstance,
  type GameState,
} from "./state.js";
import {
  anyUnitTargets,
  battlefieldUnitTargets,
  chainSpellTargets,
  counterChainSpell,
  dealDamageToUnit,
  dealDamageToUnitsWhere,
  killUnit,
  playUnitFree,
  returnUnitToHand,
  stealControlAndRecall,
} from "./spellHelpers.js";
import { SPELL_CASTERS } from "./spellsCompound.js";
import {
  BACK_TO_BACK,
  BLAST_OF_POWER,
  BLIND_FURY,
  BLOCK,
  CANNON_BARRAGE,
  CATALYST_OF_AEONS,
  CHARM,
  CLEAVE,
  CONSULT_THE_PAST,
  DECISIVE_STRIKE,
  DEFY,
  DISCIPLINE,
  DISINTEGRATE,
  EN_GARDE,
  FADING_MEMORIES,
  FALLING_COMET,
  FALLING_STAR,
  FIGHT_OR_FLIGHT,
  FINAL_SPARK,
  FIRESTORM,
  FLURRY_OF_BLADES,
  GRAND_STRATEGEM,
  GUST,
  HEXTECH_RAY,
  HIDDEN_BLADE,
  ICATHIAN_RAIN,
  INCINERATE,
  INVERT_TIMELINES,
  LAST_STAND,
  MOBILIZE,
  MYSTIC_REVERSAL,
  POSSESSION,
  PORTAL_RESCUE,
  PRIMAL_STRENGTH,
  PROGRESS_DAY,
  REBUKE,
  REINFORCE,
  RETREAT,
  RUNE_PRISON,
  SABOTAGE,
  SINGULARITY,
  SIPHON_POWER,
  SKY_SPLITTER,
  SMOKE_SCREEN,
  SPRITE_CALL,
  STACKED_DECK,
  STUPEFY,
  SUPER_MEGA_DEATH_ROCKET,
  THE_HARROWING,
  THERMO_BEAM,
  UNCHECKED_POWER,
  UNYIELDING_SPIRIT,
  VENGEANCE,
  VOID_SEEKER,
  WIND_WALL,
} from "./ids.js";
import { friendlyUnits } from "./queries.js";

// Removal/damage/movement primitives and target-enumeration helpers live in spellHelpers.ts
// (imported above), shared with the compound spells in spellsCompound.ts.

// Card ids all live in ids.ts (imported above). Notes on the timing families exercised here:
//  - [Action]-timed spells (Incinerate, Hextech Ray, Primal Strength, ...) are effect-wise no
//    different from sorcery-speed ones (same registry, same `castSpell` dispatch); what's new is
//    WHEN they can be played, gated by `CardDef.timing` in getLegalActions/showdown.ts.
//  - [Reaction] spells (Wind Wall/Defy counter a spell; Mystic Reversal gains control of one;
//    Unyielding Spirit prevents spell/ability damage) and [Hidden] spells (Consult the Past,
//    Hidden Blade, Fight or Flight, Block, Sprite Call) all target/resolve through this same table.

// ---------------------------------------------------------------------------------------------
// Simple single/multi-unit-target damage & removal spells. Each is a plain `TriggerEffect`
// registered in the shared `ALL_TRIGGERS` table and keyed here by defId; `castSpell` dispatches to
// it (for any spell without a compound `SPELL_CASTERS` entry) by firing that trigger.
// ---------------------------------------------------------------------------------------------

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
 *  override `zone` again, e.g. Time Warp banishing itself instead). A compound spell registers a
 *  `SPELL_CASTERS` entry; every plain single-effect spell just registers in `SPELL_EFFECTS`. */
export function castSpell(state: GameState, player: PlayerId, spellInst: CardInstance): void {
  const caster = SPELL_CASTERS[spellInst.defId];
  if (caster) {
    caster(state, player, spellInst);
    return;
  }
  const kind = SPELL_EFFECTS[spellInst.defId];
  if (kind) fireTrigger(state, kind, player, spellInst.iid, undefined);
}
