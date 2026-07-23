import { describe, it, expect } from "vitest";
import type { InstanceId, PlayerId } from "@riftbound/shared";
import { createRng } from "./rng.js";
import { startShowdown, assignToTarget, needsAssignment } from "./showdown.js";
import type { CardInstance, GameState } from "./state.js";
import { makeCardDef, makeLegendInstance } from "./test-utils.js";

interface UnitSpec {
  owner: PlayerId;
  might: number;
  tank?: boolean;
  assault?: number;
  shield?: number;
}

/** Builds a bare state with the given units already at battlefield 0 (instance iid = index+1). */
function scenario(units: UnitSpec[]): GameState {
  const defs: GameState["defs"] = {};
  const instances: Record<number, CardInstance> = {};
  units.forEach((u, i) => {
    const defId = `d${i}`;
    defs[defId] = makeCardDef({
      type: "unit",
      name: `U${u.might}`,
      might: u.might,
      tank: u.tank ?? false,
      assault: u.assault ?? 0,
      shield: u.shield ?? 0,
    });
    instances[i + 1] = {
      iid: (i + 1) as InstanceId,
      defId: defId as CardInstance["defId"],
      owner: u.owner,
      controller: u.owner,
      zone: "battlefield",
      battlefield: 0,
      exhausted: false,
      damage: 0,
      buffed: false,
      temporary: false,
      stunned: false,
      tempMightDelta: 0,
      gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
    };
  });
  instances[900] = makeLegendInstance(900, 0);
  instances[901] = makeLegendInstance(901, 1);
  defs[instances[900]!.defId] = makeCardDef({ type: "legend", id: instances[900]!.defId });
  defs[instances[901]!.defId] = makeCardDef({ type: "legend", id: instances[901]!.defId });
  return {
    rng: createRng(1),
    ply: 0,
    turn: 1,
    activePlayer: 0,
    firstPlayer: 0,
    players: [
      { id: 0, legendDefId: instances[900]!.defId, legendIid: 900 as InstanceId, mainDeck: [], runeDeck: [], hand: [], runePool: [], championZone: null, energy: 0, power: 0, floatingRunes: [], playedCardThisTurn: false, nextUnitEntersReady: false, points: 0, hasTakenTurn: true, extraTurns: 0 },
      { id: 1, legendDefId: instances[901]!.defId, legendIid: 901 as InstanceId, mainDeck: [], runeDeck: [], hand: [], runePool: [], championZone: null, energy: 0, power: 0, floatingRunes: [], playedCardThisTurn: false, nextUnitEntersReady: false, points: 0, hasTakenTurn: true, extraTurns: 0 },
    ],
    battlefields: [{ index: 0, defId: "bf" as CardInstance["defId"], name: "Field", text: "", presentedBy: 0, controller: null }],
    instances,
    defs,
    mulligan: { pending: null },
    showdown: null,
    pendingTrigger: null,
    chain: [],
    priority: null,
    passStreak: 0,
    nextChainId: 1,
    preventSpellAbilityDamage: false,
    winner: null,
    log: [],
  };
}

function aliveIids(state: GameState): number[] {
  return Object.values(state.instances)
    .filter((i) => i.zone === "battlefield")
    .map((i) => i.iid as number);
}

describe("showdown", () => {
  it("lethal-before-wound with carryover: a 3-might attacker vs two 2-might defenders kills one, wounds none (survivor heals)", () => {
    // instances: 1 = attacker(3, owner0); 2,3 = defenders(2,2, owner1)
    const state = scenario([
      { owner: 0, might: 3 },
      { owner: 1, might: 2 },
      { owner: 1, might: 2 },
    ]);
    startShowdown(state, 0, 0);
    // Attacker has a choice (two targets, 3 dmg < 4 total). Defender total 4 vs attacker might 3 -> forced (kills the single attacker).
    expect(needsAssignment(state, 0)).toBe(true);
    // Attacker assigns 3 to defender unit 2: 2 lethal, 1 carries to... but assigning to a single target caps at its might (2); remaining 1 has no forced target left that dies -> auto-wound handled by advance.
    assignToTarget(state, 0, 2);
    // Resolution done (defender side was forced). Attacker (1 unit, might 3) took 4 -> dies. Defender unit 2 took lethal (dies). Unit 3 survives, healed.
    const alive = aliveIids(state);
    expect(alive).toContain(3); // the un-targeted defender survives
    expect(alive).not.toContain(1); // attacker dies (took 4 >= 3)
    expect(alive).not.toContain(2); // targeted defender dies
    expect(state.instances[3]!.damage).toBe(0); // survivor healed
    expect(state.showdown).toBeNull();
  });

  it("enough damage to kill everything is auto-resolved (no choice needed)", () => {
    const state = scenario([
      { owner: 0, might: 10 },
      { owner: 1, might: 2 },
      { owner: 1, might: 2 },
    ]);
    startShowdown(state, 0, 0);
    // Attacker 10 >= 4 total -> forced, auto. Defender 4 < 10 -> attacker survives.
    expect(state.showdown).toBeNull();
    const alive = aliveIids(state);
    expect(alive).toEqual([1]);
    expect(state.battlefields[0]!.controller).toBe(0); // sole occupant controls
    expect(state.players[0]!.points).toBe(1);
  });

  it("[Tank] must be assigned damage before any non-Tank unit on the same side", () => {
    // instances: 1 = attacker(7, owner0); 2 = non-Tank defender(3, owner1); 3 = Tank defender(2, owner1)
    // Attacker Might (7) is comfortably above the defenders' combined output (3+2=5) so its own
    // survival is unambiguous, isolating the Tank-priority-with-carryover behavior being tested.
    const state = scenario([
      { owner: 0, might: 7 },
      { owner: 1, might: 3 },
      { owner: 1, might: 2, tank: true },
    ]);
    startShowdown(state, 0, 0);
    // Attacker's 7 damage vs defenders: only the Tank (unit 3) is a legal target while untargeted.
    expect(needsAssignment(state, 0)).toBe(false); // only one legal target (Tank) -> forced/auto
    const alive = aliveIids(state);
    // Tank (2 might) dies to the first 2 damage; the remaining 5 carries to the non-Tank (3 might).
    expect(alive).not.toContain(3); // Tank died
    expect(alive).not.toContain(2); // non-Tank also died once it became legal (carryover covers its 3 might)
    expect(alive).toContain(1); // attacker (7 might) survives the defenders' total output of 5
  });

  it("[Tank] absorbs lethal so a non-Tank ally behind it can survive", () => {
    const state = scenario([
      { owner: 0, might: 3 }, // attacker: only enough to kill the Tank, not both
      { owner: 1, might: 2, tank: true },
      { owner: 1, might: 5 },
    ]);
    startShowdown(state, 0, 0);
    const alive = aliveIids(state);
    expect(alive).not.toContain(2); // Tank dies (absorbed the 3 damage, only 2 needed)
    expect(alive).toContain(3); // the non-Tank ally behind it survives untouched
  });

  it("[Assault N] boosts the attacker's Might, [Shield N] boosts the defender's", () => {
    // Attacker has Assault 2 (5 base -> 7 while attacking); defender has Shield 3 (2 base -> 5 while defending).
    const state = scenario([
      { owner: 0, might: 5, assault: 2 },
      { owner: 1, might: 2, shield: 3 },
    ]);
    startShowdown(state, 0, 0);
    // Both totals reflect the keyword bonuses immediately (single unit each side -> forced/auto).
    expect(state.showdown).toBeNull(); // single target each side -> no real choice, auto-resolves
    const alive = aliveIids(state);
    // Defender's effective Might is 5 (2+3 Shield); attacker deals 7 -> lethal -> defender dies.
    expect(alive).not.toContain(2);
    // Defender's effective attack-back is only its base+shield=5 (Shield doesn't apply on offense);
    // attacker's effective Might (for being killed) is 5+2(Assault, since it applies while attacking)=7 -> survives 5 damage.
    expect(alive).toContain(1);
  });
});
