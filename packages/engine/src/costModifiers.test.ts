import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import { effectivePlayCost } from "./costModifiers.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

const NOXUS_HOPEFUL = "ogn-012-298";
const RHASA = "ogn-195-298";

describe("Noxus Hopeful: [Legion] -- costs 2 Energy less", () => {
  it("costs full price with no [Legion], 2 less once another card has been played this turn", () => {
    const def = makeCardDef({ type: "unit", id: NOXUS_HOPEFUL as never, energy: 4 });
    const noLegion = makeBareGame({});
    expect(effectivePlayCost(noLegion, 0, def).energy).toBe(4);

    const withLegion = makeBareGame({ playerPatch: [{ playedCardThisTurn: true }, {}] });
    expect(effectivePlayCost(withLegion, 0, def).energy).toBe(2);
  });

  it("is actually playable for less once [Legion] is active, live through playCard", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: NOXUS_HOPEFUL as never, name: "Noxus Hopeful", energy: 4 }),
        makeCardDef({ type: "unit", id: "filler" as never, energy: 0 }),
      ],
      playerPatch: [{ hand: [1 as never, 2 as never], energy: 2 }, {}], // only 2 Energy -- not enough at full price (4)
    });
    state.instances[1] = { iid: 1 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    state.instances[2] = { iid: 2 as never, defId: NOXUS_HOPEFUL as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };

    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 2)).toBe(false); // 4 > 2 Energy available

    state = applyAction(state, { type: "playCard", iid: 1 }); // sets playedCardThisTurn
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 2)).toBe(true); // now costs 4-2=2
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[2]!.zone).toBe("base");
  });
});

describe("Rhasa the Sunderer: costs 1 Energy less per card in your trash", () => {
  it("scales the discount with trash size", () => {
    const def = makeCardDef({ type: "unit", id: RHASA as never, energy: 5 });
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "junk" as never, zone: "base" }, // not trash -- doesn't count
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "junk" as never })],
    });
    expect(effectivePlayCost(state, 0, def).energy).toBe(5); // 0 in trash -- no discount

    state.instances[2] = { iid: 2 as never, defId: "junk" as never, owner: 0, controller: 0, zone: "trash", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    state.instances[3] = { iid: 3 as never, defId: "junk" as never, owner: 0, controller: 0, zone: "trash", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    expect(effectivePlayCost(state, 0, def).energy).toBe(3); // 5 - 2 in trash

    for (let i = 4; i <= 8; i++) {
      state.instances[i] = { iid: i as never, defId: "junk" as never, owner: 0, controller: 0, zone: "trash", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null };
    }
    expect(effectivePlayCost(state, 0, def).energy).toBe(0); // never goes negative (7 in trash > 5 cost)
  });
});
