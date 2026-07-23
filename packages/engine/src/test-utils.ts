/**
 * Shared test fixtures. Not part of the public API (not re-exported from index.ts).
 */
import type { CardColor, InstanceId, PlayerId } from "@riftbound/shared";
import { createRng } from "./rng.js";
import { newInstance, type CardDef, type CardInstance, type GameState, type PlayerState } from "./state.js";

let uid = 0;
export function resetTestIds(): void {
  uid = 0;
}

export function makeCardDef(overrides: Partial<CardDef> & Pick<CardDef, "type">): CardDef {
  return {
    id: `t${uid++}` as CardDef["id"],
    name: "Test Card",
    colors: ["fury"] as CardColor[],
    tags: [],
    energy: 0,
    power: 0,
    might: 0,
    text: "",
    entersReady: false,
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
    ...overrides,
  };
}

/** A minimal, ability-free legend instance for bare test scenarios — engine hooks (onConquer,
 *  onPlayCard, etc.) look up `state.players[p].legendIid` unconditionally, so every test fixture
 *  needs one even when the test isn't about legend abilities. */
export function makeLegendInstance(iid: number, owner: PlayerId): CardInstance {
  return newInstance({
    iid: iid as InstanceId,
    defId: `legend-test-${owner}` as CardDef["id"],
    owner,
    zone: "legend",
  });
}

export interface BareUnit {
  iid: number;
  owner: PlayerId;
  defId: CardDef["id"];
  zone: "base" | "battlefield" | "championZone";
  battlefield?: number | null;
  exhausted?: boolean;
  buffed?: boolean;
  stunned?: boolean;
  temporary?: boolean;
}

export interface BareGameOptions {
  /** Real card-id strings for each player's legend, so triggers/abilities registries (keyed by
   *  real ids) can be exercised. Defaults to a generic ability-free legend for each seat. */
  legendDefIds?: [string, string];
  units?: BareUnit[];
  /** Extra CardDefs to register (e.g. a legend def with real tags, an ability source card). */
  extraDefs?: CardDef[];
  battlefieldControllers?: [PlayerId | null, PlayerId | null];
  playerPatch?: [Partial<PlayerState>, Partial<PlayerState>];
}

/** A full, minimal GameState for exercising engine logic directly (no UI/bot involved). Every
 *  player always has a real legend instance (required — see `makeLegendInstance`'s note). */
export function makeBareGame(opts: BareGameOptions = {}): GameState {
  const defs: Record<string, CardDef> = {};
  const instances: Record<number, CardInstance> = {};

  const legendDefIds = opts.legendDefIds ?? ["legend-test-0", "legend-test-1"];
  for (const seat of [0, 1] as PlayerId[]) {
    const defId = legendDefIds[seat]!;
    if (!defs[defId]) defs[defId] = makeCardDef({ type: "legend", id: defId as CardDef["id"], name: defId });
    instances[900 + seat] = { ...makeLegendInstance(900 + seat, seat), defId: defId as CardDef["id"] };
  }

  for (const u of opts.units ?? []) {
    instances[u.iid] = newInstance({
      iid: u.iid as InstanceId,
      defId: u.defId,
      owner: u.owner,
      zone: u.zone,
      battlefield: u.zone === "battlefield" ? (u.battlefield ?? 0) : null,
      exhausted: u.exhausted ?? false,
      buffed: u.buffed ?? false,
      temporary: u.temporary ?? false,
      stunned: u.stunned ?? false,
    });
  }
  for (const d of opts.extraDefs ?? []) defs[d.id] = d;

  const bfControllers = opts.battlefieldControllers ?? [null, null];
  const playerPatch = opts.playerPatch ?? [{}, {}];

  const players = [0, 1].map((seat) => ({
    id: seat as PlayerId,
    legendDefId: legendDefIds[seat]! as CardDef["id"],
    legendIid: (900 + seat) as InstanceId,
    mainDeck: [],
    runeDeck: [],
    hand: [],
    runePool: [],
    championZone: null,
    energy: 0,
    power: 0,
    floatingRunes: [],
    playedCardThisTurn: false,
    nextUnitEntersReady: false,
    points: 0,
    hasTakenTurn: true,
    extraTurns: 0,
    ...playerPatch[seat as number],
  })) as [PlayerState, PlayerState];

  return {
    rng: createRng(1),
    ply: 0,
    turn: 1,
    activePlayer: 0,
    firstPlayer: 0,
    players,
    battlefields: [0, 1].map((i) => ({
      index: i,
      defId: `bf${i}` as CardDef["id"],
      name: `Field ${i}`,
      text: "",
      presentedBy: i as PlayerId,
      controller: bfControllers[i] ?? null,
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
