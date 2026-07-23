import { describe, it, expect } from "vitest";
import { VICTORY_POINTS_TO_WIN } from "@riftbound/shared";
import { startTurn, endOfTurnPhase } from "./turn.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

function putInTrash(state: ReturnType<typeof makeBareGame>, iid: number, owner: 0 | 1, defId: string): void {
  state.instances[iid] = {
    iid: iid as never,
    defId: defId as never,
    owner,
    controller: owner,
    zone: "trash",
    battlefield: null,
    exhausted: false,
    damage: 0,
    buffed: false,
    temporary: false,
    stunned: false,
    tempMightDelta: 0,
    gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
  };
}

describe("Burn Out (rule 418)", () => {
  it("recycles the Trash into the Main Deck (shuffled) and gives the opponent 1 point when a draw is needed with an empty Main Deck", () => {
    const state = makeBareGame({ playerPatch: [{ mainDeck: [], hand: [] }, {}] });
    const def = makeCardDef({ type: "unit", id: "trashed" as never, might: 1 });
    state.defs[def.id] = def;
    for (const iid of [501, 502, 503]) putInTrash(state, iid, 0, def.id);

    const before = state.players[1]!.points;
    startTurn(state, 0); // Draw Phase needs a card with an empty Main Deck -> Burn Out
    expect(state.players[0]!.mainDeck.length).toBe(2); // 3 recycled in, 1 drawn back out
    expect(state.players[0]!.hand.length).toBe(1);
    expect(state.players[1]!.points).toBe(before + 1); // opponent scores 1, not the burning-out player
    expect(Object.values(state.instances).some((i) => i.zone === "trash" && i.owner === 0)).toBe(false);
  });

  it("is a plain repeatable point award, NOT an instant loss, when the Trash is also empty -- it just burns out again next Draw attempt", () => {
    const state = makeBareGame({
      playerPatch: [{ mainDeck: [], hand: [] }, { points: VICTORY_POINTS_TO_WIN - 1 }],
    });
    startTurn(state, 0); // Main Deck AND Trash both empty -> one burn out is enough to win here
    expect(state.players[1]!.points).toBe(VICTORY_POINTS_TO_WIN);
    expect(state.winner).toBe(1);
  });

  it("bounded repeat: with nothing to recycle at all, it fires repeatedly until the opponent reaches the Victory Score, then stops", () => {
    const state = makeBareGame({ playerPatch: [{ mainDeck: [], hand: [] }, {}] });
    startTurn(state, 0);
    expect(state.players[1]!.points).toBe(VICTORY_POINTS_TO_WIN);
    expect(state.winner).toBe(1);
  });
});

describe("End of Turn Phase heals ALL units on the board (rule 140.3.b / 317.2.b)", () => {
  it("clears damage dealt outside of a Showdown this turn (e.g. Kog'Maw's Deathknell), not just Showdown survivors", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u2" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "u2" as never, might: 5 }),
      ],
    });
    state.instances[1]!.damage = 3;
    state.instances[2]!.damage = 2;

    endOfTurnPhase(state, 0);

    expect(state.instances[1]!.damage).toBe(0);
    expect(state.instances[2]!.damage).toBe(0);
  });
});
