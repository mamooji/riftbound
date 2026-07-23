/**
 * Scenario sandbox — build an arbitrary, valid `GameState` directly, without dealing/shuffling a
 * real game, so a specific card interaction can be set up and exercised in one step.
 *
 * This is the backbone of the manual testing UI (and handy for targeted engine tests): drop a
 * legend, some units/gear, spells in hand, and a rune pool onto the board for each player, set the
 * floated resources, and hand the result straight to `getLegalActions`/`applyAction`. Everything it
 * produces is the same plain-JSON `GameState` the rest of the engine consumes.
 *
 * It takes engine `CardDef`s as input (the caller supplies them from the card catalog) — the engine
 * never depends on the catalog package. Rune instances are synthesized from a color spec, so the
 * caller doesn't need real rune `CardDef`s just to give a player something to pay with.
 */
import type { CardColor, InstanceId, PlayerId } from "@riftbound/shared";
import { createRng } from "./rng.js";
import {
  newInstance,
  type CardDef,
  type CardInstance,
  type GameState,
  type PlayerState,
  type RuneColor,
  type Zone,
} from "./state.js";

/** One card to place, by catalog def id, in a specific zone with optional per-instance state. */
export interface ScenarioCard {
  defId: string;
  zone: Zone;
  /** Required (defaults to 0) when `zone === "battlefield"`. */
  battlefield?: number;
  exhausted?: boolean;
  buffed?: boolean;
  stunned?: boolean;
  temporary?: boolean;
  damage?: number;
  tempMightDelta?: number;
  /** For a `facedown` [Hidden] card: the turn it was hidden on. */
  hiddenOnTurn?: number | null;
}

/** A channeled rune in a player's pool — synthesized, so only its color + ready/exhausted matter. */
export interface ScenarioRune {
  color: CardColor;
  exhausted?: boolean;
}

export interface ScenarioPlayer {
  legendDefId: string;
  /** Cards on the board / in hand / in deck zones for this player. */
  cards?: ScenarioCard[];
  /** Channeled runes available to pay costs. */
  runes?: ScenarioRune[];
  /** Already-floated Energy / Power in the pool (spendable immediately). */
  energy?: number;
  power?: number;
  /** Floating colored runes (for colored ability costs / Deflect). */
  floatingRunes?: RuneColor[];
  points?: number;
  playedCardThisTurn?: boolean;
  nextUnitEntersReady?: boolean;
}

export interface ScenarioConfig {
  /** Every engine `CardDef` referenced by any player's legend / cards / champion, plus the two
   *  battlefield defs. Rune defs are synthesized and need not be included. */
  defs: CardDef[];
  /** The two presented battlefields, by def id. */
  battlefields: [string, string];
  /** Optional pre-set battlefield controllers (else derived: sole occupant controls). */
  battlefieldControllers?: [PlayerId | null, PlayerId | null];
  players: [ScenarioPlayer, ScenarioPlayer];
  activePlayer?: PlayerId;
  firstPlayer?: PlayerId;
  turn?: number;
  seed?: number;
}

/** A minimal rune `CardDef` of a single color, synthesized so scenario runes can be paid with. */
function runeDef(color: CardColor): CardDef {
  return {
    id: `sandbox-rune-${color}` as CardDef["id"],
    name: `${color} rune`,
    type: "rune",
    colors: [color],
    tags: [],
    energy: 0,
    power: 0,
    might: 0,
    text: "",
    entersReady: true,
    ganking: false,
    assault: 0,
    shield: 0,
    tank: false,
    playToOpenBattlefield: false,
    accelerateCost: null,
    deflect: 0,
    extraMightWhileBuffed: 0,
    auraMightBonus: 0,
    gankingWhileBuffed: false,
    timing: "sorcery",
    hidden: false,
    image: null,
  };
}

/**
 * Builds a ready-to-play `GameState` from a scenario description. Throws (with the offending id)
 * if any referenced def is missing, so a typo surfaces immediately instead of as a later crash.
 */
export function buildScenario(config: ScenarioConfig): GameState {
  const defs: Record<string, CardDef> = {};
  for (const d of config.defs) defs[d.id] = d;
  for (const color of ["fury", "calm", "mind", "body", "chaos", "order", "colorless"] as CardColor[]) {
    const rd = runeDef(color);
    defs[rd.id] = rd;
  }

  const need = (id: string, what: string): void => {
    if (!defs[id]) throw new Error(`buildScenario: missing CardDef for ${what} "${id}"`);
  };
  need(config.battlefields[0], "battlefield 0");
  need(config.battlefields[1], "battlefield 1");

  const instances: Record<number, CardInstance> = {};
  let nextIid = 1;
  const add = (partial: Omit<Parameters<typeof newInstance>[0], "iid">): InstanceId => {
    const iid = nextIid++ as InstanceId;
    instances[iid as number] = newInstance({ ...partial, iid });
    return iid;
  };

  const players: PlayerState[] = [];
  for (const seat of [0, 1] as PlayerId[]) {
    const sp = config.players[seat];
    need(sp.legendDefId, `player ${seat} legend`);
    const legendIid = add({ defId: sp.legendDefId as CardDef["id"], owner: seat, zone: "legend" });

    const mainDeck: InstanceId[] = [];
    const runeDeck: InstanceId[] = [];
    const hand: InstanceId[] = [];
    const runePool: InstanceId[] = [];
    let championZone: InstanceId | null = null;

    for (const card of sp.cards ?? []) {
      need(card.defId, `player ${seat} card`);
      const onBattlefield = card.zone === "battlefield";
      const iid = add({
        defId: card.defId as CardDef["id"],
        owner: seat,
        zone: card.zone,
        battlefield: onBattlefield ? card.battlefield ?? 0 : null,
        exhausted: card.exhausted ?? false,
        buffed: card.buffed ?? false,
        stunned: card.stunned ?? false,
        temporary: card.temporary ?? false,
        damage: card.damage ?? 0,
        tempMightDelta: card.tempMightDelta ?? 0,
        hiddenOnTurn: card.hiddenOnTurn ?? null,
      });
      if (card.zone === "hand") hand.push(iid);
      else if (card.zone === "mainDeck") mainDeck.push(iid);
      else if (card.zone === "runeDeck") runeDeck.push(iid);
      else if (card.zone === "runePool") runePool.push(iid);
      else if (card.zone === "championZone") championZone = iid;
    }

    for (const rune of sp.runes ?? []) {
      const iid = add({
        defId: `sandbox-rune-${rune.color}` as CardDef["id"],
        owner: seat,
        zone: "runePool",
        exhausted: rune.exhausted ?? false,
      });
      runePool.push(iid);
    }

    players.push({
      id: seat,
      legendDefId: sp.legendDefId as CardDef["id"],
      legendIid,
      mainDeck,
      runeDeck,
      hand,
      runePool,
      championZone,
      energy: sp.energy ?? 0,
      power: sp.power ?? 0,
      floatingRunes: [...(sp.floatingRunes ?? [])],
      playedCardThisTurn: sp.playedCardThisTurn ?? false,
      nextUnitEntersReady: sp.nextUnitEntersReady ?? false,
      points: sp.points ?? 0,
      hasTakenTurn: true,
      extraTurns: 0,
    });
  }

  const firstPlayer = config.firstPlayer ?? 0;
  const activePlayer = config.activePlayer ?? firstPlayer;
  const controllers = config.battlefieldControllers ?? [null, null];

  return {
    rng: createRng(config.seed ?? 1),
    ply: 0,
    turn: config.turn ?? 1,
    activePlayer,
    firstPlayer,
    players: players as [PlayerState, PlayerState],
    battlefields: config.battlefields.map((defId, i) => ({
      index: i,
      defId: defId as CardDef["id"],
      name: defs[defId]!.name,
      text: defs[defId]!.text,
      presentedBy: i as PlayerId,
      controller: controllers[i] ?? null,
    })),
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
