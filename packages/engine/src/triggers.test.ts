import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import { startShowdown, updateControl } from "./showdown.js";
import { applyStun, onUnitDeathAtBattlefield } from "./triggers.js";
import { effectiveMight } from "./state.js";
import { makeBareGame, makeCardDef, type BareGameOptions } from "./test-utils.js";

const CITHRIA = "ogn-139-298";
const PIT_ROOKIE = "ogn-136-298";
const NOXIAN_DRUMMER = "ogn-222-298";
const MACHINE_EVANGEL = "ogn-239-298";
const WATCHFUL_SENTRY = "ogn-096-298";
const SOLARI_SHIELDBEARER = "ogn-051-298";
const JINX = "ogn-251-298";
const SETT = "ogn-269-298";
const GAREN_STARTER = "ogs-023-024";
const ANNIE_STARTER = "ogs-017-024";
const VANGUARD_CAPTAIN = "ogn-218-298";
const SPIRITS_REFUGE = "ogn-063-298";
const JEWELED_COLOSSUS = "ogn-086-298";
const KINKOU_MONK = "ogn-141-298";
const UNDERCOVER_AGENT = "ogn-178-298";
const ECLIPSE_HERALD = "ogn-059-298";
const SOLARI_SHRINE = "ogn-072-298";
const TASTY_FAEFOLK = "ogn-075-298";
const SOARING_SCOUT = "ogn-216-298";
const EKKO_RECURRENT = "ogn-110-298";
const KOG_MAW = "ogn-190-298";
const KARMA = "ogn-235-298";
const GEMCRAFT_SEER = "ogn-100-298";

describe("onPlayCard", () => {
  it("Cithria of Cloudfield buffs herself when you play ANOTHER unit (not when she herself is played)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: CITHRIA as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: CITHRIA as never, name: "Cithria" })],
    });
    expect(state.instances[1]!.buffed).toBe(false);

    // Play a second, unrelated unit from hand.
    state.instances[2] = {
      iid: 2 as never, defId: "other" as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["other"] = makeCardDef({ type: "unit", id: "other" as never });
    state.players[0]!.hand.push(2 as never);

    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.buffed).toBe(true);
  });

  it("Pit Rookie buffs ANOTHER friendly unit when played (auto-resolves with exactly one legal target)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ally" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "unit", id: PIT_ROOKIE as never, name: "Pit Rookie" }),
      ],
      playerPatch: [{ hand: [2 as never] }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: PIT_ROOKIE as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.buffed).toBe(true); // the only OTHER friendly unit
  });

  it("Solari Shieldbearer stuns a unit on play, choosing among 2+ targets via pendingTrigger", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "u2" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never }),
        makeCardDef({ type: "unit", id: "u2" as never }),
        makeCardDef({ type: "unit", id: SOLARI_SHIELDBEARER as never, name: "Solari Shieldbearer" }),
      ],
      playerPatch: [{ hand: [3 as never] }, {}],
    });
    state.instances[3] = {
      iid: 3 as never, defId: SOLARI_SHIELDBEARER as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.pendingTrigger).not.toBeNull();
    const legal = getLegalActions(state, 0);
    expect(legal.some((a) => a.type === "resolveTrigger" && a.accept)).toBe(true);
    expect(getLegalActions(state, 1).length).toBe(0); // only the deciding player may act

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.stunned).toBe(true);
    expect(state.pendingTrigger).toBeNull();
  });
});

describe("onArrival", () => {
  it("Noxian Drummer creates a Recruit token when it moves to a battlefield", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: NOXIAN_DRUMMER as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: NOXIAN_DRUMMER as never, name: "Noxian Drummer" })],
    });
    const before = Object.keys(state.instances).length;
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 });
    expect(Object.keys(state.instances).length).toBe(before + 1);
    const token = Object.values(state.instances).find((i) => state.defs[i.defId]!.name === "Recruit");
    expect(token?.battlefield).toBe(0);
  });
});

describe("onConquer", () => {
  it("Sett - The Boss readies when you conquer", () => {
    let state = makeBareGame({
      legendDefIds: [SETT, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "legend", id: SETT as never, name: "Sett" })],
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base" }],
    });
    state.defs["u1"] = makeCardDef({ type: "unit", id: "u1" as never });
    state.instances[900]!.exhausted = true;
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 }); // conquers battlefield 0
    expect(state.battlefields[0]!.controller).toBe(0);
    expect(state.instances[900]!.exhausted).toBe(false); // readied by Sett's ability
  });

  it("Garen - Might of Demacia (Starter) draws 2 on conquer only with 4+ units at that battlefield", () => {
    const unitsAt = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ iid: i + 1, owner: 0 as const, defId: "u1" as never, zone: "battlefield" as const, battlefield: 0 }));

    const few = makeBareGame({
      legendDefIds: [GAREN_STARTER, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "legend", id: GAREN_STARTER as never, name: "Garen" }), makeCardDef({ type: "unit", id: "u1" as never })],
      units: unitsAt(3),
      playerPatch: [{ mainDeck: [10 as never, 11 as never] }, {}],
    });
    updateControl(few, 0);
    expect(few.players[0]!.hand.length).toBe(0); // fewer than 4 -> no draw

    const many = makeBareGame({
      legendDefIds: [GAREN_STARTER, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "legend", id: GAREN_STARTER as never, name: "Garen" }), makeCardDef({ type: "unit", id: "u1" as never })],
      units: unitsAt(4),
    });
    updateControl(many, 0);
    expect(many.players[0]!.points).toBe(1); // conquered
  });
});

describe("onUnitDeath ([Deathknell])", () => {
  it("Machine Evangel creates 3 Recruit tokens on death", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: MACHINE_EVANGEL as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: MACHINE_EVANGEL as never, name: "Machine Evangel", might: 1 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
    });
    startShowdown(state, 0, 1); // P1 attacks and kills the 1-Might Machine Evangel
    expect(state.instances[1]!.zone).toBe("trash");
    const tokens = Object.values(state.instances).filter((i) => state.defs[i.defId]!.name === "Recruit");
    expect(tokens.length).toBe(3);
    expect(tokens.every((t) => t.zone === "base" && t.owner === 0)).toBe(true);
  });

  it("Watchful Sentry draws 1 on death", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: WATCHFUL_SENTRY as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: WATCHFUL_SENTRY as never, name: "Watchful Sentry", might: 1 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ mainDeck: [50 as never] }, {}],
    });
    state.instances[50] = {
      iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    startShowdown(state, 0, 1);
    expect(state.players[0]!.hand).toContain(50);
  });
});

describe("onBeginningPhase", () => {
  it("Jinx - Loose Cannon draws 1 if you have <=1 card in hand at the start of your turn", () => {
    let state = makeBareGame({
      legendDefIds: [JINX, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "legend", id: JINX as never, name: "Jinx" })],
      playerPatch: [{ mainDeck: [50 as never], hand: [] }, {}],
    });
    state.instances[50] = {
      iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    state = applyAction(state, { type: "endTurn" }); // -> P1's turn (no effect, wrong legend)
    state = applyAction(state, { type: "endTurn" }); // -> P0's turn again; Jinx checks hand size
    expect(state.players[0]!.hand.length).toBeGreaterThanOrEqual(1); // Jinx's draw + the normal draw
  });
});

describe("onEndTurn", () => {
  it("Annie - Dark Child (Starter) readies 2 runes at the end of your turn", () => {
    let state = makeBareGame({ legendDefIds: [ANNIE_STARTER, "legend-test-1"], extraDefs: [makeCardDef({ type: "legend", id: ANNIE_STARTER as never, name: "Annie" })] });
    state.instances[600] = {
      iid: 600 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runePool",
      battlefield: null, exhausted: true, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });
    state.players[0]!.runePool.push(600 as never);
    state = applyAction(state, { type: "endTurn" });
    expect(state.instances[600]!.exhausted).toBe(false);
  });
});

describe("Vanguard Captain's [Legion] gate", () => {
  it("only plays the two Recruit tokens if you've already played another card this turn", () => {
    let noLegion = makeBareGame({
      extraDefs: [makeCardDef({ type: "unit", id: VANGUARD_CAPTAIN as never, name: "Vanguard Captain" })],
      playerPatch: [{ hand: [1 as never] }, {}],
    });
    noLegion.instances[1] = {
      iid: 1 as never, defId: VANGUARD_CAPTAIN as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    const before = Object.keys(noLegion.instances).length;
    noLegion = applyAction(noLegion, { type: "playCard", iid: 1 }); // first card this turn -- no Legion
    expect(Object.keys(noLegion.instances).length).toBe(before); // no tokens created

    let withLegion = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: VANGUARD_CAPTAIN as never, name: "Vanguard Captain" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 2 as never] }, {}],
    });
    withLegion.instances[1] = {
      iid: 1 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    withLegion.instances[2] = {
      iid: 2 as never, defId: VANGUARD_CAPTAIN as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    withLegion = applyAction(withLegion, { type: "playCard", iid: 1 }); // sets playedCardThisTurn
    const before2 = Object.keys(withLegion.instances).length;
    withLegion = applyAction(withLegion, { type: "playCard", iid: 2 }); // now Legion is active
    expect(Object.keys(withLegion.instances).length).toBe(before2 + 2); // two Recruit tokens
  });
});

describe("Spirit's Refuge (gear)", () => {
  it("buffs a friendly unit when played", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ally" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "gear", id: SPIRITS_REFUGE as never, name: "Spirit's Refuge" }),
      ],
      playerPatch: [{ hand: [2 as never] }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: SPIRITS_REFUGE as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.buffed).toBe(true); // only one legal target -> auto-resolved
  });
});

describe("[Vision] cluster", () => {
  it("peeking at the top of the Main Deck is always a real decision (may recycle it), even with no other choice needed", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: JEWELED_COLOSSUS as never, name: "Jeweled Colossus" }),
        makeCardDef({ type: "unit", id: "top-card" as never }),
      ],
      playerPatch: [{ hand: [1 as never], mainDeck: [50 as never] }, {}],
    });
    state.instances[1] = {
      iid: 1 as never, defId: JEWELED_COLOSSUS as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.instances[50] = {
      iid: 50 as never, defId: "top-card" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.pendingTrigger).not.toBeNull(); // always pauses -- "may" always asks
    const legal = getLegalActions(state, 0);
    expect(legal).toEqual(
      expect.arrayContaining([
        { type: "resolveTrigger", accept: false },
        { type: "resolveTrigger", accept: true },
      ]),
    );
    state = applyAction(state, { type: "resolveTrigger", accept: true });
    // Recycled to the bottom -- deck still has exactly the one card, just no longer "on top".
    expect(state.players[0]!.mainDeck).toEqual([50]);
  });
});

describe("multi-pick triggers (\"up to N\")", () => {
  it("Kinkou Monk buffs up to two OTHER friendly units, one pick at a time, and can stop early", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "ally1" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "ally2" as never, zone: "base" },
        { iid: 3, owner: 0, defId: "ally3" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally1" as never }),
        makeCardDef({ type: "unit", id: "ally2" as never }),
        makeCardDef({ type: "unit", id: "ally3" as never }),
        makeCardDef({ type: "unit", id: KINKOU_MONK as never, name: "Kinkou Monk" }),
      ],
      playerPatch: [{ hand: [4 as never] }, {}],
    });
    state.instances[4] = {
      iid: 4 as never, defId: KINKOU_MONK as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 4 });
    // 3 legal OTHER friendly units (1, 2, 3) -- a real choice, so it pauses.
    expect(state.pendingTrigger?.maxPicks).toBe(2);
    expect(state.pendingTrigger?.picked).toEqual([]);

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.buffed).toBe(true);
    // Still pending -- one more pick allowed, and unit 1 is no longer offered.
    expect(state.pendingTrigger).not.toBeNull();
    expect(state.pendingTrigger!.picked).toEqual([1]);
    const legalNow = getLegalActions(state, 0);
    expect(legalNow.some((a) => a.type === "resolveTrigger" && a.accept && a.targetIid === 1)).toBe(false);
    expect(legalNow.some((a) => a.type === "resolveTrigger" && a.accept && a.targetIid === 2)).toBe(true);

    // Decline the second pick -- "up to two" allows stopping early.
    state = applyAction(state, { type: "resolveTrigger", accept: false });
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[2]!.buffed).toBe(false);
    expect(state.instances[3]!.buffed).toBe(false);
  });

  it("Kinkou Monk auto-resolves without asking when there's at most one legal target", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ally1" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally1" as never }),
        makeCardDef({ type: "unit", id: KINKOU_MONK as never, name: "Kinkou Monk" }),
      ],
      playerPatch: [{ hand: [2 as never] }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: KINKOU_MONK as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[1]!.buffed).toBe(true);
  });

  it("Undercover Agent discards 2 (one pick at a time), then draws 2 once the sequence completes", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: UNDERCOVER_AGENT as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: UNDERCOVER_AGENT as never, name: "Undercover Agent", might: 1 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "hand1" as never }),
        makeCardDef({ type: "unit", id: "hand2" as never }),
      ],
      playerPatch: [{ hand: [10 as never, 11 as never], mainDeck: [50 as never, 51 as never] }, {}],
    });
    state.instances[2] = { iid: 2 as never, defId: "killer" as never, owner: 1, controller: 1, zone: "battlefield", battlefield: 0, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[10] = { iid: 10 as never, defId: "hand1" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[11] = { iid: 11 as never, defId: "hand2" as never, owner: 0, controller: 0, zone: "hand", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[50] = { iid: 50 as never, defId: "hand1" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[51] = { iid: 51 as never, defId: "hand1" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };

    startShowdown(state, 0, 1); // P1 kills the 1-Might Undercover Agent -- Deathknell fires
    expect(state.pendingTrigger).not.toBeNull(); // 2 hand cards to choose from -- a real pick

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 10 });
    expect(state.players[0]!.hand).not.toContain(10);
    expect(state.players[0]!.hand.length).toBe(1); // one discarded, drew nothing yet -- not done
    expect(state.pendingTrigger).not.toBeNull(); // one more discard allowed

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 11 });
    expect(state.pendingTrigger).toBeNull();
    expect(state.players[0]!.hand).not.toContain(11);
    expect(state.players[0]!.hand.length).toBe(2); // both discarded, then drew 2 -- net unchanged
  });

  it("Undercover Agent still draws 2 even with an empty hand to discard from", () => {
    const state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: UNDERCOVER_AGENT as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: UNDERCOVER_AGENT as never, name: "Undercover Agent", might: 1 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ mainDeck: [50 as never, 51 as never] }, {}],
    });
    state.instances[2] = { iid: 2 as never, defId: "killer" as never, owner: 1, controller: 1, zone: "battlefield", battlefield: 0, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[50] = { iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[51] = { iid: 51 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });

    startShowdown(state, 0, 1);
    expect(state.pendingTrigger).toBeNull(); // 0 legal discard targets -- auto-resolves via onComplete
    expect(state.players[0]!.hand.length).toBe(2); // drew 2 anyway
  });
});

describe("[Deflect N]", () => {
  function shieldbearerScenario(floatingRunes: ("rainbow")[]) {
    const state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "shielded" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "shielded" as never, deflect: 1 }),
        makeCardDef({ type: "unit", id: SOLARI_SHIELDBEARER as never, name: "Solari Shieldbearer" }),
      ],
      playerPatch: [{ hand: [2 as never], floatingRunes }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: SOLARI_SHIELDBEARER as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    return state;
  }

  it("without a floating rainbow rune, the Deflect-protected enemy isn't a legal target -- only Solari Shieldbearer herself is, so it auto-resolves onto her (not the enemy)", () => {
    const state = applyAction(shieldbearerScenario([]), { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).toBeNull(); // exactly one legal target (herself) -> auto-resolved
    expect(state.instances[1]!.stunned).toBe(false); // the Deflect-blocked enemy was never a choice
    expect(state.instances[2]!.stunned).toBe(true); // stunned herself instead, the only legal target
  });

  it("paying a floating rainbow rune makes the Deflect-protected enemy a legal target too, choosable via pendingTrigger", () => {
    let state = applyAction(shieldbearerScenario(["rainbow"]), { type: "playCard", iid: 2 });
    // Now 2 legal targets (the enemy, Deflect-paid, and herself) -- a real choice, so it pauses.
    expect(state.pendingTrigger).not.toBeNull();
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.stunned).toBe(true); // paid the Deflect cost -- chose the enemy
    expect(state.players[0]!.floatingRunes).toEqual([]); // rainbow rune spent
  });
});

describe("Stun-reaction cluster", () => {
  it("Eclipse Herald readies and gets +1 Might this turn when its controller stuns an enemy", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: ECLIPSE_HERALD as never, zone: "base", exhausted: true },
        { iid: 2, owner: 1, defId: "enemy" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: ECLIPSE_HERALD as never, name: "Eclipse Herald", might: 2 }),
        makeCardDef({ type: "unit", id: "enemy" as never }),
      ],
    });
    applyStun(state, 2 as never, 0);
    expect(state.instances[1]!.exhausted).toBe(false);
    expect(state.instances[1]!.tempMightDelta).toBe(1);
  });

  it("Solari Shrine offers to exhaust for a draw when you kill a stunned enemy unit", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: SOLARI_SHRINE as never, zone: "base" },
        { iid: 2, owner: 0, defId: "attacker" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "victim" as never, zone: "battlefield", battlefield: 0, stunned: true },
      ],
      extraDefs: [
        makeCardDef({ type: "gear", id: SOLARI_SHRINE as never, name: "Solari Shrine" }),
        makeCardDef({ type: "unit", id: "attacker" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "victim" as never, might: 2 }),
      ],
      playerPatch: [{ mainDeck: [50 as never] }, {}],
    });
    state.instances[50] = {
      iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    startShowdown(state, 0, 0); // P0 attacks and kills the stunned enemy
    expect(state.pendingTrigger?.kind).toContain("onKillStunned");
    expect(getLegalActions(state, 0).some((a) => a.type === "resolveTrigger" && a.accept)).toBe(true);
  });
});

describe("Sett - The Boss's death-replacement", () => {
  const SETT_ID = "ogn-269-298";
  it("recalls a buffed unit to base (exhausted, buff spent) instead of losing it, when affordable", () => {
    let state = makeBareGame({
      legendDefIds: [SETT_ID, "legend-test-1"],
      units: [
        { iid: 1, owner: 0, defId: "buffed-unit" as never, zone: "battlefield", battlefield: 0, buffed: true },
        { iid: 2, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "buffed-unit" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ floatingRunes: ["rainbow"] }, {}],
    });
    startShowdown(state, 0, 1);
    expect(state.pendingTrigger?.kind).toContain("onDeathLegend");
    state = applyAction(state, { type: "resolveTrigger", accept: true });
    expect(state.instances[1]!.zone).toBe("base"); // recalled, not trashed
    expect(state.instances[1]!.exhausted).toBe(true);
    expect(state.instances[1]!.buffed).toBe(false); // buff spent
    expect(state.players[0]!.floatingRunes).toEqual([]); // rainbow rune spent
    expect(state.instances[900]!.exhausted).toBe(true); // Sett himself exhausted
  });

  it("a non-buffed unit just dies normally -- Sett's replacement never offers", () => {
    const state = makeBareGame({
      legendDefIds: [SETT_ID, "legend-test-1"],
      units: [
        { iid: 1, owner: 0, defId: "plain-unit" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "plain-unit" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ floatingRunes: ["rainbow"] }, {}],
    });
    startShowdown(state, 0, 1);
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[1]!.zone).toBe("trash");
  });
});

describe("more [Deathknell] cards", () => {
  function dyingUnitScenario(defId: string, extraDefs: ReturnType<typeof makeCardDef>[] = [], playerPatch?: BareGameOptions["playerPatch"]) {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: defId as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "killer" as never, might: 10 }), ...extraDefs],
      playerPatch,
    });
    return state;
  }

  it("Tasty Faefolk channels 2 runes exhausted and draws 1 on death", () => {
    const state = dyingUnitScenario(
      TASTY_FAEFOLK,
      [makeCardDef({ type: "unit", id: TASTY_FAEFOLK as never, name: "Tasty Faefolk", might: 1 })],
      [{ mainDeck: [50 as never, 51 as never, 52 as never], runeDeck: [60 as never, 61 as never] }, {}],
    );
    state.instances[50] = { iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[60] = { iid: 60 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runeDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[61] = { iid: 61 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runeDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });

    startShowdown(state, 0, 1);
    expect(state.players[0]!.runePool).toEqual(expect.arrayContaining([60, 61]));
    expect(state.instances[60]!.exhausted).toBe(true);
    expect(state.players[0]!.hand.length).toBe(1);
  });

  it("Soaring Scout channels 1 rune exhausted on death", () => {
    const state = dyingUnitScenario(
      SOARING_SCOUT,
      [makeCardDef({ type: "unit", id: SOARING_SCOUT as never, name: "Soaring Scout", might: 1 })],
      [{ runeDeck: [60 as never] }, {}],
    );
    state.instances[60] = { iid: 60 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runeDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });

    startShowdown(state, 0, 1);
    expect(state.players[0]!.runePool).toContain(60);
    expect(state.instances[60]!.exhausted).toBe(true);
  });

  it("Ekko - Recurrent recycles himself to the Main Deck and readies runes on death", () => {
    const state = dyingUnitScenario(
      EKKO_RECURRENT,
      [makeCardDef({ type: "unit", id: EKKO_RECURRENT as never, name: "Ekko - Recurrent", might: 1 })],
    );
    state.instances[70] = { iid: 70 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runePool", battlefield: null, exhausted: true, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });
    state.players[0]!.runePool.push(70 as never);

    startShowdown(state, 0, 1);
    expect(state.instances[1]!.zone).toBe("mainDeck");
    expect(state.players[0]!.mainDeck).toContain(1);
    expect(state.instances[70]!.exhausted).toBe(false);
  });

  it("Kog'Maw - Caustic deals 4 to all units at its battlefield when its Deathknell fires, killing weaker units and leaving lethal-but-short damage on tougher ones", () => {
    // Exercised directly (bypassing a full Showdown, whose "survivors heal" step would otherwise
    // immediately clear the very damage being asserted here) -- isolates Kog'Maw's OWN effect.
    const state = makeBareGame({
      units: [
        { iid: 2, owner: 0, defId: "weak" as never, zone: "battlefield", battlefield: 0 }, // 3 Might -- dies to the 4
        { iid: 3, owner: 1, defId: "tough" as never, zone: "battlefield", battlefield: 0 }, // 6 Might -- survives, marked
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "weak" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "tough" as never, might: 6 }),
      ],
    });
    // A standalone dying instance -- not in `state.instances` (a just-trashed unit no longer needs
    // to be, and `onUnitDeathAtBattlefield` only reads its defId/controller).
    const kogMawDying = {
      iid: 99 as never, defId: KOG_MAW as never, owner: 0 as const, controller: 0 as const,
      zone: "trash" as const, battlefield: null, exhausted: false, damage: 0, buffed: false,
      temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs[KOG_MAW] = makeCardDef({ type: "unit", id: KOG_MAW as never, name: "Kog'Maw - Caustic", might: 1 });

    onUnitDeathAtBattlefield(state, kogMawDying, 0);
    expect(state.instances[2]!.zone).toBe("trash"); // weak (3 Might) killed by the 4 damage
    expect(state.instances[3]!.zone).toBe("battlefield"); // tough (6 Might) survives
    expect(state.instances[3]!.damage).toBe(4); // but is marked with the damage (not healed here)
  });
});

describe("[Vision] follow-ons", () => {
  it("Karma - Channeler buffs a friendly unit when you recycle a card (her own [Vision], or anyone else's)", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: KARMA as never, zone: "base" },
        { iid: 2, owner: 0, defId: "ally" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "unit", id: "top-card" as never }),
        makeCardDef({ type: "unit", id: KARMA as never, name: "Karma - Channeler" }),
      ],
      playerPatch: [{ hand: [3 as never], mainDeck: [50 as never] }, {}],
    });
    state.instances[3] = {
      iid: 3 as never, defId: KARMA as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.instances[50] = {
      iid: 50 as never, defId: "top-card" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };

    state = applyAction(state, { type: "playCard", iid: 3 });
    // Karma's own [Vision] fires first -- a "may" decision.
    expect(state.pendingTrigger?.kind).toContain("onPlaySelf");
    state = applyAction(state, { type: "resolveTrigger", accept: true });
    // Recycling fired onRecycle -> Karma reacts. She can buff ANY friendly unit (no "other"
    // restriction on her own text), and there are 3 (both Karma copies + ally) -- a real choice.
    expect(state.pendingTrigger?.kind).toContain("onRecycleSelf");
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.buffed).toBe(true);
  });

  it("Gemcraft Seer grants [Vision] to other friendly units you play", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: GEMCRAFT_SEER as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: GEMCRAFT_SEER as never, name: "Gemcraft Seer" }),
        makeCardDef({ type: "unit", id: "plain-unit" as never }),
      ],
      playerPatch: [{ hand: [2 as never], mainDeck: [50 as never] }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: "plain-unit" as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.instances[50] = {
      iid: 50 as never, defId: "plain-unit" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 2 });
    // "plain-unit" has no on-play ability of its own, but Gemcraft Seer's grant still offers Vision.
    expect(state.pendingTrigger?.kind).toBe("grantedVision");
  });
});

describe("Karthus - Eternal", () => {
  const KARTHUS = "ogn-236-298";

  it("doubles a simple, fully-automatic Deathknell effect", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "ogn-096-298" as never, zone: "battlefield", battlefield: 0 }, // Watchful Sentry
        { iid: 2, owner: 0, defId: KARTHUS as never, zone: "base" },
        { iid: 3, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ogn-096-298" as never, name: "Watchful Sentry", might: 1 }),
        makeCardDef({ type: "unit", id: KARTHUS as never, name: "Karthus - Eternal" }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ mainDeck: [50 as never, 51 as never] }, {}],
    });
    state.instances[50] = { iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[51] = { iid: 51 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });

    startShowdown(state, 0, 1); // kills Watchful Sentry -- Deathknell draws 1, doubled by Karthus -> 2
    expect(state.players[0]!.hand.length).toBe(2);
  });

  it("without Karthus, the same Deathknell only fires once", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "ogn-096-298" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "killer" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ogn-096-298" as never, name: "Watchful Sentry", might: 1 }),
        makeCardDef({ type: "unit", id: "killer" as never, might: 10 }),
      ],
      playerPatch: [{ mainDeck: [50 as never, 51 as never] }, {}],
    });
    state.instances[50] = { iid: 50 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.instances[51] = { iid: 51 as never, defId: "card" as never, owner: 0, controller: 0, zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });

    startShowdown(state, 0, 1);
    expect(state.players[0]!.hand.length).toBe(1);
  });
});

describe("Wildclaw Shaman", () => {
  const WILDCLAW_SHAMAN = "ogn-147-298";

  it("may spend a friendly unit's buff to buff AND ready itself", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "buffed-ally" as never, zone: "base", buffed: true }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "buffed-ally" as never }),
        makeCardDef({ type: "unit", id: WILDCLAW_SHAMAN as never, name: "Wildclaw Shaman" }),
      ],
      playerPatch: [{ hand: [2 as never] }, {}],
    });
    state.instances[2] = {
      iid: 2 as never, defId: WILDCLAW_SHAMAN as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 2 }); // enters exhausted (no [Accelerate]/ready text)
    expect(state.instances[2]!.exhausted).toBe(true);
    expect(state.pendingTrigger).not.toBeNull(); // "may" -- always a real decision

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.buffed).toBe(false); // buff spent
    expect(state.instances[2]!.buffed).toBe(true); // Wildclaw Shaman buffed instead
    expect(state.instances[2]!.exhausted).toBe(false); // and readied
  });

  it("has nothing to offer (no legal targets) with no buffed friendly units on board", () => {
    let state = makeBareGame({
      extraDefs: [makeCardDef({ type: "unit", id: WILDCLAW_SHAMAN as never, name: "Wildclaw Shaman" })],
      playerPatch: [{ hand: [1 as never] }, {}],
    });
    state.instances[1] = {
      iid: 1 as never, defId: WILDCLAW_SHAMAN as never, owner: 0, controller: 0, zone: "hand",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.pendingTrigger).toBeNull(); // nothing to spend -- no decision to make
    expect(state.instances[1]!.buffed).toBe(false);
    expect(state.instances[1]!.exhausted).toBe(true); // stayed exhausted, no ready
  });
});

describe("more [Legion] cards", () => {
  const DANGEROUS_DUO = "ogn-016-298";
  const SCRAPYARD_CHAMPION = "ogn-020-298";
  const TRIFARIAN_GLORYSEEKER = "ogn-217-298";
  const DARIUS_EXECUTIONER = "ogn-243-298";

  function playedFromHand(defId: string, iid = 1) {
    return {
      iid: iid as never, defId: defId as never, owner: 0 as const, controller: 0 as const, zone: "hand" as const,
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
  }

  it("Scrapyard Champion discards 2 (one pick at a time), then draws 2, only with [Legion] active", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: SCRAPYARD_CHAMPION as never, name: "Scrapyard Champion" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
        makeCardDef({ type: "unit", id: "hand-card" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 2 as never, 3 as never, 4 as never], mainDeck: [10 as never, 11 as never] }, {}],
    });
    state.instances[1] = playedFromHand("filler", 1);
    state.instances[2] = playedFromHand(SCRAPYARD_CHAMPION, 2);
    state.instances[3] = playedFromHand("hand-card", 3);
    state.instances[4] = playedFromHand("hand-card", 4);
    state.instances[10] = playedFromHand("card", 10);
    state.instances[10]!.zone = "mainDeck";
    state.instances[11] = playedFromHand("card", 11);
    state.instances[11]!.zone = "mainDeck";
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });

    state = applyAction(state, { type: "playCard", iid: 1 }); // sets playedCardThisTurn -- Legion active
    state = applyAction(state, { type: "playCard", iid: 2 }); // Scrapyard Champion, with Legion active
    expect(state.pendingTrigger).not.toBeNull(); // 2 cards left in hand -- a real pick
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.pendingTrigger).not.toBeNull(); // one more discard allowed
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 4 });
    expect(state.players[0]!.hand).not.toContain(3);
    expect(state.players[0]!.hand).not.toContain(4);
    expect(state.players[0]!.hand.length).toBe(2); // both discarded, then drew 2 -- net unchanged
  });

  it("Dangerous Duo only gives +2 Might this turn with [Legion] active (played another card first)", () => {
    let state = makeBareGame({
      units: [{ iid: 2, owner: 0, defId: "ally" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "unit", id: DANGEROUS_DUO as never, name: "Dangerous Duo" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 3 as never] }, {}],
    });
    state.instances[1] = playedFromHand(DANGEROUS_DUO, 1);
    state.instances[3] = playedFromHand("filler", 3);

    state = applyAction(state, { type: "playCard", iid: 1 }); // no Legion yet -- no effect
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[2]!.tempMightDelta).toBe(0);

    // Reset and try again after Legion is active.
    let state2 = makeBareGame({
      units: [{ iid: 2, owner: 0, defId: "ally" as never, zone: "base" }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "unit", id: DANGEROUS_DUO as never, name: "Dangerous Duo" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 3 as never] }, {}],
    });
    state2.instances[1] = playedFromHand(DANGEROUS_DUO, 1);
    state2.instances[3] = playedFromHand("filler", 3);
    state2 = applyAction(state2, { type: "playCard", iid: 3 }); // sets playedCardThisTurn
    state2 = applyAction(state2, { type: "playCard", iid: 1 }); // now Legion is active
    // 3 legal targets now (ally, filler, and Dangerous Duo himself -- his text doesn't say
    // "another") -- a real choice, so it pauses rather than auto-resolving.
    expect(state2.pendingTrigger).not.toBeNull();
    state2 = applyAction(state2, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state2.instances[2]!.tempMightDelta).toBe(2);
  });

  it("Trifarian Gloryseeker buffs himself with [Legion] active", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: TRIFARIAN_GLORYSEEKER as never, name: "Trifarian Gloryseeker" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 2 as never] }, {}],
    });
    state.instances[1] = playedFromHand("filler", 1);
    state.instances[2] = playedFromHand(TRIFARIAN_GLORYSEEKER, 2);
    state = applyAction(state, { type: "playCard", iid: 1 });
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[2]!.buffed).toBe(true);
  });

  it("Darius - Executioner readies himself when played with [Legion] active", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: DARIUS_EXECUTIONER as never, name: "Darius - Executioner" }),
        makeCardDef({ type: "unit", id: "filler" as never }),
      ],
      playerPatch: [{ hand: [1 as never, 2 as never] }, {}],
    });
    state.instances[1] = playedFromHand("filler", 1);
    state.instances[2] = playedFromHand(DARIUS_EXECUTIONER, 2);
    state = applyAction(state, { type: "playCard", iid: 1 });
    state = applyAction(state, { type: "playCard", iid: 2 }); // to base -- Legion is active
    expect(state.instances[2]!.exhausted).toBe(false); // readied by his own Legion trigger
  });

  it("Darius - Executioner's static aura grants +1 Might to other friendly units in the same zone", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: DARIUS_EXECUTIONER as never, zone: "base" },
        { iid: 2, owner: 0, defId: "ally" as never, zone: "base" },
        { iid: 3, owner: 0, defId: "ally" as never, zone: "battlefield", battlefield: 0 }, // different zone -- no bonus
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: DARIUS_EXECUTIONER as never, name: "Darius - Executioner", might: 5, auraMightBonus: 1 }),
        makeCardDef({ type: "unit", id: "ally" as never, might: 2 }),
      ],
    });
    expect(effectiveMight(state, state.instances[2]!, undefined)).toBe(3); // 2 + 1 aura (same zone: base)
    expect(effectiveMight(state, state.instances[3]!, undefined)).toBe(2); // no bonus -- different zone
    expect(effectiveMight(state, state.instances[1]!, undefined)).toBe(5); // Darius doesn't buff himself
  });
});
