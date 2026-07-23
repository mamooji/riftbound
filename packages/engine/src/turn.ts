/**
 * The turn structure (Riftbound Core Rules §300-322): Start of Turn is four phases — Awaken,
 * Beginning, Channel, Draw (rule 314-315) — followed by an unstructured Action Phase (modeled
 * implicitly: whatever `getLegalActions` offers while `state.activePlayer === player`, no function
 * here), then an explicit End of Turn Phase (rule 317) run by the "endTurn" action before control
 * passes to the next player.
 *
 * Each phase is its own small function specifically so a future set can hook a new phase-scoped
 * effect (a new "at the start of the Channel Phase" card, a new End of Turn trigger) by extending
 * one function instead of re-reading a monolith.
 */
import { opponentOf, type PlayerId } from "@riftbound/shared";
import { shuffle } from "./rng.js";
import type { GameState } from "./state.js";
import { checkWin, updateControl } from "./showdown.js";
import { drawFromMain } from "./deck.js";
import { onBeginningPhase, onEndTurn } from "./triggers.js";

const BASE_CHANNEL = 2;
const SECOND_PLAYER_FIRST_TURN_CHANNEL = 3;

/** 315.1 Awaken Phase: the turn player readies every Game Object they control that's able to
 *  ready — runes, units, gear, legend. No other effects happen here unless a card's own text says
 *  otherwise (e.g. a card that enters/stays exhausted through Awaken — none exist in Set 1). */
function awakenPhase(state: GameState, player: PlayerId): void {
  for (const inst of Object.values(state.instances)) {
    if (
      inst.controller === player &&
      (inst.zone === "runePool" || inst.zone === "base" || inst.zone === "battlefield" || inst.zone === "legend")
    ) {
      inst.exhausted = false;
    }
  }
}

/**
 * 315.2 Beginning Phase: the Beginning Step's "game effects" (rule 315.2.a.1) — [Temporary]
 * permanents expiring (their own reminder text: "before scoring"), and the Beginning-Phase
 * trigger hook (e.g. Jinx - Loose Cannon) — resolve first, THEN the Scoring Step (rule 315.2.b)
 * awards Holding points. Both Beginning Step effects must land before Scoring; their relative
 * order with each other doesn't matter for any card in the current corpus.
 */
function beginningPhase(state: GameState, player: PlayerId): void {
  const vacated = new Set<number>();
  for (const inst of Object.values(state.instances)) {
    if (inst.controller === player && inst.temporary && (inst.zone === "base" || inst.zone === "battlefield")) {
      if (inst.zone === "battlefield" && inst.battlefield !== null) vacated.add(inst.battlefield);
      state.log.push(`${state.defs[inst.defId]!.name} expires`);
      inst.zone = "trash";
      inst.battlefield = null;
      inst.temporary = false;
    }
  }
  for (const bf of vacated) updateControl(state, bf);

  onBeginningPhase(state, player);

  const p = state.players[player];
  const controlled = state.battlefields.filter((b) => b.controller === player).length;
  if (controlled > 0) {
    p.points += controlled;
    state.log.push(`P${player} scores ${controlled} from control (total ${p.points})`);
  }
  checkWin(state);
}

/** 315.3 Channel Phase: channel 2 runes from the Rune Deck into the pool, ready (3 for the second
 *  player's very first turn). Stops early if the Rune Deck runs out (rule 315.3.b.1). */
function channelPhase(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  const isSecondPlayer = player !== state.firstPlayer;
  const channel = !p.hasTakenTurn && isSecondPlayer ? SECOND_PLAYER_FIRST_TURN_CHANNEL : BASE_CHANNEL;
  for (let i = 0; i < channel; i++) {
    const top = p.runeDeck.shift();
    if (top === undefined) break;
    const rune = state.instances[top as number]!;
    rune.zone = "runePool";
    rune.exhausted = false;
    p.runePool.push(top);
  }
  p.hasTakenTurn = true;
}

/**
 * Rule 418. Burn Out — a player who must Draw with an empty Main Deck instead recycles their
 * Trash into their Main Deck (shuffled) and gives their OPPONENT 1 point, then completes the
 * original Draw. This is a plain repeatable action, NOT a special "instant loss" case: if the
 * Trash is also empty, the Main Deck stays empty and the very next Draw attempt burns out again,
 * awarding another point each time (rule 418.3/418.3.a) — bounded in practice because points only
 * ever go up, so this can fire at most `VICTORY_POINTS_TO_WIN` times before `checkWin` ends the
 * game.
 */
function burnOut(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  const trashIids = Object.values(state.instances)
    .filter((i) => i.owner === player && i.zone === "trash")
    .map((i) => i.iid);
  const { shuffled, next } = shuffle(trashIids, state.rng);
  state.rng = next;
  for (const iid of shuffled) {
    state.instances[iid as number]!.zone = "mainDeck";
    p.mainDeck.push(iid);
  }
  const opponent = opponentOf(player);
  state.players[opponent].points += 1;
  state.log.push(
    `P${player} burns out — recycles ${shuffled.length} card(s) from trash; ` +
      `P${opponent} scores 1 (total ${state.players[opponent].points})`,
  );
  checkWin(state);
}

/** 315.4 Draw Phase: draw the turn's card (Burning Out first if the Main Deck is empty — possibly
 *  repeatedly, see `burnOut`), then the Rune Pool empties: any unspent floated Energy, Power, and
 *  colored runes are lost (rule 315.4.d / 160). */
function drawPhase(state: GameState, player: PlayerId): void {
  const p = state.players[player];
  while (p.mainDeck.length === 0 && state.winner === null) {
    burnOut(state, player);
  }
  if (state.winner === null) drawFromMain(state, player);
  p.energy = 0;
  p.power = 0;
  p.floatingRunes = [];
}

/** Start of Turn (rule 314-315): Awaken, then Beginning, then Channel, then Draw, in that fixed
 *  order. Mutates `state`. */
export function startTurn(state: GameState, player: PlayerId): void {
  state.turn += 1;
  state.activePlayer = player;
  awakenPhase(state, player);
  beginningPhase(state, player);
  channelPhase(state, player);
  drawPhase(state, player);
}

/**
 * 317. End of Turn Phase — run by the "endTurn" action for the player whose turn is ending,
 * before control passes to the next player:
 *  - Ending Step (317.1): "at the end of the turn" triggered abilities (e.g. Annie - Dark Child).
 *  - End of Turn Cleanup (317.2): heal ALL units on the board — not just the survivors of a
 *    Showdown that happened to resolve this turn (rule 140.3.b / 317.2.b: damage clears at two
 *    specific times, Combat Cleanup AND end of turn — Showdown resolution already handles the
 *    first; this covers the second, e.g. damage dealt outside combat like Kog'Maw's Deathknell).
 *  - Expiration Step (317.3): every "this turn" modifier expires simultaneously (Stun, temporary
 *    Might/Ganking grants, Sun Disc's next-unit-enters-ready grant) REGARDLESS of which player's
 *    instance holds it — a modifier granted to an opponent's unit during this turn (e.g. Ahri's
 *    -1 Might to an attacker) still expires at the end of THIS turn, the one that created it, not
 *    the holder's own next turn. The ending player's own Rune Pool and [Legion] flag also clear
 *    here (equivalent in effect to clearing them at the top of their own next turn, since nothing
 *    can add to either during the opponent's turn in this engine, but rules-accurate in name and
 *    ready for that to stop being true in a future set).
 */
export function endOfTurnPhase(state: GameState, player: PlayerId): void {
  onEndTurn(state, player);

  for (const inst of Object.values(state.instances)) inst.damage = 0;

  for (const inst of Object.values(state.instances)) {
    inst.stunned = false;
    inst.tempMightDelta = 0;
    inst.gankingThisTurn = false;
    inst.assaultThisTurn = 0;
    inst.shieldThisTurn = 0;
    inst.tankThisTurn = false;
  }
  for (const ps of state.players) ps.nextUnitEntersReady = false;

  const p = state.players[player];
  p.energy = 0;
  p.power = 0;
  p.floatingRunes = [];
  p.playedCardThisTurn = false;
}
