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
const DISCIPLINE = "ogn-058-298"; // [Reaction] give a unit +2 Might this turn, draw 1
const WIND_WALL = "ogn-064-298"; // [Reaction] Counter a spell
const MYSTIC_REVERSAL = "ogn-080-298"; // [Reaction] Gain control of a spell
const UNYIELDING_SPIRIT = "ogn-145-298"; // [Reaction] Prevent all spell and ability damage this turn

function putInHand(state: GameState, iid: number, owner: 0 | 1, defId: string): CardInstance {
  const inst: CardInstance = {
    iid: iid as never, defId: defId as never, owner, controller: owner, zone: "hand",
    battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
    stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
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
    expect(state.showdown!.toAssign).toBeNull(); // window open
    expect(state.priority).toBe(0); // Focus holder
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
    expect(state.showdown!.toAssign).toBeNull(); // window open
    expect(state.priority).toBe(0); // Focus holder
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
    expect(state.showdown!.toAssign).toBeNull(); // window open
    expect(state.priority).toBe(1); // Focus holder
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

describe("Phase A: spells resolve via the Chain (rule 326-336), not eagerly", () => {
  it("a spell played in a Neutral Open state passes through a Chain item, then drains to trash", () => {
    let state = makeBareGame({
      extraDefs: [makeCardDef({ type: "spell", id: "noop" as never, energy: 1, name: "noop" })],
      playerPatch: [{ energy: 1, power: 0, hand: [] }, {}],
    });
    putInHand(state, 1, 0, "noop");
    expect(state.nextChainId).toBe(1);

    state = applyAction(state, { type: "playCard", iid: 1 });

    // Nobody can respond in Phase A, so the item was pushed and resolved within the same call:
    expect(state.chain).toEqual([]); // Chain drained -> Open State
    expect(state.nextChainId).toBe(2); // one item passed through the Chain
    expect(state.instances[1]!.zone).toBe("trash"); // spell landed in the trash after resolving
    expect(state.priority).toBe(0); // Turn Player holds Priority again (rule 336.2)
  });

  it("a spell whose effect opens a target choice suspends Chain resolution until the pick is made", () => {
    // Incinerate ("deal 2 to a unit at a battlefield") opens a pendingTrigger for its own target.
    let state = makeBareGame({
      units: [
        { iid: 1, owner: 0, defId: "u0" as never, zone: "battlefield", battlefield: 0 },
        { iid: 2, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 1 },
      ],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u0" as never, might: 5 }),
        makeCardDef({ type: "unit", id: "u1" as never, might: 5 }),
        actionSpellDef(INCINERATE, 2, 0),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, {}],
    });
    putInHand(state, 3, 0, INCINERATE);

    state = applyAction(state, { type: "playCard", iid: 3 });
    // The spell is mid-resolution: its target choice is open, blocking the Chain from finishing.
    expect(state.pendingTrigger).not.toBeNull();

    state = applyAction(state, { type: "resolveTrigger", accept: true, targetIid: 2 });
    // Choice made -> resolution resumed and finished: 2 damage dealt, Chain drained, spell trashed.
    expect(state.instances[2]!.damage).toBe(2);
    expect(state.chain).toEqual([]);
    expect(state.instances[3]!.zone).toBe("trash");
  });
});

describe("Phase C: the opponent may respond with a [Reaction] before a spell resolves (Neutral Closed)", () => {
  it("Discipline played in response resolves FIRST (LIFO), saving the unit the damage spell targeted", () => {
    // P0 (turn player) plays Incinerate at P1's lone 2-Might unit -- lethal on its own. Before it
    // resolves, P1 responds with Discipline (+2 Might). LIFO: Discipline resolves first (unit -> 4
    // Might), so Incinerate's 2 damage no longer kills it. Wrong (FIFO) ordering would kill it.
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
        makeCardDef({ type: "spell", id: DISCIPLINE as never, energy: 1, timing: "reaction", name: "Discipline" }),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, { energy: 1, power: 0, hand: [] }],
    });
    putInHand(state, 2, 0, INCINERATE);
    putInHand(state, 3, 1, DISCIPLINE);

    state = applyAction(state, { type: "playCard", iid: 2 }); // P0 plays Incinerate onto the Chain
    // Now a Closed State: P0 auto-passed (no reaction), Priority is with P1, who may respond.
    expect(state.chain.length).toBe(1);
    expect(state.priority).toBe(1);
    expect(getLegalActions(state, 0)).toEqual([]); // P0 no longer has Priority
    expect(getLegalActions(state, 1).some((a) => a.type === "playCard" && a.iid === 3)).toBe(true);
    expect(getLegalActions(state, 1).some((a) => a.type === "pass")).toBe(true);

    state = applyAction(state, { type: "playCard", iid: 3 }); // P1 responds with Discipline
    // Both spells auto-target the lone unit and resolve (LIFO) within this call:
    expect(state.chain).toEqual([]);
    expect(state.instances[1]!.zone).toBe("battlefield"); // survived
    expect(state.instances[1]!.damage).toBe(2); // took Incinerate's 2, but 2 < 4 effective Might
    expect(state.instances[2]!.zone).toBe("trash"); // Incinerate spent
    expect(state.instances[3]!.zone).toBe("trash"); // Discipline spent
  });

  it("if the opponent instead passes, the damage spell resolves and kills the unit", () => {
    let state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
        makeCardDef({ type: "spell", id: DISCIPLINE as never, energy: 1, timing: "reaction", name: "Discipline" }),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, { energy: 1, power: 0, hand: [] }],
    });
    putInHand(state, 2, 0, INCINERATE);
    putInHand(state, 3, 1, DISCIPLINE);

    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "pass" }); // P1 declines to respond
    expect(state.instances[1]!.zone).toBe("trash"); // Incinerate resolved: 2 >= 2, lethal
    expect(state.players[1]!.hand).toContain(3 as never); // Discipline never played
    expect(state.chain).toEqual([]);
  });
});

describe("Phase D: Counter, control-theft, and damage prevention", () => {
  function damageSpellVsReaction(reactionId: string, reactionEnergy: number) {
    const state = makeBareGame({
      units: [{ iid: 1, owner: 1, defId: "u1" as never, zone: "battlefield", battlefield: 0 }],
      extraDefs: [
        makeCardDef({ type: "unit", id: "u1" as never, might: 2 }),
        actionSpellDef(INCINERATE, 2, 0),
        makeCardDef({ type: "spell", id: reactionId as never, energy: reactionEnergy, timing: "reaction", name: reactionId }),
      ],
      playerPatch: [{ energy: 2, power: 0, hand: [] }, { energy: reactionEnergy, power: 0, hand: [] }],
    });
    putInHand(state, 2, 0, INCINERATE);
    putInHand(state, 3, 1, reactionId);
    return state;
  }

  it("Wind Wall counters the spell it responds to — the damage never happens", () => {
    let state = damageSpellVsReaction(WIND_WALL, 3);
    state = applyAction(state, { type: "playCard", iid: 2 }); // P0 Incinerate at P1's unit
    state = applyAction(state, { type: "playCard", iid: 3 }); // P1 responds with Wind Wall
    // Wind Wall resolves first (LIFO), counters Incinerate; Incinerate then does nothing.
    expect(state.instances[1]!.zone).toBe("battlefield"); // unit survived — never took damage
    expect(state.instances[1]!.damage).toBe(0);
    expect(state.instances[2]!.zone).toBe("trash"); // Incinerate countered -> trashed, not played
    expect(state.instances[3]!.zone).toBe("trash"); // Wind Wall spent
    expect(state.chain).toEqual([]);
  });

  it("Mystic Reversal steals the spell — the thief now chooses its target", () => {
    // P0 Incinerate targeting P1's unit; P1 steals it with Mystic Reversal. Now P1 controls
    // Incinerate and re-aims it. With a single unit on board it hits that unit (P1's own), proving
    // control (and target choice) transferred: the damage is dealt by P1's copy.
    let state = damageSpellVsReaction(MYSTIC_REVERSAL, 4);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "playCard", iid: 3 });
    // Incinerate is now controlled by P1 (owner still P0). It resolves under P1 and hits the lone unit.
    expect(state.instances[2]!.controller).toBe(1);
    expect(state.instances[1]!.zone).toBe("trash"); // 2 damage >= 2 Might, killed
    expect(state.chain).toEqual([]);
  });

  it("Unyielding Spirit prevents the spell's damage this turn", () => {
    let state = damageSpellVsReaction(UNYIELDING_SPIRIT, 1);
    state = applyAction(state, { type: "playCard", iid: 2 });
    state = applyAction(state, { type: "playCard", iid: 3 }); // resolves first, sets the shield
    // Incinerate then resolves but its damage is prevented.
    expect(state.preventSpellAbilityDamage).toBe(true);
    expect(state.instances[1]!.zone).toBe("battlefield");
    expect(state.instances[1]!.damage).toBe(0);
    expect(state.instances[2]!.zone).toBe("trash"); // Incinerate still "played", just did nothing
  });
});

describe("Hidden keyword (rule 727): hide facedown, then play later ignoring base cost", () => {
  it("hides a [Hidden] card facedown at a controlled battlefield for one rune", () => {
    let state = makeBareGame({
      battlefieldControllers: [0, null],
      extraDefs: [makeCardDef({ type: "spell", id: "hs" as never, energy: 5, hidden: true, timing: "reaction", name: "hs" })],
      playerPatch: [{ power: 1, energy: 0, hand: [] }, {}],
    });
    putInHand(state, 1, 0, "hs");
    // Provide a rune in the pool so 1 Power is payable.
    state.instances[50] = {
      iid: 50 as never, defId: "rune" as never, owner: 0, controller: 0, zone: "runePool",
      battlefield: null, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
    state.defs["rune"] = makeCardDef({ type: "rune", id: "rune" as never });
    state.players[0]!.runePool.push(50 as never);

    expect(getLegalActions(state, 0).some((a) => a.type === "hide" && a.iid === 1 && a.battlefield === 0)).toBe(true);
    state = applyAction(state, { type: "hide", iid: 1, battlefield: 0 });
    expect(state.instances[1]!.zone).toBe("facedown");
    expect(state.instances[1]!.battlefield).toBe(0);
    expect(state.instances[1]!.hiddenOnTurn).toBe(state.turn);
    expect(state.players[0]!.hand).not.toContain(1 as never);
    // Not playable the same turn it was hidden (gains [Reaction] only next turn, rule 727.1.b):
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 1)).toBe(false);
  });

  it("plays a facedown card on a later turn, ignoring its base cost, resolving via the Chain", () => {
    const state = makeBareGame({
      battlefieldControllers: [0, null],
      extraDefs: [makeCardDef({ type: "spell", id: "hs" as never, energy: 5, hidden: true, timing: "reaction", name: "hs" })],
      playerPatch: [{ power: 0, energy: 0, hand: [] }, {}], // no resources at all
    });
    // A card hidden on turn 0; the game is on turn 1, so it has gained [Reaction] and is playable.
    state.instances[1] = {
      iid: 1 as never, defId: "hs" as never, owner: 0, controller: 0, zone: "facedown",
      battlefield: 0, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: 0,
    };
    expect(state.turn).toBe(1);
    expect(getLegalActions(state, 0).some((a) => a.type === "playCard" && a.iid === 1)).toBe(true);

    const after = applyAction(state, { type: "playCard", iid: 1 });
    // Played despite 0 energy/power (base cost ignored); resolved through the Chain to the trash.
    expect(after.instances[1]!.zone).toBe("trash");
    expect(after.chain).toEqual([]);
  });

  it("discards a facedown card once its controller loses the battlefield (rule 322.5)", () => {
    const state = makeBareGame({
      battlefieldControllers: [0, null],
      extraDefs: [makeCardDef({ type: "spell", id: "hs" as never, hidden: true, name: "hs" })],
    });
    state.instances[1] = {
      iid: 1 as never, defId: "hs" as never, owner: 0, controller: 0, zone: "facedown",
      battlefield: 0, exhausted: false, damage: 0, buffed: false, temporary: false,
      stunned: false, tempMightDelta: 0, gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: 0,
    };
    // Flip control of the battlefield away from P0, then take any action to trigger cleanup.
    state.battlefields[0]!.controller = 1;
    const after = applyAction(state, { type: "endTurn" });
    expect(after.instances[1]!.zone).toBe("trash");
  });
});
