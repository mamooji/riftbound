/**
 * The action interface — the single contract shared by the UI, the bot, and self-play.
 *
 *   getLegalActions(state, player) -> Action[]      enumerable, discrete
 *   applyAction(state, action)     -> GameState     pure (Immer), validated
 *   isTerminal(state)              -> boolean
 *   getReward(state, player)       -> number        +1 win / -1 loss / 0 draw|ongoing
 *
 * Covers Set 1 mechanics: a pre-game mulligan, playing cards (from hand or the Champion Zone,
 * paid from the rune pool, to base OR directly to a battlefield you already control — the base
 * placement rule), floating Energy/Power, moving one or more units together — Standard Move:
 * base<->battlefield in EITHER direction (advancing or retreating); [Ganking] units may also go
 * battlefield->battlefield directly — Showdowns with assigned damage, and ending the turn.
 * Per-card scripted abilities are not yet implemented.
 */
import { opponentOf, type PlayerId } from "@riftbound/shared";
import { produce } from "immer";
import { drawFromMain, endOfTurnPhase, startTurn } from "./setup.js";
import { autoPay, canAfford, canAffordAccelerate, floatEnergy, floatPower, spendRuneOfColor } from "./resources.js";
import {
  advanceShowdown,
  assignToTarget,
  availableTargets,
  checkWin,
  needsAssignment,
  passActionWindow,
  playableSpellIids,
  startShowdown,
  updateControl,
} from "./showdown.js";
import { ABILITIES, canActivate, payActivationCost } from "./abilities.js";
import { advanceChain, passPriority, pushSpellToChain } from "./chain.js";
import { effectivePlayCost } from "./costModifiers.js";
import { ALL_TRIGGERS, onArrival, onPlayCard, resolvePendingTrigger } from "./triggers.js";
import { getInstance, hasGanking, unitsAt, windowIsOpen, type CardDef, type CardInstance, type GameState } from "./state.js";
import type { InstanceId } from "@riftbound/shared";

const MAX_PLIES = 6000;
const MAX_MULLIGAN = 2;
const HIDE_COST_POWER = 1; // [Hidden]: hide facedown for one rainbow rune (rule 727.1.b) = 1 Power

/** Whether a facedown [Hidden] card already occupies `battlefield` (rule 727.1.b: at most one). */
function hasFacedownAt(state: GameState, battlefield: number): boolean {
  return Object.values(state.instances).some(
    (i) => i.zone === "facedown" && i.battlefield === battlefield,
  );
}

/** Rule 322.5: a facedown [Hidden] card whose battlefield its controller no longer controls is
 *  discarded to its owner's Trash. Called after control can change. */
function cleanupHiddenCards(state: GameState): void {
  for (const inst of Object.values(state.instances)) {
    if (inst.zone !== "facedown") continue;
    const bf = inst.battlefield;
    if (bf === null || state.battlefields[bf]?.controller !== inst.controller) {
      inst.zone = "trash";
      inst.battlefield = null;
      inst.hiddenOnTurn = null;
      state.log.push(`P${inst.controller}'s hidden card is discarded`);
    }
  }
}

export type Action =
  | { type: "playCard"; iid: number; battlefield?: number; accelerate?: boolean }
  | { type: "floatEnergy"; runeIid: number }
  | { type: "floatPower"; runeIid: number }
  | { type: "moveUnits"; iids: number[]; to: number | "base" }
  | { type: "assignDamage"; targetIid: number }
  | { type: "activateAbility"; sourceIid: number; targetIid?: number }
  | { type: "resolveTrigger"; accept: boolean; targetIid?: number; battlefield?: number }
  | { type: "mulligan"; iids: number[] }
  | { type: "hide"; iid: number; battlefield: number }
  | { type: "pass" }
  | { type: "endTurn" };

export function isTerminal(state: GameState): boolean {
  return state.winner !== null;
}

export function getReward(state: GameState, player: PlayerId): number {
  if (state.winner === null || state.winner === "draw") return 0;
  return state.winner === player ? 1 : -1;
}

/** Every subset of `items` with size 0..maxSize (small inputs only — used for a 4-card hand). */
function subsetsUpTo<T>(items: readonly T[], maxSize: number): T[][] {
  const results: T[][] = [[]];
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    if (bits > maxSize) continue;
    const subset: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(items[i]!);
    results.push(subset);
  }
  return results;
}

/**
 * Battlefields a unit could be PLAYED to directly (base rule: any battlefield you already
 * control/occupy — i.e. you have a unit there — plus, for a `playToOpenBattlefield` card, any
 * battlefield with no units from either player). Playing to base is always separately legal and
 * isn't included here.
 */
function playableBattlefields(state: GameState, player: PlayerId, def: CardDef): number[] {
  const out: number[] = [];
  for (const bf of state.battlefields) {
    const mine = unitsAt(state, bf.index, player).length;
    const theirs = unitsAt(state, bf.index, opponentOf(player)).length;
    if (mine > 0 || (def.playToOpenBattlefield && mine === 0 && theirs === 0)) {
      out.push(bf.index);
    }
  }
  return out;
}

/** Rule 727: facedown [Hidden] cards `player` may play right now — hidden on an earlier turn (so
 *  they've gained [Reaction]) and still at a battlefield the player controls. They ignore their base
 *  cost, so affordability is not a gate. Playable wherever a [Reaction] is legal. */
function hiddenPlayableIids(state: GameState, player: PlayerId): number[] {
  return Object.values(state.instances)
    .filter(
      (i) =>
        i.zone === "facedown" &&
        i.controller === player &&
        i.hiddenOnTurn !== null &&
        state.turn > i.hiddenOnTurn &&
        i.battlefield !== null &&
        state.battlefields[i.battlefield]?.controller === player,
    )
    .map((i) => i.iid as number);
}

export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (isTerminal(state)) return [];

  // Pre-game mulligan: only the pending seat has a decision (any subset of up to 2 cards).
  if (state.mulligan.pending !== null) {
    if (player !== state.mulligan.pending) return [];
    const hand = state.players[player].hand as unknown as number[];
    return subsetsUpTo(hand, MAX_MULLIGAN).map((iids) => ({ type: "mulligan" as const, iids }));
  }

  // An optional/choice-needing trigger is awaiting its decision: only the deciding player moves.
  if (state.pendingTrigger !== null) {
    const pending = state.pendingTrigger;
    if (player !== pending.player) return [];
    const spec = ALL_TRIGGERS[pending.kind]!;
    const out: Action[] = [{ type: "resolveTrigger", accept: false }];
    if (spec.legalBattlefields) {
      for (const bf of spec.legalBattlefields(state, player, pending.sourceIid)) {
        out.push({ type: "resolveTrigger", accept: true, battlefield: bf });
      }
    } else if (spec.legalTargets) {
      let legal = spec.legalTargets(state, player, pending.sourceIid);
      if (!spec.allowRepeatTargets) legal = legal.filter((t) => !pending.picked.includes(t));
      for (const t of legal) out.push({ type: "resolveTrigger", accept: true, targetIid: t as number });
    } else {
      out.push({ type: "resolveTrigger", accept: true });
    }
    return out;
  }

  // A Closed State (rule 309.1): a Chain exists and items are awaiting resolution. Only the Priority
  // holder may act, and only by playing a [Reaction] spell (rule 309.1.a) or passing. Checked before
  // the Showdown Action Window because a Showdown Closed State is the stricter of the two.
  if (state.chain.length > 0) {
    if (player !== state.priority) return [];
    const out: Action[] = [{ type: "pass" }];
    for (const iid of playableSpellIids(state, player, /* reactionOnly */ true)) {
      out.push({ type: "playCard", iid });
    }
    // Facedown [Hidden] cards are [Reaction] and may be played in response too (rule 727.6).
    for (const iid of hiddenPlayableIids(state, player)) out.push({ type: "playCard", iid });
    return out;
  }

  // A Showdown's pre-combat Action Window (rule 340-345): only the Focus holder may act, and only
  // with [Action]/[Reaction]-timed spells (or passing).
  if (state.showdown !== null && windowIsOpen(state.showdown)) {
    if (player !== state.priority) return [];
    const out: Action[] = [{ type: "pass" }];
    for (const iid of playableSpellIids(state, player, /* reactionOnly */ false)) {
      out.push({ type: "playCard", iid });
    }
    for (const iid of hiddenPlayableIids(state, player)) out.push({ type: "playCard", iid });
    return out;
  }

  // During Showdown damage assignment, the only legal actions are by the side on the clock.
  if (state.showdown !== null) {
    if (!needsAssignment(state, player)) return [];
    return availableTargets(state, player).map((t) => ({
      type: "assignDamage" as const,
      targetIid: t.iid as number,
    }));
  }

  if (state.activePlayer !== player) return [];

  const actions: Action[] = [];
  const p = state.players[player];

  // Play a card from hand or the Champion Zone if affordable: to base, or (units only) directly
  // to a battlefield you already control / an open one the card specifically allows.
  const playableIids = [...p.hand, ...(p.championZone !== null ? [p.championZone] : [])];
  for (const iid of playableIids) {
    const def = state.defs[getInstance(state, iid).defId]!;
    const cost = effectivePlayCost(state, player, def);
    if (!canAfford(state, player, cost.energy, cost.power)) continue;
    actions.push({ type: "playCard", iid: iid as number });
    if (def.type === "unit") {
      for (const bf of playableBattlefields(state, player, def)) {
        actions.push({ type: "playCard", iid: iid as number, battlefield: bf });
      }
    }
    // [Accelerate]: pay an extra alternate cost at play time to enter ready instead of exhausted.
    if (
      def.accelerateCost &&
      canAffordAccelerate(state, player, cost.energy, cost.power, def.accelerateCost.energy, def.accelerateCost.rune)
    ) {
      actions.push({ type: "playCard", iid: iid as number, accelerate: true });
    }
  }

  // [Hidden] (rule 727): Hide a card facedown at a controlled battlefield for 1 rune (Power). This
  // is independent of whether the card is affordable to PLAY, so it lives in its own loop over the
  // hand (only cards in hand can be hidden, not the Champion Zone).
  if (canAfford(state, player, 0, HIDE_COST_POWER)) {
    for (const iid of p.hand) {
      if (!state.defs[getInstance(state, iid).defId]!.hidden) continue;
      for (const bf of state.battlefields) {
        if (bf.controller === player && !hasFacedownAt(state, bf.index)) {
          actions.push({ type: "hide", iid: iid as number, battlefield: bf.index });
        }
      }
    }
  }

  // Play a facedown [Hidden] card that has gained [Reaction] (rule 727.6) on your own turn.
  for (const iid of hiddenPlayableIids(state, player)) actions.push({ type: "playCard", iid });

  // Float Energy (exhaust a ready rune) / Float Power (recycle a rune).
  for (const rid of p.runePool) {
    const rune = getInstance(state, rid);
    if (!rune.exhausted) actions.push({ type: "floatEnergy", runeIid: rid as number });
    actions.push({ type: "floatPower", runeIid: rid as number });
  }

  // Activated abilities (Seals, legend abilities, a handful of unit/gear abilities) — sorcery
  // speed only, usable on any ready, controlled instance with a registered ability.
  for (const inst of Object.values(state.instances)) {
    if (inst.controller !== player) continue;
    if (inst.zone !== "base" && inst.zone !== "battlefield" && inst.zone !== "legend") continue;
    const spec = ABILITIES[inst.defId];
    if (!spec || !canActivate(state, player, inst.iid, spec)) continue;
    if (spec.legalTargets) {
      for (const t of spec.legalTargets(state, player, inst.iid)) {
        actions.push({ type: "activateAbility", sourceIid: inst.iid as number, targetIid: t as number });
      }
    } else {
      actions.push({ type: "activateAbility", sourceIid: inst.iid as number });
    }
  }

  // Move a ready unit. Standard Move: base <-> battlefield, in EITHER direction (any unit).
  // [Ganking] units may also move battlefield -> battlefield directly. Enumerated one unit at a
  // time (for the bot / legality lookups); the UI may combine several into one moveUnits action
  // so a group arrives — and contests a Showdown — together. applyAction validates each iid
  // independently either way.
  for (const inst of Object.values(state.instances)) {
    if (
      inst.controller === player &&
      !inst.exhausted &&
      state.defs[inst.defId]!.type === "unit" &&
      (inst.zone === "base" || inst.zone === "battlefield")
    ) {
      const iid = inst.iid as number;
      if (inst.zone === "battlefield") {
        // Retreat: battlefield -> base is always a Standard Move, no Ganking required.
        actions.push({ type: "moveUnits", iids: [iid], to: "base" });
      }
      const isGankMove = inst.zone === "battlefield";
      if (isGankMove && !hasGanking(state, inst)) continue;
      for (const bf of state.battlefields) {
        if (inst.battlefield !== bf.index) {
          actions.push({ type: "moveUnits", iids: [iid], to: bf.index });
        }
      }
    }
  }

  actions.push({ type: "endTurn" });
  return actions;
}

export function applyAction(state: GameState, action: Action): GameState {
  return produce(state, (draft) => {
    draft.ply += 1;

    switch (action.type) {
      case "mulligan": {
        const player = draft.mulligan.pending;
        if (player === null) throw new Error("Illegal mulligan: no pending mulligan");
        if (action.iids.length > MAX_MULLIGAN) {
          throw new Error(`Illegal mulligan: at most ${MAX_MULLIGAN} cards`);
        }
        const p = draft.players[player];
        for (const iid of action.iids) {
          if (!p.hand.includes(iid as InstanceId)) {
            throw new Error(`Illegal mulligan: ${iid} not in hand`);
          }
        }
        for (const iid of action.iids) {
          p.hand = p.hand.filter((h) => h !== (iid as InstanceId));
          draft.instances[iid]!.zone = "mainDeck";
          p.mainDeck.push(iid as InstanceId); // returned to the bottom
        }
        for (let i = 0; i < action.iids.length; i++) drawFromMain(draft, player);
        draft.log.push(
          action.iids.length > 0
            ? `P${player} mulligans ${action.iids.length} card(s)`
            : `P${player} keeps their hand`,
        );
        draft.mulligan.pending = player === 0 ? 1 : null;
        if (draft.mulligan.pending === null) startTurn(draft, draft.firstPlayer);
        break;
      }

      case "assignDamage": {
        const sd = draft.showdown;
        if (!sd || sd.toAssign === null) throw new Error("assignDamage: no showdown");
        assignToTarget(draft, sd.toAssign, action.targetIid);
        break;
      }

      case "playCard": {
        // Normally the Turn Player; but whenever a Chain exists (Closed State) or a Showdown Action
        // Window is open, whoever currently holds Priority/Focus may play — that can be the DEFENDER,
        // mid the active player's own turn, responding with a [Reaction] (rule 309.1.a / 340-345).
        const inChainOrWindow =
          draft.chain.length > 0 || (draft.showdown !== null && windowIsOpen(draft.showdown));
        const player = inChainOrWindow ? draft.priority! : draft.activePlayer;
        const inst = draft.instances[action.iid];
        if (
          !inst ||
          inst.controller !== player ||
          (inst.zone !== "hand" && inst.zone !== "championZone" && inst.zone !== "facedown")
        ) {
          throw new Error(`Illegal playCard: instance ${action.iid}`);
        }
        const def = draft.defs[inst.defId]!;
        // Play from Hidden (rule 727): the card must have been hidden on an earlier turn (so it has
        // gained [Reaction]) and it ignores its base cost. A hidden unit must enter at the very
        // battlefield it was hidden at (727.1.d.1).
        const fromHidden = inst.zone === "facedown";
        if (fromHidden && !(inst.hiddenOnTurn !== null && draft.turn > inst.hiddenOnTurn)) {
          throw new Error(`Illegal playCard: hidden card ${action.iid} not yet playable`);
        }
        const hiddenUnitBf = fromHidden && def.type === "unit" ? inst.battlefield ?? undefined : undefined;
        const cost = fromHidden ? { energy: 0, power: 0 } : effectivePlayCost(draft, player, def);
        if (!canAfford(draft, player, cost.energy, cost.power)) {
          throw new Error(`Illegal playCard: cannot afford ${def.name}`);
        }
        if (action.battlefield !== undefined) {
          if (def.type !== "unit") throw new Error("Illegal playCard: only units may target a battlefield");
          if (!playableBattlefields(draft, player, def).includes(action.battlefield)) {
            throw new Error(`Illegal playCard: cannot play to battlefield ${action.battlefield}`);
          }
        }
        if (action.accelerate) {
          if (
            !def.accelerateCost ||
            !canAffordAccelerate(draft, player, cost.energy, cost.power, def.accelerateCost.energy, def.accelerateCost.rune)
          ) {
            throw new Error(`Illegal playCard: cannot afford Accelerate for ${def.name}`);
          }
        }
        // Reserve the colored rune FIRST (it's not fungible — must be spent before the generic
        // energy payment below might otherwise grab it for the base/extra Energy cost instead).
        if (action.accelerate && def.accelerateCost) {
          spendRuneOfColor(draft, player, def.accelerateCost.rune);
        }
        autoPay(draft, player, cost.energy, cost.power);
        if (action.accelerate && def.accelerateCost) {
          autoPay(draft, player, def.accelerateCost.energy, 0);
        }
        if (inst.zone === "hand") {
          draft.players[player].hand = draft.players[player].hand.filter((h) => h !== action.iid);
        } else if (inst.zone === "championZone") {
          draft.players[player].championZone = null;
        }
        inst.hiddenOnTurn = null; // no longer facedown once played
        // A hidden unit is forced to its hidden battlefield; otherwise honor the chosen battlefield.
        const placeBf = hiddenUnitBf ?? action.battlefield;
        if (def.type === "unit" || def.type === "gear") {
          // Sun Disc's "the next unit you play this turn enters ready" only applies to units, and
          // is consumed the moment one is played (whether or not this specific play uses it).
          const sunDiscReady = def.type === "unit" && draft.players[player].nextUnitEntersReady;
          if (def.type === "unit") draft.players[player].nextUnitEntersReady = false;
          inst.exhausted = action.accelerate || sunDiscReady ? false : !def.entersReady; // units/gear enter exhausted unless text says ready, Accelerate was paid, or Sun Disc granted it
          if (placeBf !== undefined) {
            inst.zone = "battlefield";
            inst.battlefield = placeBf;
            draft.log.push(`P${player} plays ${def.name} to ${draft.battlefields[placeBf]!.name}`);
            resolveArrival(draft, placeBf, player, [inst]);
          } else {
            inst.zone = "base";
            draft.log.push(`P${player} plays ${def.name}`);
          }
        } else {
          inst.zone = "chain"; // spells go onto the Chain (rule 351), not straight to the trash
          inst.battlefield = null; // a spell played from hidden leaves its battlefield
          draft.log.push(`P${player} plays ${def.name}`);
        }
        // onPlayCard BEFORE the spell reaches the Chain: a spell's own effect commonly opens a
        // pendingTrigger (e.g. Falling Star's two target picks), and fireTrigger's "one pending
        // decision at a time" guard would otherwise silently skip onPlayCard's own checks (e.g. Lux
        // - Lady of Luminosity's "when you play a spell costing 5+, draw 1") until that resolves --
        // by which point onPlayCard is never called again for this play, dropping it entirely.
        onPlayCard(draft, player, inst);
        if (def.type === "spell") pushSpellToChain(draft, player, inst.iid);
        draft.players[player].playedCardThisTurn = true;
        // Drive the Chain: opponents get a response window before the spell resolves; `advanceChain`
        // suspends on any real decision (a reaction to play, or the spell's own target choice) and
        // owns returning Focus/Priority to the Action Window or Turn Player when the Chain drains.
        advanceChain(draft);
        break;
      }

      case "floatEnergy": {
        if (!floatEnergy(draft, draft.activePlayer, action.runeIid as InstanceId)) {
          throw new Error("Illegal floatEnergy");
        }
        break;
      }

      case "floatPower": {
        if (!floatPower(draft, draft.activePlayer, action.runeIid as InstanceId)) {
          throw new Error("Illegal floatPower");
        }
        break;
      }

      case "activateAbility": {
        const player = draft.activePlayer;
        const inst = draft.instances[action.sourceIid];
        if (!inst || inst.controller !== player) throw new Error("Illegal activateAbility: bad source");
        const spec = ABILITIES[inst.defId];
        if (!spec) throw new Error("Illegal activateAbility: no such ability");
        if (!canActivate(draft, player, inst.iid, spec)) {
          throw new Error("Illegal activateAbility: cannot activate");
        }
        if (spec.legalTargets) {
          const legal = spec.legalTargets(draft, player, inst.iid);
          if (action.targetIid === undefined || !legal.includes(action.targetIid as InstanceId)) {
            throw new Error("Illegal activateAbility: invalid target");
          }
        }
        payActivationCost(draft, player, inst.iid, spec);
        draft.log.push(`P${player} activates ${draft.defs[inst.defId]!.name}`);
        spec.resolve(draft, player, inst.iid, action.targetIid as InstanceId | undefined);
        // Some abilities move units off a battlefield (e.g. Yasuo) — cheap to re-check both.
        for (const bf of draft.battlefields) updateControl(draft, bf.index);
        checkWin(draft);
        break;
      }

      case "resolveTrigger": {
        if (!draft.pendingTrigger) throw new Error("Illegal resolveTrigger: nothing pending");
        resolvePendingTrigger(draft, action.accept, action.targetIid as InstanceId | undefined, action.battlefield);
        for (const bf of draft.battlefields) updateControl(draft, bf.index);
        checkWin(draft);
        // This pick may have been a resolving spell's own target (e.g. Incinerate). Once the choice
        // is closed, resume driving the Chain (response windows, resolution, Focus hand-back).
        if (draft.pendingTrigger === null) advanceChain(draft);
        break;
      }

      case "hide": {
        // Rule 727: hide a [Hidden] card facedown at a battlefield you control, for one rune. Not a
        // Play — no Chain is created — and only on your own turn in an Open State.
        const player = draft.activePlayer;
        const inst = draft.instances[action.iid];
        if (!inst || inst.controller !== player || inst.zone !== "hand") {
          throw new Error(`Illegal hide: instance ${action.iid}`);
        }
        if (!draft.defs[inst.defId]!.hidden) throw new Error("Illegal hide: card is not [Hidden]");
        const bf = draft.battlefields[action.battlefield];
        if (!bf || bf.controller !== player) throw new Error("Illegal hide: you don't control that battlefield");
        if (hasFacedownAt(draft, action.battlefield)) throw new Error("Illegal hide: a facedown card is already there");
        if (!canAfford(draft, player, 0, HIDE_COST_POWER)) throw new Error("Illegal hide: cannot pay the rune");
        autoPay(draft, player, 0, HIDE_COST_POWER);
        draft.players[player].hand = draft.players[player].hand.filter((h) => h !== action.iid);
        inst.zone = "facedown";
        inst.battlefield = action.battlefield;
        inst.hiddenOnTurn = draft.turn;
        draft.log.push(`P${player} hides a card at ${bf.name}`);
        break;
      }

      case "pass": {
        // In a Closed State the pass advances the Chain's priority round (rule 335); with no Chain,
        // it is a Showdown Action Window pass (rule 344.3).
        if (draft.chain.length > 0) {
          passPriority(draft);
          advanceChain(draft);
        } else {
          passActionWindow(draft);
        }
        break;
      }

      case "moveUnits": {
        const player = draft.activePlayer;
        if (action.iids.length === 0) throw new Error("Illegal moveUnits: empty selection");
        const to = action.to;
        if (to !== "base" && !draft.battlefields[to]) {
          throw new Error(`Illegal moveUnits: no battlefield ${to}`);
        }

        // Validate every mover before mutating anything, so an illegal iid fails the whole
        // (Immer-discarded) action atomically rather than partially moving the group.
        for (const iid of action.iids) {
          const inst = draft.instances[iid];
          if (
            !inst ||
            inst.controller !== player ||
            inst.exhausted ||
            draft.defs[inst.defId]!.type !== "unit" ||
            (inst.zone !== "base" && inst.zone !== "battlefield") ||
            (to === "base" ? inst.zone === "base" : inst.battlefield === to) ||
            // Battlefield -> battlefield requires Ganking; battlefield -> base (retreat) does not.
            (inst.zone === "battlefield" && to !== "base" && !hasGanking(draft, inst))
          ) {
            throw new Error(`Illegal moveUnits: instance ${iid}`);
          }
        }

        const froms = new Set<number>();
        const names: string[] = [];
        for (const iid of action.iids) {
          const inst = draft.instances[iid]!;
          if (inst.zone === "battlefield" && inst.battlefield !== null) froms.add(inst.battlefield);
          inst.zone = to === "base" ? "base" : "battlefield";
          inst.battlefield = to === "base" ? null : to;
          inst.exhausted = true;
          names.push(draft.defs[inst.defId]!.name);
        }
        const destName = to === "base" ? "base" : draft.battlefields[to]!.name;
        draft.log.push(`P${player} moves ${names.join(", ")} to ${destName}`);
        if (to === "base") {
          for (const from of froms) updateControl(draft, from);
          checkWin(draft);
        } else {
          resolveArrival(draft, to, player, action.iids.map((iid) => draft.instances[iid]!));
          for (const from of froms) updateControl(draft, from); // vacated fields may change hands
        }
        break;
      }

      case "endTurn": {
        if (draft.showdown !== null) throw new Error("Cannot end turn during a Showdown");
        endOfTurnPhase(draft, draft.activePlayer);
        // Time Warp's "take a turn after this one": consume one queued extra turn instead of
        // passing to the opponent, decrementing so it doesn't repeat.
        const ending = draft.players[draft.activePlayer];
        if (ending.extraTurns > 0) {
          ending.extraTurns -= 1;
          startTurn(draft, draft.activePlayer);
        } else {
          startTurn(draft, opponentOf(draft.activePlayer));
        }
        break;
      }
    }

    // A Showdown may still be waiting on the non-active side; keep it moving where possible.
    advanceShowdown(draft);
    // Rule 322.5: discard any facedown [Hidden] card whose controller lost its battlefield.
    cleanupHiddenCards(draft);

    if (draft.winner === null && draft.ply >= MAX_PLIES) {
      const [a, b] = draft.players;
      draft.winner = a.points === b.points ? "draw" : a.points > b.points ? 0 : 1;
      draft.log.push(`Ply cap reached; winner=${draft.winner}`);
    }
  });
}

/**
 * Shared tail for anything that puts a unit at a battlefield (a move, or a direct play there):
 * contested -> start a Showdown (combined Might of everyone arriving/already there contests
 * together); otherwise just (re)compute control. Fires the on-arrival hook (e.g. Noxian Drummer)
 * for each arriving instance once the outcome is settled, then checks for a win.
 */
function resolveArrival(
  state: GameState,
  battlefield: number,
  player: PlayerId,
  arriving: CardInstance[] = [],
): void {
  const enemies = unitsAt(state, battlefield, opponentOf(player)).length;
  if (enemies > 0) {
    startShowdown(state, battlefield, player);
  } else {
    updateControl(state, battlefield);
  }
  for (const inst of arriving) onArrival(state, battlefield, inst);
  checkWin(state);
}
