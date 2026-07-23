import { describe, it, expect } from "vitest";
import type { InstanceId, PlayerId } from "@riftbound/shared";
import { createRng } from "./rng.js";
import { applyAction, getLegalActions } from "./actions.js";
import { updateControl } from "./showdown.js";
import type { CardInstance, GameState } from "./state.js";
import { makeCardDef, makeLegendInstance } from "./test-utils.js";

/** A bare state with the given units already placed (battlefield or base), ready to move. */
function scenario(
  units: Array<{ owner: PlayerId; might: number; zone: "battlefield" | "base"; battlefield?: number; ganking?: boolean }>,
): GameState {
  const defs: GameState["defs"] = {};
  const instances: Record<number, CardInstance> = {};
  units.forEach((u, i) => {
    const defId = `d${i}`;
    defs[defId] = makeCardDef({ type: "unit", name: `U${u.might}`, might: u.might, ganking: u.ganking ?? false });
    instances[i + 1] = {
      iid: (i + 1) as InstanceId,
      defId: defId as CardInstance["defId"],
      owner: u.owner,
      controller: u.owner,
      zone: u.zone,
      battlefield: u.zone === "battlefield" ? (u.battlefield ?? 0) : null,
      exhausted: false,
      damage: 0,
      buffed: false,
      temporary: false,
      stunned: false,
      tempMightDelta: 0,
      gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
  });
  instances[900] = makeLegendInstance(900, 0);
  instances[901] = makeLegendInstance(901, 1);
  defs[instances[900]!.defId] = makeCardDef({ type: "legend", id: instances[900]!.defId });
  defs[instances[901]!.defId] = makeCardDef({ type: "legend", id: instances[901]!.defId });
  const state: GameState = {
    rng: createRng(1),
    ply: 0,
    turn: 1,
    activePlayer: 0,
    firstPlayer: 0,
    players: [
      { id: 0, legendDefId: instances[900]!.defId, legendIid: 900 as InstanceId, mainDeck: [], runeDeck: [], hand: [], runePool: [], championZone: null, energy: 0, power: 0, floatingRunes: [], playedCardThisTurn: false, nextUnitEntersReady: false, points: 0, hasTakenTurn: true, extraTurns: 0 },
      { id: 1, legendDefId: instances[901]!.defId, legendIid: 901 as InstanceId, mainDeck: [], runeDeck: [], hand: [], runePool: [], championZone: null, energy: 0, power: 0, floatingRunes: [], playedCardThisTurn: false, nextUnitEntersReady: false, points: 0, hasTakenTurn: true, extraTurns: 0 },
    ],
    battlefields: [
      { index: 0, defId: "bf0" as CardInstance["defId"], name: "Field A", text: "", presentedBy: 0, controller: null },
      { index: 1, defId: "bf1" as CardInstance["defId"], name: "Field B", text: "", presentedBy: 1, controller: null },
    ],
    instances,
    defs,
    mulligan: { pending: null },
    showdown: null,
    pendingTrigger: null,
    chain: [],
    priority: null,
    passStreak: 0,
    nextChainId: 1,
    preventSpellAbilityDamage: false,
    winner: null,
    log: [],
  };
  // Seed control for any battlefield that already has a sole occupant.
  updateControl(state, 0);
  updateControl(state, 1);
  return state;
}

describe("retreat: battlefield -> base", () => {
  it("a ready unit can retreat from a battlefield back to base (no Ganking required)", () => {
    const state = scenario([{ owner: 0, might: 3, zone: "battlefield", battlefield: 0 }]);
    expect(state.battlefields[0]!.controller).toBe(0); // sole occupant controls on arrival
    expect(state.players[0]!.points).toBe(1);

    const legal = getLegalActions(state, 0);
    expect(legal).toContainEqual({ type: "moveUnits", iids: [1], to: "base" });

    const next = applyAction(state, { type: "moveUnits", iids: [1], to: "base" });
    const inst = next.instances[1]!;
    expect(inst.zone).toBe("base");
    expect(inst.battlefield).toBeNull();
    expect(inst.exhausted).toBe(true); // moving still exhausts, like any Standard Move
    expect(next.battlefields[0]!.controller).toBeNull(); // vacated -> uncontrolled
  });

  it("retreat does NOT require [Ganking] (only battlefield->battlefield does)", () => {
    const state = scenario([{ owner: 0, might: 2, zone: "battlefield", battlefield: 0, ganking: false }]);
    const legal = getLegalActions(state, 0);
    const retreat = legal.find((a) => a.type === "moveUnits" && a.to === "base");
    expect(retreat).toBeDefined();
    // But battlefield -> battlefield should be absent without Ganking.
    const gankMove = legal.find((a) => a.type === "moveUnits" && a.to === 1);
    expect(gankMove).toBeUndefined();
  });

  it("base -> battlefield still works after the round trip (advance again)", () => {
    let state = scenario([{ owner: 0, might: 3, zone: "battlefield", battlefield: 0 }]);
    state = applyAction(state, { type: "moveUnits", iids: [1], to: "base" });
    // Not ready again until a new turn, but legality is what we're checking here is exhausted-gated,
    // so ready it manually to simulate the next turn's ready step.
    state = { ...state, instances: { ...state.instances, 1: { ...state.instances[1]!, exhausted: false } } };
    const legal = getLegalActions(state, 0);
    expect(legal).toContainEqual({ type: "moveUnits", iids: [1], to: 1 });
    const next = applyAction(state, { type: "moveUnits", iids: [1], to: 1 });
    expect(next.instances[1]!.zone).toBe("battlefield");
    expect(next.instances[1]!.battlefield).toBe(1);
  });
});
