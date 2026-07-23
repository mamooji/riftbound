/**
 * Game construction: two decks (legend + main deck + 12 runes) and two presented battlefields
 * become an initial GameState.
 *
 * Reflects Set 1 1v1 setup: 2 battlefields in the shared center (one per player), a random first
 * player unless specified, a 4-card opening hand, and rune channeling (2/turn; the second player
 * channels 3 on their first turn).
 */
import type { InstanceId, PlayerId } from "@riftbound/shared";
import { createRng, nextInt, shuffle } from "./rng.js";
import type { CardDef, CardInstance, GameState, PlayerState } from "./state.js";
import { drawFromMain } from "./deck.js";

export { drawFromMain } from "./deck.js";
export { startTurn, endOfTurnPhase } from "./turn.js";

export interface DeckDefinition {
  legend: CardDef;
  /** ~40 units/spells/gear. */
  main: CardDef[];
  /** Exactly 12 rune cards. */
  runes: CardDef[];
  /** The Chosen Champion: starts in the Champion Zone, not shuffled into the main deck. */
  championZone: CardDef | null;
}

export interface NewGameOptions {
  seed: number;
  /** Each player presents one battlefield (battlefields[i] presented by seat i). */
  battlefields: [CardDef, CardDef];
  firstPlayer?: PlayerId;
  openingHandSize?: number;
}

const DEFAULT_OPENING_HAND = 4;

export function createGame(
  decks: [DeckDefinition, DeckDefinition],
  opts: NewGameOptions,
): GameState {
  const openingHand = opts.openingHandSize ?? DEFAULT_OPENING_HAND;
  const instances: Record<number, CardInstance> = {};
  const defs: Record<string, CardDef> = {};
  let nextIid = 1;
  let rng = createRng(opts.seed);

  function register(def: CardDef): void {
    defs[def.id] = def;
  }
  function makeInstance(def: CardDef, owner: PlayerId, zone: CardInstance["zone"]): InstanceId {
    register(def);
    const iid = nextIid++ as InstanceId;
    instances[iid as number] = {
      iid,
      defId: def.id,
      owner,
      controller: owner,
      zone,
      battlefield: null,
      exhausted: false,
      damage: 0,
      buffed: false,
      temporary: false,
      stunned: false,
      tempMightDelta: 0,
      gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false,
    };
    return iid;
  }

  const players: PlayerState[] = [];
  for (let seat = 0 as PlayerId; seat < 2; seat = (seat + 1) as PlayerId) {
    const deck = decks[seat];

    const legendIid = makeInstance(deck.legend, seat, "legend");
    const mainIids = deck.main.map((d) => makeInstance(d, seat, "mainDeck"));
    const runeIids = deck.runes.map((d) => makeInstance(d, seat, "runeDeck"));
    const championIid = deck.championZone
      ? makeInstance(deck.championZone, seat, "championZone")
      : null;

    const sMain = shuffle(mainIids, rng);
    rng = sMain.next;
    const sRune = shuffle(runeIids, rng);
    rng = sRune.next;

    players.push({
      id: seat,
      legendDefId: deck.legend.id,
      legendIid,
      mainDeck: sMain.shuffled,
      runeDeck: sRune.shuffled,
      hand: [],
      runePool: [],
      championZone: championIid,
      energy: 0,
      power: 0,
      floatingRunes: [],
      playedCardThisTurn: false,
      nextUnitEntersReady: false,
      points: 0,
      hasTakenTurn: false,
      extraTurns: 0,
    });
  }

  let firstPlayer: PlayerId;
  if (opts.firstPlayer !== undefined) {
    firstPlayer = opts.firstPlayer;
  } else {
    const draw = nextInt(rng, 2);
    rng = draw.next;
    firstPlayer = draw.value as PlayerId;
  }

  for (const bf of opts.battlefields) register(bf);

  const state: GameState = {
    rng,
    ply: 0,
    turn: 0,
    activePlayer: firstPlayer,
    firstPlayer,
    players: players as [PlayerState, PlayerState],
    battlefields: opts.battlefields.map((def, i) => ({
      index: i,
      defId: def.id,
      name: def.name,
      text: def.text,
      presentedBy: i as PlayerId,
      controller: null,
    })),
    instances,
    defs,
    mulligan: { pending: 0 },
    showdown: null,
    pendingTrigger: null,
    winner: null,
    log: [`P${firstPlayer} goes first`],
  };

  for (const p of state.players) {
    for (let i = 0; i < openingHand; i++) drawFromMain(state, p.id);
  }

  // The real turn 1 (Awaken/Beginning/Channel/Draw — see turn.ts) begins once both players
  // resolve their mulligan; see the "mulligan" case in actions.ts, which calls startTurn once
  // mulligan.pending is null.
  return state;
}
