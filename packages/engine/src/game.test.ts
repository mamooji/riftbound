import { describe, it, expect } from "vitest";
import type { CardColor, PlayerId } from "@riftbound/shared";
import { createRng, nextInt } from "./rng.js";
import { createGame, type DeckDefinition } from "./setup.js";
import { applyAction, getLegalActions, isTerminal, type Action } from "./actions.js";
import { needsAssignment } from "./showdown.js";
import { replay } from "./serialize.js";
import type { CardDef, GameState } from "./state.js";
import { makeCardDef, resetTestIds } from "./test-utils.js";

function unit(might: number, energy = 1, power = 0, color: CardColor = "fury"): CardDef {
  return makeCardDef({ type: "unit", name: `Unit ${might}`, colors: [color], energy, power, might });
}
function rune(color: CardColor = "fury"): CardDef {
  return makeCardDef({ type: "rune", name: "Rune", colors: [color] });
}
function legend(): CardDef {
  return makeCardDef({ type: "legend", name: "Legend" });
}
function bf(name: string): CardDef {
  return makeCardDef({ type: "battlefield", name, colors: ["colorless"] });
}

function deck(): DeckDefinition {
  const main: CardDef[] = [];
  for (let i = 0; i < 30; i++) main.push(unit((i % 5) + 1, (i % 3) + 1));
  const runes: CardDef[] = Array.from({ length: 12 }, () => rune());
  return { legend: legend(), main, runes, championZone: null };
}

function battlefields(): [CardDef, CardDef] {
  return [bf("Alpha Ridge"), bf("Beta Basin")];
}

/** Whoever must act next: mulligan, then showdown assignment, else the active player. */
function actor(state: GameState): PlayerId {
  if (state.mulligan.pending !== null) return state.mulligan.pending;
  const sd = state.showdown;
  if (sd && sd.toAssign !== null && needsAssignment(state, sd.toAssign)) return sd.toAssign;
  return state.activePlayer;
}

function playRandomGame(seed: number): { actions: Action[]; final: GameState } {
  let state = createGame([deck(), deck()], { seed, battlefields: battlefields() });
  const actions: Action[] = [];
  let pick = createRng(seed ^ 0x9e3779b9);
  while (!isTerminal(state)) {
    const legal = getLegalActions(state, actor(state));
    expect(legal.length).toBeGreaterThan(0);
    const r = nextInt(pick, legal.length);
    pick = r.next;
    const action = legal[r.value]!;
    state = applyAction(state, action);
    actions.push(action);
  }
  return { actions, final: state };
}

describe("full-rules game loop", () => {
  it("random play always terminates with a decided result and no illegal actions", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { final } = playRandomGame(seed);
      expect(isTerminal(final)).toBe(true);
      expect(final.winner).not.toBeNull();
    }
  });

  it("is deterministic: same seed + same action log => identical final state", () => {
    resetTestIds();
    const a = playRandomGame(7);
    resetTestIds();
    const fresh = createGame([deck(), deck()], { seed: 7, battlefields: battlefields() });
    const replayed = replay(fresh, a.actions);
    expect(replayed.winner).toEqual(a.final.winner);
    expect(replayed.players[0].points).toEqual(a.final.players[0].points);
    expect(replayed.players[1].points).toEqual(a.final.players[1].points);
  });
});
