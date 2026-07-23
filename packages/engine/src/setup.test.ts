import { describe, it, expect } from "vitest";
import type { CardColor } from "@riftbound/shared";
import { createGame, startTurn, type DeckDefinition } from "./setup.js";
import type { CardDef } from "./state.js";
import { makeCardDef } from "./test-utils.js";

function unit(might: number, energy = 1, color: CardColor = "fury"): CardDef {
  return makeCardDef({ type: "unit", name: "U", colors: [color], energy, might });
}
function rune(): CardDef {
  return makeCardDef({ type: "rune", name: "Rune" });
}
function deck(): DeckDefinition {
  return {
    legend: makeCardDef({ type: "legend", name: "L" }),
    main: Array.from({ length: 30 }, () => unit(2)),
    runes: Array.from({ length: 12 }, () => rune()),
    championZone: null,
  };
}
function bf(name: string): CardDef {
  return makeCardDef({ type: "battlefield", name, colors: ["colorless"] });
}

describe("rune channeling across turns", () => {
  it("accumulates the rune pool turn over turn for the same player (does not reset)", () => {
    let state = createGame([deck(), deck()], {
      seed: 1,
      firstPlayer: 0,
      battlefields: [bf("A"), bf("B")],
    });
    // Resolve the pre-game mulligan for both seats (keep hand) so real turns can start.
    state = { ...state, mulligan: { pending: null } };
    startTurn(state, 0); // P0 turn 1: channel 2 (first player, no bonus)
    expect(state.players[0].runePool.length).toBe(2);

    startTurn(state, 1); // P1 turn 1: channel 3 (second player's first-turn bonus)
    expect(state.players[1].runePool.length).toBe(3);

    startTurn(state, 0); // P0 turn 2: +2 more, should ACCUMULATE to 4, not reset to 2
    expect(state.players[0].runePool.length).toBe(4);

    startTurn(state, 1); // P1 turn 2: +2 more, accumulates to 5
    expect(state.players[1].runePool.length).toBe(5);
  });
});
