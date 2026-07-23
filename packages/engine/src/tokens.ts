/**
 * Token creation — "play a 1 Might Recruit unit token" / "a ready 3 Might Sprite unit token"
 * effects, used by several unit/gear/legend abilities (Viktor, Vanguard Captain, Faithful
 * Manufactor, Noxian Drummer, Machine Evangel, ...).
 *
 * Token stats are hardcoded here rather than looked up from the catalog: tokens are excluded from
 * deck-building (they're never drawn/played from a deck) and have no unique ability text of their
 * own beyond their printed Might + [Temporary] (Sprite) — small enough to define directly, same as
 * everywhere else in this engine that hardcodes small, closed sets of Set-1-specific facts.
 */
import type { PlayerId } from "@riftbound/shared";
import type { CardDef, CardInstance, GameState, Zone } from "./state.js";

export const RECRUIT_TOKEN: CardDef = {
  id: "token-recruit" as CardDef["id"],
  name: "Recruit",
  type: "unit",
  colors: ["colorless"],
  tags: [],
  energy: 0,
  power: 0,
  might: 1,
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
};

export const SPRITE_TOKEN: CardDef = {
  id: "token-sprite" as CardDef["id"],
  name: "Sprite",
  type: "unit",
  colors: ["colorless"],
  tags: [],
  energy: 0,
  power: 0,
  might: 3,
  text: "[Temporary] (Kill me at the start of my controller's Beginning Phase, before scoring.)",
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
};

/** Instantiates a token directly onto the board (base or a battlefield), owned/controlled by `player`.
 *  The new instance id is derived from the current state (one past the current max) rather than a
 *  module-level counter, so it stays a pure function of `state` — required for this engine's
 *  determinism/serializability (self-play/MCTS may branch many parallel states from one snapshot). */
export function createToken(
  state: GameState,
  player: PlayerId,
  def: CardDef,
  zone: Extract<Zone, "base" | "battlefield">,
  battlefield: number | null = null,
  ready = false,
): CardInstance {
  state.defs[def.id] = def;
  const iid = Object.keys(state.instances).reduce((max, k) => Math.max(max, Number(k)), 0) + 1;
  const inst: CardInstance = {
    iid: iid as CardInstance["iid"],
    defId: def.id,
    owner: player,
    controller: player,
    zone,
    battlefield: zone === "battlefield" ? battlefield : null,
    exhausted: !ready,
    damage: 0,
    buffed: false,
    temporary: def === SPRITE_TOKEN,
    stunned: false,
    tempMightDelta: 0,
    gankingThisTurn: false, assaultThisTurn: 0, shieldThisTurn: 0, tankThisTurn: false, hiddenOnTurn: null,
  };
  state.instances[iid] = inst;
  state.log.push(`P${player} creates a ${def.name} token${zone === "battlefield" ? ` at ${state.battlefields[battlefield!]!.name}` : ""}`);
  return inst;
}
