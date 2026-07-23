import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

const SEAL_OF_RAGE = "ogn-040-298";
const KAI_SA = "ogn-247-298";
const VIKTOR_LEGEND = "ogn-265-298";

describe("activated abilities: Seals", () => {
  it("a Seal can't be activated until it's on the board and ready, then produces its rune color", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: SEAL_OF_RAGE as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: SEAL_OF_RAGE as never, name: "Seal of Rage" })],
    });
    expect(getLegalActions(state, 0).some((a) => a.type === "activateAbility")).toBe(true);

    state = applyAction(state, { type: "activateAbility", sourceIid: 1 });
    expect(state.players[0]!.floatingRunes).toEqual(["fury"]);
    expect(state.instances[1]!.exhausted).toBe(true);

    // Exhausted now -- can't activate again this turn.
    expect(getLegalActions(state, 0).some((a) => a.type === "activateAbility")).toBe(false);
  });

  it("floating runes clear at the start of the next turn (same cadence as Energy/Power)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: SEAL_OF_RAGE as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: SEAL_OF_RAGE as never, name: "Seal of Rage" })],
    });
    state = applyAction(state, { type: "activateAbility", sourceIid: 1 });
    expect(state.players[0]!.floatingRunes.length).toBe(1);
    state = applyAction(state, { type: "endTurn" });
    state = applyAction(state, { type: "endTurn" });
    expect(state.players[0]!.floatingRunes.length).toBe(0);
  });
});

describe("activated legend abilities", () => {
  it("Kai'Sa's legend ability adds a rainbow rune and exhausts the legend", () => {
    let state = makeBareGame({ legendDefIds: [KAI_SA, "legend-test-1"] });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900 });
    expect(state.players[0]!.floatingRunes).toEqual(["rainbow"]);
    expect(state.instances[900]!.exhausted).toBe(true);
  });

  it("Viktor's legend ability plays a 1-Might Recruit token to base", () => {
    let state = makeBareGame({
      legendDefIds: [VIKTOR_LEGEND, "legend-test-1"],
      playerPatch: [{ energy: 1 }, {}],
    });
    const before = Object.keys(state.instances).length;
    state = applyAction(state, { type: "activateAbility", sourceIid: 900 });
    const created = Object.values(state.instances).find((i) => i.zone === "base" && state.defs[i.defId]!.name === "Recruit");
    expect(Object.keys(state.instances).length).toBe(before + 1);
    expect(created).toBeDefined();
    expect(state.defs[created!.defId]!.might).toBe(1);
  });
});

describe("Sun Disc: exhaust, [Legion] -- the next unit you play this turn enters ready", () => {
  const SUN_DISC = "ogn-021-298";

  it("requires [Legion] to activate, then makes the NEXT unit played enter ready (consumed once, doesn't linger)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: SUN_DISC as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "gear", id: SUN_DISC as never, name: "Sun Disc" }),
        makeCardDef({ type: "unit", id: "u1" as never }),
        makeCardDef({ type: "unit", id: "u2" as never }),
      ],
      playerPatch: [{ hand: [2 as never, 3 as never] }, {}],
    });
    state.instances[2] = { iid: 2 as never, defId: "u1" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    state.instances[3] = { iid: 3 as never, defId: "u2" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };

    expect(getLegalActions(state, 0).some((a) => a.type === "activateAbility" && a.sourceIid === 1)).toBe(false); // no Legion yet
    state = applyAction(state, { type: "playCard", iid: 2 }); // sets playedCardThisTurn -- u1 itself enters exhausted as normal
    expect(state.instances[2]!.exhausted).toBe(true);

    state = applyAction(state, { type: "activateAbility", sourceIid: 1 });
    expect(state.players[0]!.nextUnitEntersReady).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 3 }); // the NEXT unit -- enters ready
    expect(state.instances[3]!.exhausted).toBe(false);
    expect(state.players[0]!.nextUnitEntersReady).toBe(false); // consumed, doesn't linger for a 3rd unit
  });

  it("expires at the end of the turn if no unit gets played", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: SUN_DISC as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: SUN_DISC as never, name: "Sun Disc" })],
      playerPatch: [{ hand: [2 as never] }, {}],
    });
    state.instances[2] = { iid: 2 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "activateAbility", sourceIid: 1 });
    expect(state.players[0]!.nextUnitEntersReady).toBe(true);
    state = applyAction(state, { type: "endTurn" });
    expect(state.players[0]!.nextUnitEntersReady).toBe(false);
  });
});
