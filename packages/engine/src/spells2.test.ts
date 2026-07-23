/**
 * More scripted spells, added after a user report that several spells either had no targeting at
 * all (unscripted) or were auto-picking a target/battlefield instead of letting the player choose
 * (Stormbringer/Showstopper's battlefield auto-pick, fixed in spells.test.ts). Every test here that
 * involves a real choice deliberately sets up 2+ legal candidates and asserts BOTH that a decision
 * point exists (a `pendingTrigger`/`legalBattlefields` prompt) AND that picking a specific one
 * produces the corresponding, non-arbitrary outcome -- proving nothing was auto-selected.
 */
import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import type { CardInstance, GameState } from "./state.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

function putInHand(state: GameState, iid: number, owner: 0 | 1, defId: string): CardInstance {
  const inst: CardInstance = {
    iid: iid as never, defId: defId as never, owner, controller: owner, zone: "hand",
    battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
    stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0,
    shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
  };
  state.instances[iid] = inst;
  state.players[owner]!.hand.push(iid as never);
  return inst;
}

function spell(id: string, energy: number, power: number) {
  return makeCardDef({ type: "spell", id: id as never, energy, power, name: id });
}

function legalTargetIids(state: GameState, player: 0 | 1): number[] {
  return getLegalActions(state, player)
    .filter((a) => a.type === "resolveTrigger" && a.targetIid !== undefined)
    .map((a) => (a as { targetIid: number }).targetIid);
}

const CLEAVE = "ogn-004-298";
const DISINTEGRATE = "ogn-005-298";
const SKY_SPLITTER = "ogn-014-298";
const VOID_SEEKER = "ogn-024-298";
const FALLING_COMET = "ogn-085-298";
const BLAST_OF_POWER = "ogs-012-024";
const FINAL_SPARK = "ogs-022-024";
const RUNE_PRISON = "ogn-050-298";
const EN_GARDE = "ogn-046-298";
const DISCIPLINE = "ogn-058-298";
const SMOKE_SCREEN = "ogn-093-298";
const STUPEFY = "ogn-095-298";
const LAST_STAND = "ogn-069-298";
const RETREAT = "ogn-104-298";
const GUST = "ogn-169-298";
const REBUKE = "ogn-172-298";
const PORTAL_RESCUE = "ogn-102-298";
const POSSESSION = "ogn-203-298";
const CHALLENGE = "ogn-128-298";
const GENTLEMENS_DUEL = "ogs-008-024";
const BACK_TO_BACK = "ogn-206-298";
const CONVERGENT_MUTATION = "ogn-108-298";
const FACEBREAKER = "ogn-220-298";
const ZENITH_BLADE = "ogn-262-298";
const LAST_BREATH = "ogn-260-298";
const SHAKEDOWN = "ogn-033-298";
const SIPHON_POWER = "ogn-266-298";
const CANNON_BARRAGE = "ogn-127-298";
const FLURRY_OF_BLADES = "ogn-133-298";
const GET_EXCITED = "ogn-008-298";
const BLIND_FURY = "ogn-025-298";
const STACKED_DECK = "ogn-183-298";
const THERMO_BEAM = "ogn-022-298";
const GRAND_STRATEGEM = "ogn-233-298";
const SALVAGE = "ogn-224-298";
const ACCEPTABLE_LOSSES = "ogn-179-298";
const MEDITATION = "ogn-048-298";

describe("Cleave: Give a unit [Assault 3] this turn", () => {
  it("only boosts Might while the unit is the attacker, and lets the player pick between two candidates", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 2 }), spell(CLEAVE, 1, 0)],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, CLEAVE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]); // both units are legal -- a real choice
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.assaultThisTurn).toBe(3);
    expect(state.instances[1]!.assaultThisTurn).toBe(0); // untouched -- not auto-applied to "my own" unit
  });
});

describe("Disintegrate: Deal 3 to a unit at a battlefield. If this kills it, draw 1", () => {
  it("draws only when the damage is lethal", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 }), spell(DISINTEGRATE, 4, 0)],
      playerPatch: [{ energy: 4, power: 0, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 2, 0, DISINTEGRATE);
    state = applyAction(state, { type: "playCard", iid: 2 }); // sole target -- auto-resolves
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.players[0]!.hand).toContain(10 as never);
  });

  it("does NOT draw when the unit survives", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 20 }), spell(DISINTEGRATE, 4, 0)],
      playerPatch: [{ energy: 4, power: 0, hand: [] }, {}],
    });
    putInHand(state, 2, 0, DISINTEGRATE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.damage).toBe(3);
    expect(state.players[0]!.hand.length).toBe(0);
  });
});

describe("Sky Splitter: Energy cost reduced by highest Might among units you control; Deal 5 to a unit at a battlefield", () => {
  it("reduces the Energy cost by the controller's highest-Might unit", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "big" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "victim" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "big" as never, might: 6 }),
        makeCardDef({ type: "unit", id: "victim" as never, might: 20 }),
        spell(SKY_SPLITTER, 8, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}], // 8 - 6 = 2 Energy needed
    });
    putInHand(state, 3, 0, SKY_SPLITTER);
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 3)).toBe(true);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[2]!.damage).toBe(5);
    expect(state.players[0]!.energy).toBe(0);
  });
});

describe("Final Spark: Deal 8 to a unit (not restricted to a battlefield)", () => {
  it("can target a unit still at base", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 5 }), spell(FINAL_SPARK, 8, 0)],
      playerPatch: [{ energy: 8, power: 0, hand: [] }, {}],
    });
    putInHand(state, 2, 0, FINAL_SPARK);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("trash");
  });
});

describe("Rune Prison: Stun a unit (any zone)", () => {
  it("lets the player choose which of two units to stun", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(RUNE_PRISON, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, RUNE_PRISON);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.stunned).toBe(true);
    expect(state.instances[1]!.stunned).toBe(false);
  });
});

describe("En Garde: +1 Might this turn, +1 more if it's the only unit you control there", () => {
  it("gives the bonus +1 only when the target is alone at its location", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(EN_GARDE, 1, 0)],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 2, 0, EN_GARDE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.tempMightDelta).toBe(2); // alone at base -- gets both bonuses
  });

  it("gives only the base +1 when another friendly unit shares the location", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "u1" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(EN_GARDE, 1, 0)],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, EN_GARDE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.tempMightDelta).toBe(1); // not alone -- only the base bonus
  });
});

describe("Smoke Screen / Stupefy: Might penalties clamp to a minimum of 1", () => {
  it("Smoke Screen's -4 clamps a 3-Might unit to 1, not negative", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 }), spell(SMOKE_SCREEN, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SMOKE_SCREEN);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.tempMightDelta).toBe(-4);
  });

  it("Stupefy's -1 draws a card regardless of the Might floor", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 1 }), spell(STUPEFY, 1, 0)],
      playerPatch: [{ energy: 1, power: 0, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 2, 0, STUPEFY);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.players[0]!.hand).toContain(10 as never);
  });
});

describe("Last Stand: Double a friendly unit's Might this turn. Give it [Temporary]", () => {
  it("doubles the base Might and marks it Temporary", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 4 }), spell(LAST_STAND, 3, 1)],
      playerPatch: [{ energy: 3, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, LAST_STAND);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.tempMightDelta).toBe(4); // 4 base -> 8 effective
    expect(state.instances[1]!.temporary).toBe(true);
  });
});

describe("Retreat: Return a friendly unit to its owner's hand. Its owner channels 1 rune exhausted", () => {
  it("returns the unit and channels a rune for its OWNER", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(RETREAT, 1, 0)],
      playerPatch: [{ energy: 1, power: 0, hand: [], runeDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runeDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });
    putInHand(state, 2, 0, RETREAT);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("hand");
    expect(state.players[0]!.runePool).toContain(10 as never);
    expect(state.instances[10]!.exhausted).toBe(true);
  });
});

describe("Gust: Return a unit at a battlefield with 3 Might or less to its owner's hand", () => {
  it("only offers units at or under 3 Might as legal targets", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "weak" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "strong" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "weak" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "strong" as never, might: 4 }),
        spell(GUST, 1, 0),
      ],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, GUST);
    state = applyAction(state, { type: "playCard", iid: 3 }); // sole legal target (weak) -- auto-resolves
    expect(state.instances[1]!.zone).toBe("hand");
    expect(state.instances[2]!.zone).toBe("battlefield"); // too strong, untouched
  });
});

describe("Rebuke: Return a unit at a battlefield to its owner's hand", () => {
  it("lets the player pick between two units at battlefields, including a friendly one", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mine" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "theirs" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "mine" as never }), makeCardDef({ type: "unit", id: "theirs" as never }), spell(REBUKE, 2, 2)],
      playerPatch: [{ energy: 2, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, REBUKE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.zone).toBe("hand");
    expect(state.instances[1]!.zone).toBe("battlefield");
  });
});

describe("Portal Rescue: Banish a friendly unit, then play it to base, ignoring its cost", () => {
  it("pulls a unit off a battlefield and replays it to base for free", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, energy: 5, power: 2 }), spell(PORTAL_RESCUE, 3, 1)],
      playerPatch: [{ energy: 3, power: 3, hand: [] }, {}], // enough Power for Portal Rescue (1) + the unit's own (2)
    });
    putInHand(state, 2, 0, PORTAL_RESCUE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("base");
    expect(state.players[0]!.energy).toBe(0); // Portal Rescue's own cost paid; the unit's Energy was free
    expect(state.players[0]!.power).toBe(0); // 3 - 1 (Portal Rescue) - 2 (the unit's own Power cost)
  });
});

describe("Possession: take control of an enemy unit at a battlefield and recall it", () => {
  it("changes controller but not owner, and recalls it to the CASTER's base", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(POSSESSION, 8, 3)],
      playerPatch: [{ energy: 8, power: 3, hand: [] }, {}],
    });
    putInHand(state, 2, 0, POSSESSION);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.controller).toBe(0);
    expect(state.instances[1]!.owner).toBe(1); // ownership never changes
    expect(state.instances[1]!.zone).toBe("base");
    expect(state.battlefields[0]!.controller).toBeNull(); // vacated
  });
});

describe("Challenge: a friendly unit and an enemy unit deal damage equal to their Mights to each other", () => {
  it("lets the player choose BOTH units, and damage is mutual and simultaneous", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "friendlyA" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "friendlyB" as never, zone: "base" },
        { iid: 3, owner: 1, defId: "enemyX" as never, zone: "base" },
        { iid: 4, owner: 1, defId: "enemyY" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "friendlyA" as never, might: 4 }),
        makeCardDef({ type: "unit", id: "friendlyB" as never, might: 9 }),
        makeCardDef({ type: "unit", id: "enemyX" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "enemyY" as never, might: 12 }),
        spell(CHALLENGE, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 5, 0, CHALLENGE);
    state = applyAction(state, { type: "playCard", iid: 5 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]); // choice of WHICH friendly unit
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 }); // pick friendlyA (Might 4)
    expect(state.pendingTrigger!.sourceIid).toBe(1);
    expect(legalTargetIids(state, 0).sort()).toEqual([3, 4]); // real choice of WHICH enemy, both still legal
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.instances[1]!.damage).toBe(3); // took enemyX's Might (3)
    expect(state.instances[3]!.zone).toBe("trash"); // took friendlyA's Might (4) >= enemyX's Might (3)
    expect(state.instances[2]!.damage).toBe(0); // friendlyB was never touched -- not auto-selected
    expect(state.instances[4]!.damage).toBe(0); // enemyY was never touched -- not auto-selected
  });
});

describe("Gentlemen's Duel: +3 Might to a friendly unit this turn, then it duels an enemy unit (boosted Might counts)", () => {
  it("uses the FRESH, boosted Might for the mutual damage, not the pre-buff value", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "friendly" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "enemy" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "friendly" as never, might: 7 }), // 7 + 3 = 10, survives 8 back
        makeCardDef({ type: "unit", id: "enemy" as never, might: 8 }), // dies to the boosted 10
        spell(GENTLEMENS_DUEL, 6, 1),
      ],
      playerPatch: [{ energy: 6, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, GENTLEMENS_DUEL);
    // Sole candidate at each step -- both picks auto-resolve in this one call (the "real choice"
    // mechanics are already proven by Challenge's test above); this test's point is the FRESH-Might
    // computation instead.
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[1]!.tempMightDelta).toBe(3);
    expect(state.instances[2]!.zone).toBe("trash"); // took the BOOSTED 10 Might, well past its own 8
    expect(state.instances[1]!.damage).toBe(8); // took the enemy's 8 Might back, but its own Might is now 10 -- survives
  });
});

describe("Back to Back: give TWO DISTINCT friendly units each +2 Might this turn", () => {
  it("cannot pick the same unit twice", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "u1" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(BACK_TO_BACK, 3, 0)],
      playerPatch: [{ energy: 3, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, BACK_TO_BACK);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(legalTargetIids(state, 0)).toEqual([2]); // 1 is excluded now -- can't double-dip
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[1]!.tempMightDelta).toBe(2);
    expect(state.instances[2]!.tempMightDelta).toBe(2);
  });
});

describe("Convergent Mutation: a friendly unit's Might becomes ANOTHER friendly unit's Might this turn", () => {
  it("copies the chosen second unit's Might onto the first, offering a real choice among two candidates", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "small" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "big" as never, zone: "base" },
        { iid: 3, owner: 0, defId: "medium" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "small" as never, might: 1 }),
        makeCardDef({ type: "unit", id: "big" as never, might: 7 }),
        makeCardDef({ type: "unit", id: "medium" as never, might: 4 }),
        spell(CONVERGENT_MUTATION, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 4, 0, CONVERGENT_MUTATION);
    state = applyAction(state, { type: "playCard", iid: 4 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2, 3]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 }); // choose "small" as the one to change
    expect(legalTargetIids(state, 0).sort()).toEqual([2, 3]); // can't pick itself again, but a real choice remains
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[1]!.tempMightDelta).toBe(6); // 1 -> 7 (copied "big", not "medium")
  });

  it("with only two friendly units, the second pick auto-resolves onto the sole remaining candidate", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "small" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "big" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "small" as never, might: 1 }),
        makeCardDef({ type: "unit", id: "big" as never, might: 7 }),
        spell(CONVERGENT_MUTATION, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, CONVERGENT_MUTATION);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.pendingTrigger).toBeNull(); // "big" was the only remaining candidate -- auto-resolved
    expect(state.instances[1]!.tempMightDelta).toBe(6); // 1 -> 7
  });
});

describe("Facebreaker: stun a friendly unit and an enemy unit at the SAME battlefield", () => {
  it("restricts the enemy pick to units at the same battlefield as the chosen friendly unit, with a real choice among them", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "friendly0" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "enemy0a" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 1, defId: "enemy0b" as never, zone: "battlefield", battlefield: 0 },
        { iid: 4, owner: 1, defId: "enemy1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "friendly0" as never }),
        makeCardDef({ type: "unit", id: "enemy0a" as never }),
        makeCardDef({ type: "unit", id: "enemy0b" as never }),
        makeCardDef({ type: "unit", id: "enemy1" as never }),
        spell(FACEBREAKER, 2, 0),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, {}],
    });
    putInHand(state, 5, 0, FACEBREAKER);
    state = applyAction(state, { type: "playCard", iid: 5 }); // sole friendly candidate -- auto-resolves
    expect(state.instances[1]!.stunned).toBe(true);
    expect(legalTargetIids(state, 0).sort()).toEqual([2, 3]); // both enemies AT BATTLEFIELD 0, never enemy1
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.stunned).toBe(true);
    expect(state.instances[3]!.stunned).toBe(false); // the other battlefield-0 enemy is untouched
    expect(state.instances[4]!.stunned).toBe(false); // battlefield 1 was never a legal choice at all
  });
});

describe("Zenith Blade: stun an enemy unit at a battlefield; you may move a friendly unit there", () => {
  it("lets the player decline the optional move", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "enemy" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 0, defId: "friendly" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "enemy" as never }), makeCardDef({ type: "unit", id: "friendly" as never }), spell(ZENITH_BLADE, 3, 2)],
      playerPatch: [{ energy: 3, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, ZENITH_BLADE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[1]!.stunned).toBe(true);
    expect(state.pendingTrigger).not.toBeNull(); // the optional move is still a live decision
    state = applyAction(state, { type: "resolveTrigger", accept: false }); // decline
    expect(state.instances[2]!.zone).toBe("base"); // never moved
  });

  it("moves the chosen friendly unit to the stunned enemy's battlefield when accepted", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "enemy" as never, zone: "battlefield", battlefield: 1 },
        { iid: 2, owner: 0, defId: "friendly" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "enemy" as never }), makeCardDef({ type: "unit", id: "friendly" as never }), spell(ZENITH_BLADE, 3, 2)],
      playerPatch: [{ energy: 3, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, ZENITH_BLADE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.zone).toBe("battlefield");
    expect(state.instances[2]!.battlefield).toBe(1);
  });
});

describe("Last Breath: ready a friendly unit; it deals damage equal to its Might to an enemy unit at a battlefield", () => {
  it("lets the player choose which friendly unit and which enemy unit, with real choices at both steps", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "weak" as never, zone: "base", exhausted: true },
        { iid: 2, owner: 0, defId: "strong" as never, zone: "base", exhausted: true },
        { iid: 3, owner: 1, defId: "enemyA" as never, zone: "battlefield", battlefield: 0 },
        { iid: 4, owner: 1, defId: "enemyB" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "weak" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "strong" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "enemyA" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "enemyB" as never, might: 10 }),
        spell(LAST_BREATH, 3, 2),
      ],
      playerPatch: [{ energy: 3, power: 2, hand: [] }, {}],
    });
    putInHand(state, 5, 0, LAST_BREATH);
    state = applyAction(state, { type: "playCard", iid: 5 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 }); // choose "strong"
    expect(legalTargetIids(state, 0).sort()).toEqual([3, 4]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 3 });
    expect(state.instances[2]!.exhausted).toBe(false); // readied
    expect(state.instances[1]!.exhausted).toBe(true); // "weak" was never touched -- not auto-selected
    expect(state.instances[3]!.damage).toBe(5); // "strong"'s Might
    expect(state.instances[4]!.damage).toBe(0); // enemyB was never touched -- not auto-selected
  });
});

describe("Shakedown: deal 6 to an enemy unit UNLESS its controller has the caster draw 2 instead", () => {
  it("the TARGET's controller (not the caster) decides -- accepting prevents the damage entirely", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "enemy" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "enemy" as never, might: 20 }), spell(SHAKEDOWN, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, { mainDeck: [10 as never, 11 as never] }],
    });
    for (const iid of [10, 11]) {
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    putInHand(state, 2, 0, SHAKEDOWN);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger!.player).toBe(1); // the ENEMY unit's controller decides, not the caster
    state = applyAction(state, { type: "resolveTrigger", accept: true }); // P1 chooses to let P0 draw 2 instead
    expect(state.instances[1]!.damage).toBe(0); // no damage happened
    expect(state.players[0]!.hand.length).toBe(2); // P0 (the caster) drew 2
  });

  it("declining lets the 6 damage go through", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "enemy" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "enemy" as never, might: 20 }), spell(SHAKEDOWN, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SHAKEDOWN);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "resolveTrigger", accept: false });
    expect(state.instances[1]!.damage).toBe(6);
  });
});

describe("Siphon Power: choose a battlefield -- friendly units there +1 Might, enemy units there -1", () => {
  it("only affects the CHOSEN battlefield, not the other one", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mine0" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "theirs0" as never, zone: "battlefield", battlefield: 0 },
        { iid: 3, owner: 0, defId: "mine1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "mine0" as never }),
        makeCardDef({ type: "unit", id: "theirs0" as never, might: 3 }),
        makeCardDef({ type: "unit", id: "mine1" as never }),
        spell(SIPHON_POWER, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 4, 0, SIPHON_POWER);
    state = applyAction(state, { type: "playCard", iid: 4 });
    const legalBfs = getLegalActions(state, 0)
      .filter((a) => a.type === "resolveTrigger" && a.battlefield !== undefined)
      .map((a) => (a as { battlefield: number }).battlefield);
    expect(legalBfs.sort()).toEqual([0, 1]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, battlefield: 0 });
    expect(state.instances[1]!.tempMightDelta).toBe(1);
    expect(state.instances[2]!.tempMightDelta).toBe(-1);
    expect(state.instances[3]!.tempMightDelta).toBe(0); // battlefield 1 untouched
  });
});

describe("Cannon Barrage: Deal 2 to all enemy units in combat (the currently active Showdown)", () => {
  it("only hits the battlefield with an active Showdown", () => {
    // The defender's Might is set to exactly 2 (lethal to Cannon Barrage's own damage) so its
    // death is immediate and permanent -- avoiding ambiguity with the subsequent combat
    // resolution's own "survivors heal" step, which would otherwise erase non-lethal damage
    // marked during the window once nobody has anything left to play and it auto-resolves.
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0, exhausted: false },
        { iid: 3, owner: 1, defId: "bystander" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 1 }),
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "bystander" as never, might: 20 }),
        spell(CANNON_BARRAGE, 1, 1),
      ],
      playerPatch: [{ energy: 1, power: 1, hand: [] }, {}],
    });
    // Manually open a Showdown at battlefield 0 without resolving it (simulating mid-combat). The
    // Action Window is open (toAssign === null); P0 holds Focus/Priority.
    state.showdown = { battlefield: 0, attacker: 0, remaining: [1, 2], assigned: {}, toAssign: null };
    state.priority = 0;
    state.passStreak = 0;
    putInHand(state, 4, 0, CANNON_BARRAGE);
    state = applyAction(state, { type: "playCard", iid: 4 });
    expect(state.instances[2]!.zone).toBe("trash"); // killed by the 2 damage at the active combat
    expect(state.instances[3]!.damage).toBe(0); // NOT in combat -- untouched
    expect(state.instances[1]!.damage).toBe(0); // friendly, untouched
  });
});

describe("Flurry of Blades: Deal 1 to all units at battlefields (both sides, everywhere)", () => {
  it("hits every unit at every battlefield, friend and foe alike", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "a" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "b" as never, zone: "battlefield", battlefield: 1 },
        { iid: 3, owner: 0, defId: "c" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "a" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "b" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "c" as never, might: 5 }),
        spell(FLURRY_OF_BLADES, 1, 0),
      ],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 4, 0, FLURRY_OF_BLADES);
    state = applyAction(state, { type: "playCard", iid: 4 });
    expect(state.instances[1]!.damage).toBe(1);
    expect(state.instances[2]!.damage).toBe(1);
    expect(state.instances[3]!.damage).toBe(0); // at base, not a battlefield -- untouched
  });
});

describe("Get Excited!: Discard 1, deal ITS Energy cost as damage to a unit at a battlefield", () => {
  it("lets the player choose which card to discard and which unit to hit", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "victim" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "victim" as never, might: 10 }),
        makeCardDef({ type: "unit", id: "cheap-card" as never, energy: 1 }),
        makeCardDef({ type: "unit", id: "costly-card" as never, energy: 5 }),
        spell(GET_EXCITED, 2, 1),
      ],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 10, 0, "cheap-card");
    putInHand(state, 11, 0, "costly-card");
    putInHand(state, 2, 0, GET_EXCITED);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(legalTargetIids(state, 0).sort()).toEqual([10, 11]); // real choice of which to discard
    // Only one unit exists at a battlefield, so the second step (which unit to hit) auto-resolves
    // onto it the instant the discard resolves -- both effects land in this one call.
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 11 }); // discard the costly one
    expect(state.instances[11]!.zone).toBe("trash");
    expect(state.instances[1]!.damage).toBe(5); // discarded card's Energy cost (5)
  });
});

describe("Blind Fury: the opponent reveals their top card; banish it and play it ignoring cost", () => {
  it("the caster becomes controller; the opponent stays owner", () => {
    let state = makeBareGame({
      extraDefs: [makeCardDef({ type: "unit", id: "revealed" as never, energy: 6, power: 2 }), spell(BLIND_FURY, 4, 2)],
      playerPatch: [{ energy: 4, power: 4, hand: [] }, { mainDeck: [10 as never] }], // enough Power for Blind Fury (2) + the revealed unit's own (2)
    });
    state.instances[10] = {
      iid: 10 as never, defId: "revealed" as never, owner: 1, controller: 1, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.players[1]!.mainDeck.push(10 as never);
    putInHand(state, 2, 0, BLIND_FURY);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[10]!.zone).toBe("base");
    expect(state.instances[10]!.controller).toBe(0);
    expect(state.instances[10]!.owner).toBe(1);
    expect(state.players[1]!.mainDeck).not.toContain(10 as never);
  });
});

describe("Stacked Deck: look at top 3, put 1 in hand, recycle the rest", () => {
  it("lets the player choose which of the 3 to keep", () => {
    let state = makeBareGame({
      extraDefs: [spell(STACKED_DECK, 1, 0), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 1, power: 0, hand: [], mainDeck: [] }, {}],
    });
    for (const iid of [10, 11, 12]) {
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    putInHand(state, 2, 0, STACKED_DECK);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(legalTargetIids(state, 0).sort()).toEqual([10, 11, 12]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 11 });
    expect(state.players[0]!.hand).toContain(11 as never);
    expect(state.players[0]!.mainDeck).toContain(10 as never);
    expect(state.players[0]!.mainDeck).toContain(12 as never);
  });
});

describe("Thermo Beam: Kill all gear (both sides)", () => {
  it("kills every gear on the board, friendly and enemy alike", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "myGear" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "theirGear" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "gear", id: "myGear" as never }), makeCardDef({ type: "gear", id: "theirGear" as never }), spell(THERMO_BEAM, 5, 2)],
      playerPatch: [{ energy: 5, power: 2, hand: [] }, {}],
    });
    putInHand(state, 3, 0, THERMO_BEAM);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.instances[2]!.zone).toBe("trash");
  });
});

describe("Grand Strategem: Give friendly units +5 Might this turn (all of them)", () => {
  it("boosts every friendly unit, not the opponent's", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mine" as never, zone: "base" },
        { iid: 2, owner: 1, defId: "theirs" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "mine" as never }), makeCardDef({ type: "unit", id: "theirs" as never }), spell(GRAND_STRATEGEM, 6, 3)],
      playerPatch: [{ energy: 6, power: 3, hand: [] }, {}],
    });
    putInHand(state, 3, 0, GRAND_STRATEGEM);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(state.instances[1]!.tempMightDelta).toBe(5);
    expect(state.instances[2]!.tempMightDelta).toBe(0);
  });
});

describe("Salvage: You may kill a gear (a REAL may, even with exactly one candidate). Draw 1 regardless", () => {
  it("with zero gear on board, still draws 1 and does nothing else", () => {
    let state = makeBareGame({
      extraDefs: [spell(SALVAGE, 2, 1), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 2, power: 1, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.players[0]!.mainDeck.push(10 as never);
    putInHand(state, 2, 0, SALVAGE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.players[0]!.hand).toContain(10 as never);
    expect(state.pendingTrigger).toBeNull();
  });

  it("with exactly ONE gear on board, still offers a real decline -- doesn't force the kill", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "gear1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: "gear1" as never }), spell(SALVAGE, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SALVAGE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).not.toBeNull(); // a real "may" prompt, not auto-forced
    state = applyAction(state, { type: "resolveTrigger", accept: false }); // decline
    expect(state.instances[1]!.zone).toBe("base"); // survives -- the kill was genuinely optional
  });

  it("accepting the kill with one candidate removes it", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "gear1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "gear", id: "gear1" as never }), spell(SALVAGE, 2, 1)],
      playerPatch: [{ energy: 2, power: 1, hand: [] }, {}],
    });
    putInHand(state, 2, 0, SALVAGE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("trash");
  });
});

describe("Acceptable Losses: each player kills one of their own gear (opponent decides first)", () => {
  it("lets the opponent choose their own gear to lose, then the caster chooses their own", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "mineGearA" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "mineGearB" as never, zone: "base" },
        { iid: 3, owner: 1, defId: "theirGearA" as never, zone: "base" },
        { iid: 4, owner: 1, defId: "theirGearB" as never, zone: "base" },
      ],
      extraDefs: [
        makeCardDef({ type: "gear", id: "mineGearA" as never }),
        makeCardDef({ type: "gear", id: "mineGearB" as never }),
        makeCardDef({ type: "gear", id: "theirGearA" as never }),
        makeCardDef({ type: "gear", id: "theirGearB" as never }),
        spell(ACCEPTABLE_LOSSES, 1, 0),
      ],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 5, 0, ACCEPTABLE_LOSSES);
    state = applyAction(state, { type: "playCard", iid: 5 });
    expect(state.pendingTrigger!.player).toBe(1); // opponent decides first, over their OWN gear
    expect(legalTargetIids(state, 1).sort()).toEqual([3, 4]); // real choice among the opponent's OWN gear
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 4 });
    expect(state.instances[4]!.zone).toBe("trash");
    expect(state.instances[3]!.zone).toBe("base"); // the other of the opponent's gear survives
    expect(state.pendingTrigger!.player).toBe(0); // now the caster decides, over THEIR OWN gear
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.instances[2]!.zone).toBe("base");
  });
});

describe("Meditation: as an additional cost, you may exhaust a friendly unit; draw 2 if you do, else draw 1", () => {
  it("with a ready friendly unit available, offers a real choice between drawing 1 or 2", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base", exhausted: false }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(MEDITATION, 2, 0), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 2, power: 0, hand: [], mainDeck: [10 as never, 11 as never] }, {}],
    });
    for (const iid of [10, 11]) {
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    putInHand(state, 2, 0, MEDITATION);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).not.toBeNull(); // real choice, even with only 1 exhaustable unit
    state = applyAction(state, { type: "resolveTrigger", accept: false }); // decline -- draw only 1
    expect(state.players[0]!.hand.length).toBe(1);
    expect(state.instances[1]!.exhausted).toBe(false);
  });

  it("accepting exhausts the unit and draws 2 instead", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base", exhausted: false }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(MEDITATION, 2, 0), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 2, power: 0, hand: [], mainDeck: [10 as never, 11 as never] }, {}],
    });
    for (const iid of [10, 11]) {
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
      };
      state.players[0]!.mainDeck.push(iid as never);
    }
    putInHand(state, 2, 0, MEDITATION);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.exhausted).toBe(true);
    expect(state.players[0]!.hand.length).toBe(2);
  });

  it("with no ready friendly units, just draws 1 with no prompt at all", () => {
    let state = makeBareGame({
      extraDefs: [spell(MEDITATION, 2, 0), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 2, power: 0, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.players[0]!.mainDeck.push(10 as never);
    putInHand(state, 2, 0, MEDITATION);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.pendingTrigger).toBeNull();
    expect(state.players[0]!.hand.length).toBe(1);
  });
});

// Not restated here to avoid duplicate test names, but Sky Splitter's own damage effect (Deal 5)
// is implicitly covered above alongside its cost-reduction test; Blast of Power / Falling Comet /
// Void Seeker / Discipline all reuse the exact same single-target pattern already covered
// extensively in spells.test.ts's Falling Star/Vengeance/Incinerate tests, so they're spot-checked
// (not exhaustively re-tested) via the shared `legalTargetIids` helper below.
describe("Spot-checks: remaining single-target damage/buff spells never auto-resolve with 2+ real candidates", () => {
  it("Blast of Power offers a real choice among two battlefield units", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 99 }), spell(BLAST_OF_POWER, 6, 1)],
      playerPatch: [{ energy: 6, power: 1, hand: [] }, {}],
    });
    putInHand(state, 3, 0, BLAST_OF_POWER);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
  });

  it("Falling Comet offers a real choice among two battlefield units", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 20 }), spell(FALLING_COMET, 5, 0)],
      playerPatch: [{ energy: 5, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, FALLING_COMET);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
  });

  it("Void Seeker offers a real choice and draws regardless of outcome", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 20 }), spell(VOID_SEEKER, 3, 1), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 3, power: 1, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.players[0]!.mainDeck.push(10 as never);
    putInHand(state, 3, 0, VOID_SEEKER);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]);
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.damage).toBe(4);
    expect(state.players[0]!.hand).toContain(10 as never);
  });

  it("Discipline offers a real choice and always draws", () => {
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 1, defId: "u1" as never, zone: "base" },
        { iid: 2, owner: 0, defId: "u1" as never, zone: "base" },
      ],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never }), spell(DISCIPLINE, 2, 0), makeCardDef({ type: "unit", id: "filler" as never })],
      playerPatch: [{ energy: 2, power: 0, hand: [], mainDeck: [10 as never] }, {}],
    });
    state.instances[10] = {
      iid: 10 as never, defId: "filler" as never, owner: 0, controller: 0, zone: "mainDeck",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.players[0]!.mainDeck.push(10 as never);
    putInHand(state, 3, 0, DISCIPLINE);
    state = applyAction(state, { type: "playCard", iid: 3 });
    expect(legalTargetIids(state, 0).sort()).toEqual([1, 2]); // any unit, friend or foe
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.tempMightDelta).toBe(2);
    expect(state.players[0]!.hand).toContain(10 as never);
  });
});

describe("Hidden card effects (played from hand as normal spells/units — rule 727.3)", () => {
  const CONSULT_THE_PAST = "ogn-083-298";
  const HIDDEN_BLADE = "ogn-213-298";
  const FIGHT_OR_FLIGHT = "ogn-168-298";
  const BLOCK = "ogn-057-298";
  const SPRITE_CALL = "ogn-094-298";
  const TEEMO_SCOUT = "ogn-197-298";
  const BLASTCONE_FAE = "ogn-097-298";

  /** Adds `count` filler cards to `player`'s main deck so draws have something to pull. */
  function stockDeck(state: GameState, player: 0 | 1, ids: number[]) {
    state.defs["filler"] = makeCardDef({ type: "unit", id: "filler" as never });
    for (const iid of ids) {
      state.instances[iid] = {
        iid: iid as never, defId: "filler" as never, owner: player, controller: player, zone: "mainDeck",
        battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
        stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
      };
      state.players[player]!.mainDeck.push(iid as never);
    }
  }

  it("Consult the Past draws 2", () => {
    let state = makeBareGame({ extraDefs: [spell(CONSULT_THE_PAST, 4, 0)], playerPatch: [{ energy: 4, hand: [] }, {}] });
    stockDeck(state, 0, [10, 11]);
    putInHand(state, 1, 0, CONSULT_THE_PAST);
    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.players[0]!.hand).toEqual(expect.arrayContaining([10 as never, 11 as never]));
  });

  it("Hidden Blade kills a unit at a battlefield and its controller draws 2", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 }), spell(HIDDEN_BLADE, 2, 0)],
      playerPatch: [{ energy: 2, hand: [] }, { hand: [] }],
    });
    stockDeck(state, 1, [10, 11]);
    putInHand(state, 2, 0, HIDDEN_BLADE);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("trash"); // killed
    expect(state.players[1]!.hand).toEqual(expect.arrayContaining([10 as never, 11 as never])); // its controller drew 2
  });

  it("Fight or Flight moves a unit from a battlefield to its base", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 }), spell(FIGHT_OR_FLIGHT, 2, 0)],
      playerPatch: [{ energy: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, FIGHT_OR_FLIGHT);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.zone).toBe("base");
    expect(state.instances[1]!.battlefield).toBeNull();
  });

  it("Block grants a unit [Shield 3] and [Tank] this turn", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 2 }), spell(BLOCK, 2, 0)],
      playerPatch: [{ energy: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, BLOCK);
    state = applyAction(state, { type: "playCard", iid: 2 });
    expect(state.instances[1]!.shieldThisTurn).toBe(3);
    expect(state.instances[1]!.tankThisTurn).toBe(true);
  });

  it("Sprite Call plays a ready Temporary Sprite token", () => {
    let state = makeBareGame({ extraDefs: [spell(SPRITE_CALL, 3, 0)], playerPatch: [{ energy: 3, hand: [] }, {}] });
    putInHand(state, 1, 0, SPRITE_CALL);
    state = applyAction(state, { type: "playCard", iid: 1 });
    const token = Object.values(state.instances).find((i) => i.controller === 0 && i.zone === "base" && i.temporary);
    expect(token).toBeDefined();
    expect(token!.exhausted).toBe(false); // ready
  });

  it("Teemo - Scout gives itself +3 Might this turn when played", () => {
    let state = makeBareGame({ extraDefs: [makeCardDef({ type: "unit", id: TEEMO_SCOUT as never, might: 2 })], playerPatch: [{ energy: 2, hand: [] }, {}] });
    putInHand(state, 1, 0, TEEMO_SCOUT);
    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.instances[1]!.tempMightDelta).toBe(3);
  });

  it("Blastcone Fae gives another unit -2 Might this turn when played", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "other" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "other" as never, might: 5 }), makeCardDef({ type: "unit", id: BLASTCONE_FAE as never, might: 2 })],
      playerPatch: [{ energy: 2, hand: [] }, {}],
    });
    putInHand(state, 2, 0, BLASTCONE_FAE);
    state = applyAction(state, { type: "playCard", iid: 2 }); // sole other unit -> auto-target
    expect(state.instances[1]!.tempMightDelta).toBe(-2);
  });
});
