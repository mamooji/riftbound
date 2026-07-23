/**
 * Phase 2 of the Chain/Priority/Reaction plan: the Showdown's pre-combat Action Window
 * (rule 340-345). Only `[Action]`/`[Reaction]`-timed spells can be played here; damage totals are
 * computed FRESH once the window closes (not at Showdown creation), and Focus can belong to
 * either player -- including the defender, mid the attacker's own turn. Since nothing can yet
 * RESPOND to a played spell (no Reaction spells are scripted until Phase 3), a window auto-closes
 * and cascades straight into full combat resolution the instant nobody has anything left to
 * play -- all synchronously, within the same `applyAction` call. Tests check the resulting FINAL
 * state, not an artificial midpoint the engine never actually pauses at.
 */
import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import type { CardInstance, GameState } from "./state.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

const INCINERATE = "ogs-003-024";
const HEXTECH_RAY = "ogn-009-298";
const PRIMAL_STRENGTH = "ogn-154-298";

function putInHand(state: GameState, iid: number, owner: 0 | 1, defId: string): CardInstance {
  const inst: CardInstance = {
    iid: iid as never, defId: defId as never, owner, controller: owner, zone: "hand",
    battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
    stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
  };
  state.instances[iid] = inst;
  state.players[owner]!.hand.push(iid as never);
  return inst;
}

function actionSpellDef(id: string, energy: number, power: number) {
  return makeCardDef({ type: "spell", id: id as never, energy, power, timing: "action", name: id });
}

describe("Showdown Action Window auto-closes instantly when nobody has anything to play", () => {
  it("opens and closes the window in the same synchronous call -- combat resolves exactly as before Phase 2", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "u2" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "u2" as never, might: 3 }),
      ],
    });
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    expect(state.showdown).toBeNull(); // no Action Window remnants; combat already fully resolved
    expect(state.instances[2]!.zone).toBe("trash"); // 10 >= 3, lethal
  });
});

describe("The attacker may play an [Action] spell during the window before combat math runs", () => {
  it("Incinerate kills the sole defender before any Showdown combat would otherwise occur", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, INCINERATE);

    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 }); // opens the window (attacker has Focus)
    expect(state.showdown).not.toBeNull();
    expect(state.showdown!.windowOpen).toBe(true);
    expect(state.showdown!.focus).toBe(0);
    expect(getLegalActions(state, 1)).toEqual([]); // defender has no Focus, no legal actions
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 3)).toBe(true);
    expect(getLegalActions(state, 0).some((a) => a.type === "pass")).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    // Incinerate's 2 damage killed the defender outright; nobody else has anything, so the window
    // auto-closes and finds an uncontested battlefield -- no combat ever needed.
    expect(state.instances[2]!.zone).toBe("trash");
    expect(state.showdown).toBeNull();
    expect(state.battlefields[0]!.controller).toBe(0);
  });

  it("the attacker may choose to PASS instead of using it -- combat then runs on the unmodified board", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, INCINERATE);
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    state = applyAction(state, { type: "pass" }); // declines Incinerate; defender has nothing -> cascades to combat
    expect(state.showdown).toBeNull();
    expect(state.players[0]!.hand).toContain(3 as never); // Incinerate was never played, still in hand
    expect(state.instances[2]!.zone).toBe("trash"); // died to ordinary combat instead (3 might >= 2)
  });

  it("a second copy in hand keeps the window open for the SAME player after the first play resolves", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "d1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "d2" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 1 }),
        makeCardDef({ type: "unit", id: "d1" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "d2" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
      ],
      playerPatch: [{ energy: 4, power: 0, hand: [] }, {}],
    });
    putInHand(state, 4, 0, INCINERATE);
    putInHand(state, 5, 0, INCINERATE);

    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    state = applyAction(state, { type: "playCard", iid: 4 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    // The first Incinerate killed d1; focus should have come right back to the SAME player (the
    // opponent had nothing), and the second copy is still a legal play -- the window did not
    // erroneously close after only one round.
    expect(state.showdown!.windowOpen).toBe(true);
    expect(state.showdown!.focus).toBe(0);
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 5)).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 5 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.instances[2]!.zone).toBe("trash");
    expect(state.instances[3]!.zone).toBe("trash");
    expect(state.showdown).toBeNull(); // both copies spent, nothing left for either side -> closed
  });
});

describe("The DEFENDER may also hold Focus and play their own spell, mid the attacker's turn", () => {
  it("focus opens directly on the defender when the attacker has nothing to play at all", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        actionSpellDef(HEXTECH_RAY, 1, 1),
      ],
      playerPatch: [{}, { energy: 1, power: 1, hand: [] }],
    });
    putInHand(state, 3, 1, HEXTECH_RAY);

    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    // P0 (attacker) never had anything, so the auto-advance already skipped straight to P1.
    expect(state.showdown!.windowOpen).toBe(true);
    expect(state.showdown!.focus).toBe(1);
    expect(getLegalActions(state, 0)).toEqual([]);
    expect(getLegalActions(state, 1).some((a) => a.type === "playCard" && a.iid === 3)).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 3 }); // P1 plays it as THEMSELVES, not P0 (activePlayer)
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 }); // targets the attacker
    // Window closes (nobody has anything left); ordinary combat then runs on the post-spell board:
    // attacker took 3 from the spell + 2 more from the defender's forced combat assignment = 5,
    // well under its 10 Might, so it survives and heals; the 2-Might defender dies as normal.
    expect(state.showdown).toBeNull();
    expect(state.instances[1]!.zone).toBe("battlefield");
    expect(state.instances[1]!.damage).toBe(0); // survived and healed
    expect(state.instances[2]!.zone).toBe("trash");
  });
});

describe("Damage totals are computed FRESH when the window closes, reflecting spells played during it", () => {
  it("Primal Strength's +7 Might this turn is included in the Showdown's combat math", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 2 }), // alone, would NOT kill the defender
        makeCardDef({ type: "unit", id: "defender" as never, might: 8 }),
        actionSpellDef(PRIMAL_STRENGTH, 4, 1),
      ],
      playerPatch: [{ energy: 4, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, PRIMAL_STRENGTH);

    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 }); // buff the attacker
    // The window auto-closed in the same call (nobody had anything left), so combat has already
    // run by the time control returns here.
    expect(state.showdown).toBeNull();
    // Attacker's effective Might (2 + 7 buff = 9) is what killed the 8-Might defender -- proving
    // the totals used 9, not the stale pre-window 2.
    expect(state.instances[2]!.zone).toBe("trash");
  });
});
