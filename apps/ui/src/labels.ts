/**
 * Human-readable rendering of engine `Action`s and "whose decision is it" — so the actions panel
 * reads like game moves rather than raw JSON.
 */
import type { Action, GameState } from "@riftbound/engine";
import { windowIsOpen } from "@riftbound/engine";
import type { PlayerId } from "@riftbound/shared";

export function cardName(state: GameState, iid: number): string {
  const inst = state.instances[iid];
  if (!inst) return `#${iid}`;
  return `${state.defs[inst.defId]?.name ?? inst.defId} (#${iid})`;
}

function bfName(state: GameState, i: number | "base"): string {
  return i === "base" ? "base" : state.battlefields[i]?.name ?? `field ${i}`;
}

export function actionLabel(state: GameState, a: Action): string {
  switch (a.type) {
    case "playCard": {
      const extra = a.accelerate ? " [Accelerate]" : a.battlefield !== undefined ? ` → ${bfName(state, a.battlefield)}` : "";
      return `Play ${cardName(state, a.iid)}${extra}`;
    }
    case "floatEnergy":
      return `Float Energy (exhaust rune #${a.runeIid})`;
    case "floatPower":
      return `Float Power (recycle rune #${a.runeIid})`;
    case "moveUnits":
      return `Move ${a.iids.map((i) => cardName(state, i)).join(", ")} → ${bfName(state, a.to)}`;
    case "assignDamage":
      return `Assign damage → ${cardName(state, a.targetIid)}`;
    case "activateAbility":
      return `Activate ${cardName(state, a.sourceIid)}${a.targetIid !== undefined ? ` → ${cardName(state, a.targetIid)}` : ""}`;
    case "resolveTrigger": {
      if (!a.accept) return "Decline / decline pick";
      if (a.battlefield !== undefined) return `Choose ${bfName(state, a.battlefield)}`;
      if (a.targetIid !== undefined) return `Choose ${cardName(state, a.targetIid)}`;
      return "Accept";
    }
    case "hide":
      return `Hide ${cardName(state, a.iid)} at ${bfName(state, a.battlefield)}`;
    case "mulligan":
      return a.iids.length ? `Mulligan ${a.iids.length}` : "Keep hand";
    case "pass":
      return state.chain.length > 0 ? "Pass priority" : "Pass (Focus / Action Window)";
    case "endTurn":
      return "End turn";
  }
}

/** A short key that makes each action button stable across re-renders. */
export function actionKey(a: Action): string {
  return JSON.stringify(a);
}

/** Which seat the engine is currently waiting on (pending decision > chain/window priority > turn). */
export function whoActs(state: GameState): PlayerId | null {
  if (state.winner !== null) return null;
  if (state.pendingTrigger) return state.pendingTrigger.player;
  if (state.chain.length > 0) return state.priority;
  if (state.showdown && windowIsOpen(state.showdown)) return state.priority;
  if (state.showdown) return state.showdown.toAssign;
  return state.activePlayer;
}

/** One-line description of the current phase/decision, for the status bar. */
export function phaseLabel(state: GameState): string {
  if (state.winner !== null) return `Game over — winner: ${state.winner === "draw" ? "draw" : `P${state.winner}`}`;
  if (state.pendingTrigger) {
    const t = state.pendingTrigger;
    return `Pending trigger "${t.kind}" — P${t.player} decides` + (t.maxPicks > 1 ? ` (picked ${t.picked.length}/${t.maxPicks})` : "");
  }
  if (state.chain.length > 0) return `Chain (${state.chain.length} item(s)) — P${state.priority} has priority`;
  if (state.showdown && windowIsOpen(state.showdown)) return `Showdown Action Window — P${state.priority} has Focus`;
  if (state.showdown) return `Showdown damage assignment — P${state.showdown.toAssign} assigns`;
  return `Open state — P${state.activePlayer}'s turn`;
}
