import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import { startShowdown } from "./showdown.js";
import { effectiveMight, hasGanking, isMighty, totalMightAt } from "./state.js";
import { createToken, RECRUIT_TOKEN, SPRITE_TOKEN } from "./tokens.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

describe("[Buff]", () => {
  it("is idempotent (+1 Might, giving it twice doesn't stack) and boosts effective Might", () => {
    const state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base", buffed: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 })],
    });
    expect(effectiveMight(state, state.instances[1]!, undefined)).toBe(4);
    expect(isMighty(state, state.instances[1]!)).toBe(false); // 4 < 5
  });

  it("Mighty is 5+ effective Might, including the Buff bonus", () => {
    const state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base", buffed: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 4 })],
    });
    expect(isMighty(state, state.instances[1]!)).toBe(true); // 4 + 1 = 5
  });

  it("Wizened Elder gets an additional +1 (on top of the standard +1) while buffed, via CardDef.extraMightWhileBuffed", () => {
    const buffed = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ogn-065-298" as never, zone: "base", buffed: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "ogn-065-298" as never, name: "Wizened Elder", might: 3, extraMightWhileBuffed: 1 })],
    });
    expect(effectiveMight(buffed, buffed.instances[1]!, undefined)).toBe(5); // 3 + 1(standard) + 1(extra)

    const notBuffed = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ogn-065-298" as never, zone: "base" }],
      extraDefs: [makeCardDef({ type: "unit", id: "ogn-065-298" as never, name: "Wizened Elder", might: 3, extraMightWhileBuffed: 1 })],
    });
    expect(effectiveMight(notBuffed, notBuffed.instances[1]!, undefined)).toBe(3); // no bonus while unbuffed
  });
});

describe("[Temporary]", () => {
  it("dies at the start of its controller's Beginning Phase, before scoring — and vacating a battlefield updates control before the score is counted", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "sprite" as never, zone: "battlefield", battlefield: 0, temporary: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "sprite" as never, might: 3 })],
      battlefieldControllers: [0, null],
    });
    // Sole occupant already "controls" battlefield 0 per the fixture; ending P0's turn should
    // kill the Temporary unit before P1's Beginning Phase runs (P1 doesn't own it, so this
    // exercises the "at MY Beginning Phase" gating too -- nothing should happen on P1's turn).
    state = applyAction(state, { type: "endTurn" }); // -> P1's turn; P1 doesn't control it, no-op
    expect(state.instances[1]!.zone).toBe("battlefield");
    state = applyAction(state, { type: "endTurn" }); // -> P0's turn; now it dies, before scoring
    expect(state.instances[1]!.zone).toBe("trash");
    expect(state.battlefields[0]!.controller).toBeNull(); // vacated -> control recomputed
  });
});

describe("Stun", () => {
  it("a stunned unit contributes 0 to its side's total damage dealt, but is still a normal, killable target", () => {
    const state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "attacker" as never, zone: "battlefield", battlefield: 0, stunned: true },
        { iid: 2, owner: 1, defId: "defender" as never, zone: "battlefield", battlefield: 0 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "attacker" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "defender" as never, might: 10 }),
      ],
    });
    // Stunned units are excluded from totalMightAt's sum entirely (they deal no damage this turn)...
    expect(totalMightAt(state, 0, 0)).toBe(0);
    // ...but their own Might (how much damage IS NEEDED to kill them) is completely unaffected.
    expect(effectiveMight(state, state.instances[1]!, undefined)).toBe(5);

    startShowdown(state, 0, 0);
    // Attacker's total is 0 (stunned) -> the defender takes no damage and survives untouched.
    expect(state.showdown).toBeNull(); // auto-resolves (0 damage either side needs no assignment)
    expect(state.instances[2]!.zone).toBe("battlefield");
    // Defender's 10 Might one-shots the stunned attacker just like any other unit.
    expect(state.instances[1]!.zone).toBe("trash");
  });

  it("stun clears globally at the very next startTurn, whoever's turn it is (a stun always reads \"this turn\", which ends the moment ANY new turn starts)", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "u1" as never, zone: "base", stunned: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never, might: 3 })],
    });
    state = applyAction(state, { type: "endTurn" }); // -> P1's turn starts; clears everyone's stun
    expect(state.instances[1]!.stunned).toBe(false);
  });
});

describe("[Accelerate]", () => {
  const ACCEL_ID = "accel-unit";
  it("paying the extra cost lets the unit enter ready instead of exhausted", () => {
    const def = makeCardDef({
      type: "unit",
      id: ACCEL_ID as never,
      energy: 2,
      accelerateCost: { energy: 1, rune: "fury" },
    });
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: ACCEL_ID as never, zone: "championZone" }],
      extraDefs: [def],
      playerPatch: [{ energy: 3, championZone: 1 as never, hand: [] }, {}],
    });
    // Give the player a ready Fury rune in their pool for the Accelerate cost.
    state.instances[500] = {
      iid: 500 as never,
      defId: "rune-fury" as never,
      owner: 0,
      controller: 0,
      zone: "runePool",
      battlefield: null,
      exhausted: false,
      damage: 0,
      buffed: false,
      temporary: false,
      stunned: false,
      tempMightDelta: 0,
      gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    state.defs["rune-fury"] = makeCardDef({ type: "rune", id: "rune-fury" as never, colors: ["fury"] });
    state.players[0]!.runePool.push(500 as never);

    const legal = getLegalActions(state, 0);
    expect(legal.some((a) => a.type === "playCard" && a.accelerate === true)).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 1, accelerate: true });
    expect(state.instances[1]!.exhausted).toBe(false);
    expect(state.instances[500]!.exhausted).toBe(true); // the Fury rune was spent on Accelerate
  });
});

describe("token creation", () => {
  it("createToken makes a real, playable instance on the board", () => {
    const state = makeBareGame({});
    const inst = createToken(state, 0, RECRUIT_TOKEN, "base");
    expect(state.instances[inst.iid as number]).toBeDefined();
    expect(state.defs[inst.defId]!.might).toBe(1);
    expect(inst.exhausted).toBe(true); // Recruit tokens enter exhausted by default

    const sprite = createToken(state, 0, SPRITE_TOKEN, "battlefield", 0, true);
    expect(sprite.exhausted).toBe(false); // "a READY 3-Might Sprite token"
    expect(sprite.temporary).toBe(true);
  });
});

describe("Bilgewater Bully: \"While I'm buffed, I have [Ganking]\"", () => {
  it("only gains Ganking while buffed, via CardDef.gankingWhileBuffed", () => {
    const notBuffed = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ogn-125-298" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "ogn-125-298" as never, name: "Bilgewater Bully", gankingWhileBuffed: true })],
    });
    expect(hasGanking(notBuffed, notBuffed.instances[1]!)).toBe(false);

    const buffed = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ogn-125-298" as never, zone: "battlefield", battlefield: 0, buffed: true }],
      extraDefs: [makeCardDef({ type: "unit", id: "ogn-125-298" as never, name: "Bilgewater Bully", gankingWhileBuffed: true })],
    });
    expect(hasGanking(buffed, buffed.instances[1]!)).toBe(true);
  });

  it("live through moveUnits: can't Gank while unbuffed, can once buffed", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 0, defId: "ogn-125-298" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [makeCardDef({ type: "unit", id: "ogn-125-298" as never, name: "Bilgewater Bully", gankingWhileBuffed: true })],
    });
    expect(getLegalActions(state, 0).some((a) => a.type === "moveUnits" && a.iids[0] === 1 && a.to === 1)).toBe(false);

    state.instances[1]!.buffed = true;
    expect(getLegalActions(state, 0).some((a) => a.type === "moveUnits" && a.iids[0] === 1 && a.to === 1)).toBe(true);
    state = applyAction(state, { type: "moveUnits", iids: [1], to: 1 });
    expect(state.instances[1]!.zone).toBe("battlefield");
    expect(state.instances[1]!.battlefield).toBe(1);
  });
});
