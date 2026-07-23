/**
 * One test per legend (16 total: 12 Origins + 4 Proving Grounds) — the direct payoff for
 * "all legend abilities are non-functional." Activated abilities live in abilities.ts, triggered
 * ones in triggers.ts, Master Yi - Wuju Bladesman (Starter)'s passive in showdown.ts's `mightIn`.
 */
import { describe, it, expect } from "vitest";
import { applyAction, getLegalActions } from "./actions.js";
import { startShowdown, updateControl } from "./showdown.js";
import { makeBareGame, makeCardDef } from "./test-utils.js";

const KAI_SA = "ogn-247-298";
const VOLIBEAR = "ogn-249-298";
const JINX = "ogn-251-298";
const DARIUS = "ogn-253-298";
const AHRI = "ogn-255-298";
const LEE_SIN = "ogn-257-298";
const YASUO = "ogn-259-298";
const LEONA = "ogn-261-298";
const TEEMO = "ogn-263-298";
const VIKTOR = "ogn-265-298";
const MISS_FORTUNE = "ogn-267-298";
const SETT = "ogn-269-298";
const ANNIE_STARTER = "ogs-017-024";
const MASTER_YI_STARTER = "ogs-019-024";
const LUX_STARTER = "ogs-021-024";
const GAREN_STARTER = "ogs-023-024";

function bareUnit(iid: number, owner: 0 | 1, defId: string, zone: "base" | "battlefield" = "base", battlefield = 0) {
  return {
    iid: iid as never, defId: defId as never, owner, controller: owner, zone, battlefield: zone === "battlefield" ? battlefield : null,
    exhausted: false, damage: 0, buffed: false, temporary: false, stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
  };
}

describe("legend abilities", () => {
  it("1. Kai'Sa - Daughter of the Void: exhaust -> add a rainbow rune", () => {
    let state = makeBareGame({ legendDefIds: [KAI_SA, "legend-test-1"] });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900 });
    expect(state.players[0]!.floatingRunes).toEqual(["rainbow"]);
  });

  it("2. Volibear - Relentless Storm: playing a Mighty unit offers the option to exhaust him and channel a rune exhausted", () => {
    let state = makeBareGame({
      legendDefIds: [VOLIBEAR, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "mighty" as never, might: 6 })],
      playerPatch: [{ hand: [1 as never], runeDeck: [700 as never] }, {}],
    });
    state.instances[1] = { ...bareUnit(1, 0, "mighty"), zone: "hand", battlefield: null };
    state.instances[700] = { ...bareUnit(700, 0, "rune"), zone: "runeDeck", battlefield: null };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });

    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.pendingTrigger).not.toBeNull();
    state = applyAction(state, { type: "resolveTrigger", accept: true });
    expect(state.instances[900]!.exhausted).toBe(true); // Volibear exhausted himself
    expect(state.players[0]!.runePool).toContain(700); // channeled, already exhausted
    expect(state.instances[700]!.exhausted).toBe(true);
  });

  it("3. Jinx - Loose Cannon: at the start of your Beginning Phase, draw 1 if you have <=1 card in hand", () => {
    let state = makeBareGame({
      legendDefIds: [JINX, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "card" as never })],
      playerPatch: [{ mainDeck: [50 as never], hand: [] }, {}],
    });
    state.instances[50] = { ...bareUnit(50, 0, "card"), zone: "mainDeck", battlefield: null };
    state = applyAction(state, { type: "endTurn" });
    state = applyAction(state, { type: "endTurn" }); // back to P0 -- Jinx checks hand size (0) and draws
    expect(state.players[0]!.hand.length).toBeGreaterThanOrEqual(1);
  });

  it("4. Darius - Hand of Noxus: exhaust + [Legion] (played a card this turn) -> add 1 Energy", () => {
    let state = makeBareGame({
      legendDefIds: [DARIUS, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never })],
      playerPatch: [{ hand: [1 as never] }, {}],
    });
    state.instances[1] = { ...bareUnit(1, 0, "u1"), zone: "hand", battlefield: null };

    // Before playing anything this turn, Legion's condition fails -- ability shouldn't be legal.
    expect(getLegalActions(state, 0).some((a) => a.type === "activateAbility" && a.sourceIid === 900)).toBe(false);

    state = applyAction(state, { type: "playCard", iid: 1 }); // sets playedCardThisTurn
    expect(getLegalActions(state, 0).some((a) => a.type === "activateAbility" && a.sourceIid === 900)).toBe(true);
    state = applyAction(state, { type: "activateAbility", sourceIid: 900 });
    expect(state.players[0]!.energy).toBe(1);
  });

  it("5. Ahri - Nine-Tailed Fox: an enemy attacking a battlefield you control gets -1 Might this turn", () => {
    const state = makeBareGame({
      legendDefIds: ["legend-test-0", AHRI], // Ahri belongs to the DEFENDER (P1)
      extraDefs: [makeCardDef({ type: "unit", id: "attacker" as never, might: 3 })],
      units: [bareUnit(1, 1, "attacker", "battlefield", 0)], // P1 already holds battlefield 0
      battlefieldControllers: [1, null],
    });
    updateControl(state, 0);
    state.instances[2] = bareUnit(2, 0, "attacker", "battlefield", 0); // P0 moves in as attacker
    startShowdown(state, 0, 0);
    expect(state.instances[2]!.tempMightDelta).toBe(-1);
  });

  it("6. Lee Sin - Blind Monk: 1 Energy, exhaust -> buff a friendly unit", () => {
    let state = makeBareGame({
      legendDefIds: [LEE_SIN, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "ally" as never })],
      units: [bareUnit(1, 0, "ally")],
      playerPatch: [{ energy: 1 }, {}],
    });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900, targetIid: 1 });
    expect(state.instances[1]!.buffed).toBe(true);
  });

  it("7. Yasuo - Unforgiven: 2 Energy, exhaust -> move a friendly unit back to base", () => {
    let state = makeBareGame({
      legendDefIds: [YASUO, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "ally" as never })],
      units: [bareUnit(1, 0, "ally", "battlefield", 0)],
      playerPatch: [{ energy: 2 }, {}],
    });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900, targetIid: 1 });
    expect(state.instances[1]!.zone).toBe("base");
  });

  it("8. Leona - Radiant Dawn: when you stun an enemy unit, buff a friendly unit", () => {
    let state = makeBareGame({
      legendDefIds: [LEONA, "legend-test-1"],
      extraDefs: [
        makeCardDef({ type: "unit", id: "ally" as never }),
        makeCardDef({ type: "unit", id: "enemy" as never }),
      ],
      units: [bareUnit(1, 0, "ally"), bareUnit(2, 1, "enemy")],
      playerPatch: [{ hand: [3 as never] }, {}],
    });
    state.instances[3] = { ...bareUnit(3, 0, "ogn-051-298"), zone: "hand", battlefield: null };
    state.defs["ogn-051-298"] = makeCardDef({ type: "unit", id: "ogn-051-298" as never, name: "Solari Shieldbearer" });
    state = applyAction(state, { type: "playCard", iid: 3 });
    // Solari Shieldbearer's own stun-target choice fires first (2 legal targets: 1 and 2).
    expect(state.pendingTrigger?.kind).toContain("onPlaySelf");
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    expect(state.instances[2]!.stunned).toBe(true);
    // Leona's own reaction now needs a real choice too (Solari Shieldbearer herself is ALSO now a
    // friendly unit on the board, so there are 2 legal buff targets, not 1 -- correctly pauses).
    expect(state.pendingTrigger?.kind).toContain("onStun");
    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 1 });
    expect(state.instances[1]!.buffed).toBe(true);
  });

  it("9. Teemo - Swift Scout: 1 Energy, exhaust -> return a Teemo unit to hand from the board", () => {
    let state = makeBareGame({
      legendDefIds: [TEEMO, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "teemo-unit" as never, tags: ["Teemo"] })],
      units: [bareUnit(1, 0, "teemo-unit")],
      playerPatch: [{ energy: 1 }, {}],
    });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900, targetIid: 1 });
    expect(state.players[0]!.hand).toContain(1);
    expect(state.instances[1]!.zone).toBe("hand");
  });

  it("10. Viktor - Herald of the Arcane: 1 Energy, exhaust -> play a 1-Might Recruit token", () => {
    let state = makeBareGame({ legendDefIds: [VIKTOR, "legend-test-1"], playerPatch: [{ energy: 1 }, {}] });
    state = applyAction(state, { type: "activateAbility", sourceIid: 900 });
    expect(Object.values(state.instances).some((i) => state.defs[i.defId]!.name === "Recruit")).toBe(true);
  });

  it("11. Miss Fortune - Bounty Hunter: exhaust -> give a unit [Ganking] this turn", () => {
    let state = makeBareGame({
      legendDefIds: [MISS_FORTUNE, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "ally" as never, ganking: false })],
      units: [bareUnit(1, 0, "ally", "battlefield", 0)],
    });
    expect(getLegalActions(state, 0).some((a) => a.type === "moveUnits" && a.iids[0] === 1 && a.to === 1)).toBe(false);
    state = applyAction(state, { type: "activateAbility", sourceIid: 900, targetIid: 1 });
    expect(state.instances[1]!.gankingThisTurn).toBe(true);
    expect(getLegalActions(state, 0).some((a) => a.type === "moveUnits" && a.iids[0] === 1 && a.to === 1)).toBe(true);
  });

  it("12. Sett - The Boss: when you conquer, ready him", () => {
    let state = makeBareGame({
      legendDefIds: [SETT, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never })],
      units: [bareUnit(1, 0, "u1", "battlefield", 0)],
    });
    state.instances[900]!.exhausted = true;
    updateControl(state, 0);
    expect(state.instances[900]!.exhausted).toBe(false);
  });

  it("13. Annie - Dark Child (Starter): at the end of your turn, ready 2 runes", () => {
    let state = makeBareGame({ legendDefIds: [ANNIE_STARTER, "legend-test-1"] });
    state.instances[600] = { ...bareUnit(600, 0, "rune"), zone: "runePool", battlefield: null, exhausted: true };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });
    state.players[0]!.runePool.push(600 as never);
    state = applyAction(state, { type: "endTurn" });
    expect(state.instances[600]!.exhausted).toBe(false);
  });

  it("14. Master Yi - Wuju Bladesman (Starter): a friendly unit defending ALONE gets +2 Might", () => {
    const alone = makeBareGame({
      legendDefIds: ["legend-test-0", MASTER_YI_STARTER],
      extraDefs: [
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "attacker" as never, might: 2 }),
      ],
      units: [bareUnit(1, 1, "defender", "battlefield", 0)],
    });
    startShowdown(alone, 0, 0); // P0 attacks P1's lone defender
    // Attacker deals 2 -> not enough to kill a 2(+2)=4-Might lone defender.
    expect(alone.instances[1]!.zone).toBe("battlefield");

    const withAlly = makeBareGame({
      legendDefIds: ["legend-test-0", MASTER_YI_STARTER],
      extraDefs: [
        makeCardDef({ type: "unit", id: "defender" as never, might: 2 }),
        makeCardDef({ type: "unit", id: "attacker" as never, might: 2 }),
      ],
      units: [bareUnit(1, 1, "defender", "battlefield", 0), bareUnit(2, 1, "defender", "battlefield", 0)],
    });
    startShowdown(withAlly, 0, 0); // two defenders -- no lone-defender bonus this time
    expect(withAlly.showdown === null || withAlly.instances[1]!.damage < 4).toBe(true);
  });

  it("15. Lux - Lady of Luminosity (Starter): playing a spell costing 5+ Energy draws 1", () => {
    let state = makeBareGame({
      legendDefIds: ["legend-test-0", LUX_STARTER],
      extraDefs: [makeCardDef({ type: "spell", id: "big-spell" as never, energy: 5 })],
      playerPatch: [
        {},
        { hand: [1 as never], mainDeck: [50 as never], energy: 5 },
      ],
    });
    state.instances[1] = { ...bareUnit(1, 1, "big-spell"), zone: "hand", battlefield: null };
    state.instances[50] = { ...bareUnit(50, 1, "card"), zone: "mainDeck", battlefield: null };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    state.activePlayer = 1;
    state = applyAction(state, { type: "playCard", iid: 1 });
    expect(state.players[1]!.hand.length).toBe(1); // drew the card that replaced the played spell
  });

  it("16. Garen - Might of Demacia (Starter): when you conquer with 4+ units there, draw 2", () => {
    const units = Array.from({ length: 4 }, (_, i) => bareUnit(i + 1, 0, "u1", "battlefield", 0));
    let state = makeBareGame({
      legendDefIds: [GAREN_STARTER, "legend-test-1"],
      extraDefs: [makeCardDef({ type: "unit", id: "u1" as never })],
      units,
      playerPatch: [{ mainDeck: [50 as never, 51 as never] }, {}],
    });
    state.instances[50] = { ...bareUnit(50, 0, "card"), zone: "mainDeck", battlefield: null };
    state.instances[51] = { ...bareUnit(51, 0, "card"), zone: "mainDeck", battlefield: null };
    state.defs["card"] = makeCardDef({ type: "unit", id: "card" as never });
    updateControl(state, 0);
    expect(state.players[0]!.hand.length).toBe(2);
  });
});
