/**
 * Activated abilities — sorcery-speed only (usable exclusively on your own turn, same
 * simplification already used for floatEnergy/floatPower), each a small hardcoded entry keyed by
 * card id, same philosophy as starter.ts's deck lists / banned.ts's ban list. No text-parsing
 * "rules engine" — each entry is hand-written.
 *
 * This intentionally does not implement every activated ability in the game — see the "Phase 4/5"
 * plan for what's included and what's explicitly deferred (e.g. Sett's death-replacement effect,
 * which needs to interrupt mid-Showdown-resolution rather than fire at a clean hook point).
 */
import type { CardColor, InstanceId, PlayerId } from "@riftbound/shared";
import { autoPay, canAfford } from "./resources.js";
import { createToken, RECRUIT_TOKEN } from "./tokens.js";
import {
  getInstance,
  giveBuff,
  hasFloatingRune,
  spendFloatingRune,
  type GameState,
  type RuneColor,
} from "./state.js";

export interface AbilityCost {
  exhaustSelf?: boolean;
  energy?: number;
  power?: number;
  /** Spend one floating rune of this color ("rainbow" as a cost = any one floating rune). */
  rune?: RuneColor;
}

export interface AbilitySpec {
  cost: AbilityCost;
  condition?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => boolean;
  /** Present only for target-choosing abilities; omit for self-contained/no-target ones. */
  legalTargets?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => InstanceId[];
  resolve: (
    state: GameState,
    player: PlayerId,
    sourceIid: InstanceId,
    targetIid?: InstanceId,
  ) => void;
}

function friendlyUnits(state: GameState, player: PlayerId) {
  return Object.values(state.instances).filter(
    (i) =>
      i.controller === player &&
      (i.zone === "base" || i.zone === "battlefield") &&
      state.defs[i.defId]!.type === "unit",
  );
}

export function canActivate(
  state: GameState,
  player: PlayerId,
  sourceIid: InstanceId,
  spec: AbilitySpec,
): boolean {
  const inst = state.instances[sourceIid as number];
  if (!inst || inst.controller !== player) return false;
  if (spec.cost.exhaustSelf && inst.exhausted) return false;
  if (!canAfford(state, player, spec.cost.energy ?? 0, spec.cost.power ?? 0)) return false;
  if (spec.cost.rune && !hasFloatingRune(state, player, spec.cost.rune)) return false;
  if (spec.condition && !spec.condition(state, player, sourceIid)) return false;
  return true;
}

export function payActivationCost(
  state: GameState,
  player: PlayerId,
  sourceIid: InstanceId,
  spec: AbilitySpec,
): void {
  const inst = state.instances[sourceIid as number]!;
  if (spec.cost.exhaustSelf) inst.exhausted = true;
  autoPay(state, player, spec.cost.energy ?? 0, spec.cost.power ?? 0);
  if (spec.cost.rune) spendFloatingRune(state, player, spec.cost.rune);
}

function sealAbility(color: CardColor): AbilitySpec {
  return {
    cost: { exhaustSelf: true },
    resolve: (state, player) => {
      state.players[player].floatingRunes.push(color);
      state.log.push(`P${player} adds a floating ${color} rune`);
    },
  };
}

// Seal of Rage/Focus/Insight/Strength/Discord/Unity — one per domain, all the same shape.
const SEALS: Record<string, CardColor> = {
  "ogn-040-298": "fury",
  "ogn-081-298": "calm",
  "ogn-120-298": "mind",
  "ogn-163-298": "body",
  "ogn-204-298": "chaos",
  "ogn-245-298": "order",
};

export const ABILITIES: Record<string, AbilitySpec> = {
  ...Object.fromEntries(Object.entries(SEALS).map(([id, color]) => [id, sealAbility(color)])),

  // Kai'Sa - Daughter of the Void (legend): exhaust: Add a rainbow rune (any color).
  "ogn-247-298": {
    cost: { exhaustSelf: true },
    resolve: (state, player) => {
      state.players[player].floatingRunes.push("rainbow");
      state.log.push(`P${player} adds a floating rainbow rune`);
    },
  },

  // Darius - Hand of Noxus (legend): exhaust, [Legion] -- Add 1 Energy.
  "ogn-253-298": {
    cost: { exhaustSelf: true },
    condition: (state, player) => state.players[player].playedCardThisTurn,
    resolve: (state, player) => {
      state.players[player].energy += 1;
      state.log.push(`P${player} adds 1 Energy (Legion)`);
    },
  },

  // Lee Sin - Blind Monk (legend): 1 Energy, exhaust: Buff a friendly unit.
  "ogn-257-298": {
    cost: { exhaustSelf: true, energy: 1 },
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  },

  // Yasuo - Unforgiven (legend): 2 Energy, exhaust: Move a friendly unit to its base.
  // Simplified to the retreat direction only (a unit already at a battlefield) — the ability's
  // real value is bypassing the "must be ready" rule to pull a unit out before it's forced to
  // fight; advancing base->battlefield already exists as a free action when the unit is ready.
  "ogn-259-298": {
    cost: { exhaustSelf: true, energy: 2 },
    legalTargets: (state, player) =>
      friendlyUnits(state, player)
        .filter((i) => i.zone === "battlefield")
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const inst = getInstance(state, targetIid);
      inst.zone = "base";
      inst.battlefield = null;
      state.log.push(`P${player} moves ${state.defs[inst.defId]!.name} to base (Yasuo)`);
      // Control at the vacated battlefield may change; the "activateAbility" case in actions.ts
      // re-checks control on every battlefield after any ability resolves, so no extra bookkeeping
      // is needed here.
    },
  },

  // Miss Fortune - Bounty Hunter (legend): exhaust: Give a unit [Ganking] this turn.
  "ogn-267-298": {
    cost: { exhaustSelf: true },
    legalTargets: (state, player) => friendlyUnits(state, player).map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) getInstance(state, targetIid).gankingThisTurn = true;
    },
  },

  // Viktor - Herald of the Arcane (legend): 1 Energy, exhaust: Play a 1-Might Recruit token.
  "ogn-265-298": {
    cost: { exhaustSelf: true, energy: 1 },
    resolve: (state, player) => {
      createToken(state, player, RECRUIT_TOKEN, "base");
    },
  },

  // Teemo - Swift Scout (legend, activated half only — the Hidden-cost half stays deferred):
  // 1 Energy, exhaust: put a Teemo unit you own into your hand from the Champion Zone or board.
  "ogn-263-298": {
    cost: { exhaustSelf: true, energy: 1 },
    legalTargets: (state, player) => {
      const p = state.players[player];
      const candidates: number[] = [];
      if (p.championZone !== null) candidates.push(p.championZone as number);
      for (const i of friendlyUnits(state, player)) candidates.push(i.iid as number);
      return candidates.filter((iid) => state.defs[state.instances[iid]!.defId]!.tags.includes("Teemo")) as unknown as InstanceId[];
    },
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const inst = getInstance(state, targetIid);
      if (state.players[player].championZone === targetIid) state.players[player].championZone = null;
      inst.zone = "hand";
      inst.battlefield = null;
      state.players[player].hand.push(targetIid);
      state.log.push(`P${player} returns ${state.defs[inst.defId]!.name} to hand (Teemo)`);
    },
  },

  // Lee Sin - Ascetic (champion, from the Lee Sin starter's own deck): exhaust: Buff me.
  "ogn-078-298": {
    cost: { exhaustSelf: true },
    resolve: (state, _player, sourceIid) => giveBuff(getInstance(state, sourceIid)),
  },

  // Arena Bar (gear): exhaust: Buff an exhausted friendly unit.
  "ogn-124-298": {
    cost: { exhaustSelf: true },
    legalTargets: (state, player) =>
      friendlyUnits(state, player)
        .filter((i) => i.exhausted)
        .map((i) => i.iid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  },

  // Sun Disc (gear): exhaust, [Legion] -- the next unit you play this turn enters ready.
  "ogn-021-298": {
    cost: { exhaustSelf: true },
    condition: (state, player) => state.players[player].playedCardThisTurn,
    resolve: (state, player) => {
      state.players[player].nextUnitEntersReady = true;
    },
  },
};
