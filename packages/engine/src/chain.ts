/**
 * The Chain (rule 326-336): a LIFO stack of Finalized items awaiting resolution. When a spell is
 * played it is placed here rather than resolving eagerly, so other players get a Window of
 * Opportunity to respond with `[Reaction]`s before it resolves (rule 356.3.c). The newest item (top
 * of the stack) resolves first, and only once every player has passed Priority in a row with
 * nothing added (rule 335-336).
 *
 * Phase C: the Chain is a *real* response window. While a Chain exists the turn is in a Closed State
 * (rule 309.1), so the only legally-timed play is a `[Reaction]` spell; `advanceChain` offers
 * Priority to each player in turn and auto-passes anyone with no legal reaction, resolving the top
 * item once both have passed consecutively. A spell played in response goes on top and the loop
 * repeats (LIFO). Inside a Showdown the same machinery nests under the Action Window (Focus *is*
 * Priority — rule 313.2): when the Chain drains, control returns to the Showdown's Action Window.
 */
import { opponentOf, type InstanceId, type PlayerId } from "@riftbound/shared";
import { getInstance, windowIsOpen, type GameState } from "./state.js";
import { advanceActionWindow, hasLegalReaction } from "./showdown.js";
import { castSpell } from "./spells.js";

const NUM_PLAYERS = 2; // 1v1 only (locked design decision); the pass-round completes after 2 passes.

/** Rule 351: put a just-played spell onto the Chain as a Finalized item; its controller becomes the
 *  Active Player and holds Priority (rule 332/333.1.c.3). A play resets the pass streak (rule 335). */
export function pushSpellToChain(state: GameState, controller: PlayerId, spellIid: InstanceId): void {
  getInstance(state, spellIid).zone = "chain";
  state.chain.push({ id: state.nextChainId++, kind: "spell", sourceIid: spellIid, controller });
  state.passStreak = 0;
  state.priority = controller;
}

/** A player passes Priority (rule 335.2): the streak grows and Priority moves to the next player. */
export function passPriority(state: GameState): void {
  state.passStreak += 1;
  state.priority = opponentOf(state.priority!);
}

/** Rule 336.1: resolve the top (newest) Chain item. It is popped *before* its effect executes (like
 *  a stack pop), so an effect that opens a `pendingTrigger` for its own targets finishes resolving
 *  across later `applyAction`s without the item lingering. */
function resolveTop(state: GameState): void {
  const item = state.chain.pop()!;
  state.passStreak = 0;
  const inst = getInstance(state, item.sourceIid);
  inst.zone = "trash"; // default landing (rule 348.2); an effect may override (e.g. Time Warp banishes)
  if (item.countered) {
    state.log.push(`${state.defs[inst.defId]!.name} is countered`); // rule 412.1.a: does nothing
    return;
  }
  castSpell(state, item.controller, inst);
}

/**
 * Drive the Chain forward (rule 333-336). Suspends (returns) whenever a real decision is pending — a
 * target choice (`pendingTrigger`) or a player who has a legal reaction to respond with — and
 * resumes when the caller re-invokes it after that decision resolves.
 */
export function advanceChain(state: GameState): void {
  if (state.pendingTrigger !== null || state.winner !== null) return;

  while (state.chain.length > 0) {
    // Resolve the top once every player has passed Priority in a row (rule 335.1).
    if (state.passStreak >= NUM_PLAYERS) {
      resolveTop(state);
      if (state.pendingTrigger !== null || state.winner !== null) return; // a choice opened -> wait
      // Rule 336.4: if items remain, the newest one's controller gains Priority; else drain done.
      if (state.chain.length > 0) state.priority = state.chain[state.chain.length - 1]!.controller;
      continue;
    }
    // Offer Priority to the current holder; auto-pass anyone with no legal reaction to respond with.
    if (hasLegalReaction(state, state.priority!)) return; // a real decision — wait for the player
    passPriority(state);
  }

  // Chain empty. Inside a Showdown, hand control back to the Action Window (which passes Focus and
  // may close into combat). In a Neutral state, the Turn Player holds Priority again (rule 336.2).
  if (state.showdown !== null && windowIsOpen(state.showdown)) {
    advanceActionWindow(state);
  } else if (state.showdown === null) {
    state.priority = state.activePlayer;
    state.passStreak = 0;
  }
}
