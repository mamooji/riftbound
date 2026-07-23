/**
 * Tiny deck-draw primitive, split out of setup.ts so both setup.ts and triggers.ts can use it
 * without importing each other (triggers.ts needs it for draw-effects; setup.ts calls triggers.ts
 * from startTurn).
 */
import type { InstanceId, PlayerId } from "@riftbound/shared";
import { shuffle } from "./rng.js";
import type { GameState } from "./state.js";

/** Draws the top card of the main deck into hand (no-op if the deck is empty). */
export function drawFromMain(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  const top = p.mainDeck.shift();
  if (top === undefined) return;
  state.instances[top as number]!.zone = "hand";
  p.hand.push(top);
}

/** Recycles the top card of the main deck to the bottom (a peek-and-bury effect, e.g. [Vision]). */
export function recycleTopOfMainDeck(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  const top = p.mainDeck.shift();
  if (top === undefined) return;
  p.mainDeck.push(top);
}

/** Recycles a single specific card (from hand, trash, wherever) to the bottom of its OWNER's
 *  corresponding deck — the Main Deck for units/spells/gear, the Rune Deck for runes (rule
 *  403.1.a/b). Used by effects that recycle a chosen card rather than peeking the deck's own top
 *  (e.g. Sabotage). Removes it from whichever tracked list zone it was in (hand, or the runePool,
 *  since those are the only zones the engine tracks as explicit id arrays besides the decks). */
export function recycleCard(state: GameState, iid: InstanceId): void {
  const inst = state.instances[iid as number]!;
  const owner = state.players[inst.owner];
  owner.hand = owner.hand.filter((h) => h !== iid);
  owner.runePool = owner.runePool.filter((h) => h !== iid);
  if (state.defs[inst.defId]!.type === "rune") {
    inst.zone = "runeDeck";
    owner.runeDeck.push(iid);
  } else {
    inst.zone = "mainDeck";
    owner.mainDeck.push(iid);
  }
}

/** Recycles several cards to the bottom of the Main Deck at once, in random order (rule 403.5:
 *  cards recycled to the Main Deck simultaneously are placed in random order) — used by Reinforce's
 *  "recycle the remaining cards" and similar reveal-then-recycle effects. */
export function recycleCards(state: GameState, player: PlayerId, iids: InstanceId[]): void {
  const p = state.players[player];
  const { shuffled, next } = shuffle(iids, state.rng);
  state.rng = next;
  for (const iid of shuffled) {
    state.instances[iid as number]!.zone = "mainDeck";
    p.mainDeck = p.mainDeck.filter((h) => h !== iid);
    p.hand = p.hand.filter((h) => h !== iid);
    p.mainDeck.push(iid);
  }
}
