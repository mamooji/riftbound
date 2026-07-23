import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import type { CardInstance, GameState } from "./state.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

/** Manually places a card instance directly into a player's hand -- the same pattern already used
 *  by abilities.test.ts, since `makeBareGame`'s `units` option only models board units. */
function putInHand(state: GameState, iid: number, owner: 0 | 1, defId: string): CardInstance {
  const inst: CardInstance = {
    iid: iid as never,
    defId: defId as never,
    owner,
    controller: owner,
    zone: "hand",
    battlefield: null,
    exhausted: false,
    damage: 0,
    buffed: false,
    temporary: false,
    stunned: false,
    tempMightDelta: 0,
    gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
  };
  state.instances[iid] = inst;
  state.players[owner]!.hand.push(iid as never);
  return inst;
}

function putInTrash(state: GameState, iid: number, owner: 0 | 1, defId: string): CardInstance {
  const inst = putInHand(state, iid, owner, defId);
  state.players[owner]!.hand = state.players[owner]!.hand.filter((h) => h !== (iid as never));
  inst.zone = "trash";
  return inst;
}

const FALLING_STAR = "ogn-029-298";
const CHARM = "ogn-043-298";
const REINFORCE = "ogn-062-298";
const SINGULARITY = "ogn-105-298";
const PROGRESS_DAY = "ogn-114-298";
const TIME_WARP = "ogn-122-298";
const UNCHECKED_POWER = "ogn-123-298";
const MOBILIZE = "ogn-134-298";
const SABOTAGE = "ogn-156-298";
const FADING_MEMORIES = "ogn-180-298";
const WHIRLWIND = "ogn-187-298";
const THE_HARROWING = "ogn-198-298";
const INVERT_TIMELINES = "ogn-201-298";
const CULL_THE_WEAK = "ogn-209-298";
const VENGEANCE = "ogn-229-298";
const KINGS_EDICT = "ogn-237-298";
const ICATHIAN_RAIN = "ogn-248-298";
const STORMBRINGER = "ogn-250-298";
const SUPER_MEGA_DEATH_ROCKET = "ogn-252-298";
const SHOWSTOPPER = "ogn-270-298";
const FIRESTORM = "ogs-002-024";

function spellDef(id: string, energy: number, power: number) {
  return makeCardDef({ type: "spell", id: id as never, energy, power, name: id });
}

describe("Falling Star: Deal 3 to a unit. Deal 3 to a unit. (multi-pick, up to 2)", () => {
  it("deals 3 damage per pick, killing a 3-Might unit on the first hit", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u2" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "u2" as never, might: 10 }),
        spellDef(FALLING_STAR, 2, 2),
      ],
      playerPatch: [{ energy: 2, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, FALLING_STAR);

    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[3]!.zone).toBe("trash");
    expect(state.pendingTrigger).not.toBeNull();

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("trash"); // 3 damage kills the 3-Might unit
    expect(state.pendingTrigger).not.toBeNull(); // second "deal 3" still pending

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.damage).toBe(3); // survives, marked
    expect(state.pendingTrigger).toBeNull();
  });
});

describe("Singularity: Deal 6 to each of up to two units", () => {
  it("lets the player decline the second pick (a genuine 'up to') when a second target exists", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 10 }), spellDef(SINGULARITY, 6, 2)],
      playerPatch: [{ energy: 6, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, SINGULARITY);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.damage).toBe(6);
    state = applyAction(state, { type: "resolveTrigger", accept: false }); // decline the second pick
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[2]!.damage).toBe(0); // untouched -- genuinely declined, not forced
  });

  it("auto-resolves without a decision when only one target exists (skip when forced)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 10 }), spellDef(SINGULARITY, 6, 2)],
      playerPatch: [{ energy: 6, power: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SINGULARITY);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).toBeNull();
    expect(state.instances[1]!.damage).toBe(6);
  });
});

describe("Vengeance: Kill a unit", () => {
  it("auto-resolves onto the sole legal target with no decision needed", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 99 }), spellDef(VENGEANCE, 4, 2)],
      playerPatch: [{ energy: 4, power: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, VENGEANCE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("trash");
  });

  it("kills whichever of two candidates the player actually chooses", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 99 }), spellDef(VENGEANCE, 4, 2)],
      playerPatch: [{ energy: 4, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, VENGEANCE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.zone).toBe("trash");
    expect(state.instances[1]!.zone).toBe("battlefield"); // the OTHER candidate is untouched
  });
});

describe("Charm: Move an enemy unit (simplified to a forced retreat to base)", () => {
  it("moves the chosen enemy unit from its battlefield to base and updates control", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spellDef(CHARM, 1, 1)],
      battlefieldControllers: [1, 1],
      playerPatch: [{ energy: 1, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, CHARM);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("base");
    expect(state.instances[1]!.battlefield).toBeNull();
    expect(state.battlefields[0]!.controller).toBeNull();
    expect(state.instances[2]!.zone).toBe("battlefield"); // the other candidate stays put
  });
});

describe("Progress Day: Draw 4", () => {
  it("draws exactly 4 cards with no target needed", () => {
    let state = makeBareGame({
      extraDefs: [spellDef(PROGRESS_DAY, 6, 1)],
      playerPatch: [{ energy: 6, power: 1, hand: [], mainDeck: [] }, {}],
    });
    for (let i = 0; i < 4; i++) {
      const iid = 100 + i;
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 2, 0, PROGRESS_DAY);
    const before = state.players[0]!.hand.length;
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.players[0]!.hand.length).toBe(before - 1 + 4); // spell leaves hand, then draw 4
  });
});

describe("Unchecked Power: Exhaust all friendly units, then deal 12 to ALL units at battlefields", () => {
  it("hits both sides at every battlefield, and exhausts only the caster's own units", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mine" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "theirs" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "theirs" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "mine" as never, might: 20 }),
        makeCardDef({ type: "unit", id: "theirs" as never, might: 20 }),
        spellDef(UNCHECKED_POWER, 7, 2),
      ],
      playerPatch: [{ energy: 7, power: 2, hand: [] }, {}],
    });
    putInHand(state, 4, 0, UNCHECKED_POWER);
    state = applyAction(state, { type: "playCard", iid: 4 });
    expect(state.instances[1]!.exhausted).toBe(true);
    expect(state.instances[1]!.damage).toBe(12);
    expect(state.instances[2]!.damage).toBe(12);
    expect(state.instances[3]!.damage).toBe(12);
  });
});

describe("Firestorm: Deal 3 to all enemy units at a battlefield (a real battlefield choice)", () => {
  it("only damages enemy units at the CHOSEN battlefield, leaving the other untouched", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u2" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "u2" as never, might: 10 }),
        spellDef(FIRESTORM, 6, 1),
      ],
      playerPatch: [{ energy: 6, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, FIRESTORM);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.pendingTrigger).not.toBeNull();
    const legal = getLegalActions(state, 0);
    expect(legal.some((a) => a.type === "resolveTrigger" && a.battlefield === 0)).toBe(true);
    expect(legal.some((a) => a.type === "resolveTrigger" && a.battlefield === 1)).toBe(true);

    state = applyAction(state, { type: "resolveTrigger", accept: true, battlefield: 0 });
    expect(state.instances[1]!.damage).toBe(3);
    expect(state.instances[2]!.damage).toBe(0);
  });
});

describe("Mobilize: Channel 1 rune exhausted. If you can't, draw 1", () => {
  it("draws instead when the Rune Deck is empty", () => {
    let state = makeBareGame({
      extraDefs: [spellDef(MOBILIZE, 2, 0)],
      playerPatch: [{ energy: 2, power: 0, hand: [], runeDeck: [], mainDeck: [] }, {}],
    });
    state.instances[50] = {
      iid: 50 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.players[0]!.mainDeck.push(50 as never);
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 2, 0, MOBILIZE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.players[0]!.hand).toContain(50 as never); // drew the filler card
  });
});

describe("Sabotage: opponent reveals their hand; choose a non-unit card and recycle it", () => {
  it("can only choose a non-unit card from the opponent's hand", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: "unit-card" as never }),
        makeCardDef({ type: "gear", id: "gear-card" as never }),
        makeCardDef({ type: "spell", id: "spell-card" as never }),
        spellDef(SABOTAGE, 1, 1),
      ],
      playerPatch: [{ energy: 1, power: 1, hand: [] }, { hand: [] }],
    });
    putInHand(state, 2, 1, "unit-card");
    putInHand(state, 3, 1, "gear-card");
    putInHand(state, 5, 1, "spell-card"); // a second non-unit candidate keeps the pick a real choice
    putInHand(state, 4, 0, SABOTAGE);
    state = applyAction(state, { type: "playCard", iid: 4 });
    const legal = getLegalActions(state, 0);
    expect(legal.some((a) => a.type === "resolveTrigger" && a.targetIid === 2)).toBe(false); // unit excluded
    expect(legal.some((a) => a.type === "resolveTrigger" && a.targetIid === 3)).toBe(true);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.instances[3]!.zone).toBe("mainDeck");
    expect(state.players[1]!.hand).not.toContain(3 as never);
  });
});

describe("The Harrowing: Play a unit from your trash, ignoring its Energy cost", () => {
  it("plays the trashed unit to base, paying only its Power cost", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: "revived" as never, energy: 5, power: 1 }),
        makeCardDef({ type: "unit", id: "other" as never, energy: 5, power: 1 }),
        spellDef(THE_HARROWING, 6, 2),
      ],
      playerPatch: [{ energy: 6, power: 3, hand: [] }, {}],
    });
    putInTrash(state, 2, 0, "revived");
    putInTrash(state, 5, 0, "other"); // a second trashed candidate keeps the pick a real choice
    putInHand(state, 3, 0, THE_HARROWING);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.zone).toBe("base");
    expect(state.instances[5]!.zone).toBe("trash"); // the other candidate stays in trash
    expect(state.players[0]!.power).toBe(0); // 3 - 2 (casting The Harrowing) - 1 (reviving the unit)
  });
});

describe("Cull the Weak: each player kills one of their own units (opponent decides first)", () => {
  it("lets the opponent choose first, then chains to the caster's own choice", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mine" as never, zone: "base" },
        { iid: 4, owner: 0, defId: "mine" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "theirs" as never, zone: "base" },
        { iid: 5, owner: 1, defId: "theirs" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "mine" as never }),
        makeCardDef({ type: "unit", id: "theirs" as never }),
        spellDef(CULL_THE_WEAK, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, CULL_THE_WEAK);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.pendingTrigger!.player).toBe(1); // opponent decides first
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.zone).toBe("trash");
    expect(state.instances[5]!.zone).toBe("base"); // untouched candidate stays
    expect(state.pendingTrigger!.player).toBe(0); // chained to the caster
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("trash");
  });
});

describe("King's Edict: the opponent chooses one of their OWN units to kill", () => {
  it("the deciding player is the opponent, not the caster", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "theirs" as never, zone: "base" },
        { iid: 4, owner: 1, defId: "theirs" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "theirs" as never }), spellDef(KINGS_EDICT, 6, 2)],
      playerPatch: [{ energy: 6, power: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, KINGS_EDICT);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(getLegalActions(state, 0)).toEqual([]); // caster has no decision here
    expect(state.pendingTrigger!.player).toBe(1);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.instances[4]!.zone).toBe("base"); // the untouched candidate stays
  });
});

describe("Whirlwind: starting with the next player, each player may return a unit to hand", () => {
  it("lets the opponent decline, then the caster still gets their own chance", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "mine" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "mine" as never }), spellDef(WHIRLWIND, 3, 1)],
      playerPatch: [{ energy: 3, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, WHIRLWIND);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger!.player).toBe(1);
    state = applyAction(state, { type: "resolveTrigger", accept: false }); // opponent declines (nothing to bounce)
    expect(state.pendingTrigger!.player).toBe(0);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("hand");
    expect(state.players[0]!.hand).toContain(1 as never);
  });
});

describe("Time Warp: Take a turn after this one. Banish this.", () => {
  it("queues an extra turn and banishes itself instead of going to trash", () => {
    let state = makeBareGame({
      extraDefs: [spellDef(TIME_WARP, 10, 4)],
      playerPatch: [{ energy: 10, power: 4, hand: [] }, {}],
    });
    putInHand(state, 2, 0, TIME_WARP);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[2]!.zone).toBe("banishment");
    expect(state.players[0]!.extraTurns).toBe(1);

    state = applyAction(state, { type: "endTurn" });
    expect(state.activePlayer).toBe(0); // same player goes again
    expect(state.players[0]!.extraTurns).toBe(0); // consumed

    state = applyAction(state, { type: "endTurn" });
    expect(state.activePlayer).toBe(1); // now it alternates normally
  });
});

describe("Reinforce: look at top 5, may banish+play a unit (5 Energy cheaper), recycle the rest", () => {
  it("accept path: plays the chosen unit for its discounted cost and recycles the other 4", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: "big-unit" as never, energy: 5, power: 0 }),
        spellDef(REINFORCE, 5, 0),
      ],
      playerPatch: [{ energy: 5, power: 0, hand: [], mainDeck: [] }, {}],
    });
    const topFive = [201, 202, 203, 204, 205];
    for (const iid of topFive) {
      state.instances[iid] = {
        iid: iid as never, defId: (iid === 201 ? "big-unit" : "filler") as never, owner: 0, controller: 0,
        zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    state.defs["filler"] = makeCardDef({ type: "spell", id: "filler" as never });
    putInHand(state, 300, 0, REINFORCE);
    state = applyAction(state, { type: "playCard", iid: 300 });
    expect(getLegalActions(state, 0).some((a) => a.type === "resolveTrigger" && a.targetIid === 201)).toBe(true);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 201 });
    expect(state.instances[201]!.zone).toBe("base"); // played for free (5 - 5 discount = 0 Energy)
    expect(state.players[0]!.energy).toBe(0); // the 5 was already spent casting Reinforce itself
    for (const iid of [202, 203, 204, 205]) {
      expect(state.players[0]!.mainDeck).toContain(iid as never); // recycled back in
    }
  });

  it("decline path: recycles all 5 revealed cards, nothing played", () => {
    let state = makeBareGame({
      extraDefs: [
        makeCardDef({ type: "unit", id: "big-unit" as never, energy: 5, power: 0 }),
        spellDef(REINFORCE, 5, 0),
      ],
      playerPatch: [{ energy: 5, power: 0, hand: [], mainDeck: [] }, {}],
    });
    const topFive = [201, 202, 203, 204, 205];
    for (const iid of topFive) {
      state.instances[iid] = {
        iid: iid as never, defId: (iid === 201 ? "big-unit" : "filler") as never, owner: 0, controller: 0,
        zone: "mainDeck", battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    state.defs["filler"] = makeCardDef({ type: "spell", id: "filler" as never });
    putInHand(state, 300, 0, REINFORCE);
    state = applyAction(state, { type: "playCard", iid: 300 });
    state = applyAction(state, { type: "resolveTrigger", accept: false });
    expect(state.pendingTrigger).toBeNull();
    for (const iid of topFive) {
      expect(state.players[0]!.mainDeck).toContain(iid as never);
    }
  });
});

describe("Super Mega Death Rocket!: Deal 5 to a unit; on-conquer-from-trash, may discard 1 to return it", () => {
  it("deals 5 damage to whichever of two candidates is chosen", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 4, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 20 }), spellDef(SUPER_MEGA_DEATH_ROCKET, 4, 1)],
      playerPatch: [{ energy: 4, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SUPER_MEGA_DEATH_ROCKET);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.damage).toBe(5);
    expect(state.instances[4]!.damage).toBe(0);
  });

  it("offers to discard 1 to return a copy from trash to hand when the caster conquers a battlefield", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "attacker" as never, zone: "base", exhausted: false }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never }),
        makeCardDef({ type: "unit", id: "chaff" as never }),
        spellDef(SUPER_MEGA_DEATH_ROCKET, 4, 1),
      ],
      playerPatch: [{ hand: [] }, {}],
    });
    putInTrash(state, 2, 0, SUPER_MEGA_DEATH_ROCKET);
    putInHand(state, 3, 0, "chaff");
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 0 }); // conquers battlefield 0
    expect(state.pendingTrigger).not.toBeNull();
    expect(state.pendingTrigger!.player).toBe(0);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.instances[3]!.zone).toBe("trash"); // discarded
    expect(state.instances[2]!.zone).toBe("hand"); // Super Mega Death Rocket returned
  });
});

describe("Icathian Rain: Deal 2 to a unit, six times over", () => {
  it("supports up to 6 picks, allowing the same unit to be targeted repeatedly until it dies", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 10 }), makeCardDef({ type: "spell", id: ICATHIAN_RAIN as never, energy: 7, power: 3 })],
      playerPatch: [{ energy: 7, power: 3, hand: [] }, {}],
    });
    putInHand(state, 3, 0, ICATHIAN_RAIN);
    state = applyAction(state, { type: "playCard", iid: 3 });
    for (let i = 0; i < 4; i++) {
      state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
      expect(state.instances[1]!.zone).toBe("battlefield"); // 4 x 2 = 8 < 10 -- still alive
    }
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 }); // 5th hit: 10 >= 10
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.instances[2]!.damage).toBe(0); // never targeted, untouched
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 }); // 6th and final pick
    expect(state.instances[2]!.damage).toBe(2);
    expect(state.pendingTrigger).toBeNull(); // maxPicks (6) reached
  });
});

describe("Fading Memories: Give a unit at a battlefield or a gear [Temporary]", () => {
  it("can target a unit at a battlefield", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), makeCardDef({ type: "spell", id: FADING_MEMORIES as never, energy: 4, power: 1 })],
      playerPatch: [{ energy: 4, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, FADING_MEMORIES);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.temporary).toBe(true);
  });

  it("can target a gear at base instead", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "gear1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: "gear1" as never }), makeCardDef({ type: "spell", id: FADING_MEMORIES as never, energy: 4, power: 1 })],
      playerPatch: [{ energy: 4, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, FADING_MEMORIES);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.temporary).toBe(true);
  });
});

describe("Invert Timelines: Each player discards their hand, then draws 4", () => {
  it("empties both hands into the trash, then refills each to 4", () => {
    let state = makeBareGame({
      extraDefs: [makeCardDef({ type: "spell", id: INVERT_TIMELINES as never, energy: 3, power: 1 })],
      playerPatch: [{ energy: 3, power: 1, hand: [], mainDeck: [] }, { hand: [], mainDeck: [] }],
    });
    let nextIid = 100;
    for (const seat of [0, 1] as const) {
      for (let i = 0; i < 4; i++) {
        const iid = nextIid++;
        state.instances[iid] = {
          iid: iid as never, defId: "filler" as never, owner: seat, controller: seat, zone: "mainDeck",
          battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
          stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
        };
        state.players[seat]!.mainDeck.push(iid as never);
      }
    }
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 50, 0, "filler");
    putInHand(state, 51, 1, "filler");
    putInHand(state, 52, 0, INVERT_TIMELINES);
    state = applyAction(state, { type: "playCard", iid: 52 });
    expect(state.instances[50]!.zone).toBe("trash"); // discarded, not drawn back
    expect(state.instances[51]!.zone).toBe("trash");
    expect(state.players[0]!.hand.length).toBe(4);
    expect(state.players[1]!.hand.length).toBe(4);
  });
});

describe("Stormbringer: pick a friendly base unit, THEN pick a battlefield to nuke and move to (no auto-targeting)", () => {
  it("lets the player choose which of two contested battlefields to hit -- never auto-picks the 'best' one", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "striker" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "weak" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "strong" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "striker" as never, might: 8 }),
        makeCardDef({ type: "unit", id: "weak" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "strong" as never, might: 8 }),
        makeCardDef({ type: "spell", id: STORMBRINGER as never, energy: 6, power: 2 }),
      ],
      playerPatch: [{ energy: 6, power: 2, hand: [] }, {}],
    });
    putInHand(state, 4, 0, STORMBRINGER);
    state = applyAction(state, { type: "playCard", iid: 4 }); // sole friendly base unit -- auto-resolves that pick
    expect(state.pendingTrigger).not.toBeNull(); // but the battlefield is a REAL, still-open choice
    const legalBfs = getLegalActions(state, 0)
      .filter((a) => a.type === "resolveTrigger" && a.battlefield !== undefined)
      .map((a) => (a as { battlefield: number }).battlefield);
    expect(legalBfs.sort()).toEqual([0, 1]); // both contested battlefields are legal, not just the "best" one

    // Deliberately choose the WEAKER battlefield (0), proving nothing was auto-selected for us.
    state = applyAction(state, { type: "resolveTrigger", accept: true, battlefield: 0 });
    expect(state.instances[2]!.zone).toBe("trash"); // battlefield 0's defender took the 8 Might hit
    expect(state.instances[3]!.damage).toBe(0); // battlefield 1 untouched
    expect(state.instances[1]!.zone).toBe("battlefield");
    expect(state.instances[1]!.battlefield).toBe(0);
  });

  it("choosing the OTHER battlefield instead produces a different, correctly-computed outcome", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "striker" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "weak" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "strong" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "striker" as never, might: 8 }),
        makeCardDef({ type: "unit", id: "weak" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "strong" as never, might: 8 }),
        makeCardDef({ type: "spell", id: STORMBRINGER as never, energy: 6, power: 2 }),
      ],
      playerPatch: [{ energy: 6, power: 2, hand: [] }, {}],
    });
    putInHand(state, 4, 0, STORMBRINGER);
    state = applyAction(state, { type: "playCard", iid: 4 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, battlefield: 1 });
    expect(state.instances[3]!.zone).toBe("trash"); // battlefield 1's defender took the hit this time
    expect(state.instances[2]!.damage).toBe(0); // battlefield 0 untouched
    expect(state.instances[1]!.battlefield).toBe(1);
  });
});

describe("Showstopper: pick a friendly base unit, THEN pick which battlefield to move it to (no auto-targeting)", () => {
  it("offers every battlefield as a real choice, not just one the player already controls", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), makeCardDef({ type: "spell", id: SHOWSTOPPER as never, energy: 1, power: 1 })],
      playerPatch: [{ energy: 1, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SHOWSTOPPER);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.buffed).toBe(true); // the buff applies immediately once the unit is picked
    expect(state.pendingTrigger).not.toBeNull(); // battlefield choice still open
    const legalBfs = getLegalActions(state, 0)
      .filter((a) => a.type === "resolveTrigger" && a.battlefield !== undefined)
      .map((a) => (a as { battlefield: number }).battlefield);
    expect(legalBfs.sort()).toEqual([0, 1]);

    state = applyAction(state, { type: "resolveTrigger", accept: true, battlefield: 1 });
    expect(state.instances[1]!.zone).toBe("battlefield");
    expect(state.instances[1]!.battlefield).toBe(1);
  });
});
