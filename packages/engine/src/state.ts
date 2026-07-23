/**
 * Core game state for the Riftbound engine (Set 1 mechanics).
 *
 * Everything here is plain-JSON-serializable. Behaviour lives in actions.ts / showdown.ts /
 * resources.ts, never on the data.
 *
 * Models the real resource + combat systems: a rune pool (exhaust a rune -> Energy, recycle a
 * rune -> Power, both "floatable" into your pool), units that enter exhausted, and Showdowns
 * with player-assigned damage. Card abilities are NOT yet scripted — cards carry their rules
 * text but only cost/Might are mechanically live.
 */
import type { CardColor, CardDefId, InstanceId, PlayerId } from "@riftbound/shared";
import type { RngState } from "./rng.js";

export type EngineCardType = "unit" | "spell" | "gear" | "rune" | "legend" | "battlefield";

/** A floating rune resource's color — a real domain, or "rainbow" (any color, e.g. Kai'Sa). */
export type RuneColor = CardColor | "rainbow";

/** A spell's timing keyword (rule 152.2 — only meaningful for spell-type cards): "sorcery" (no
 *  keyword — playable only during the Turn Player's own Neutral Open Action Phase), "action"
 *  (also playable during a Showdown's Action Window, rule 340-345), or "reaction" (also playable
 *  during any Closed State — not yet supported; treated the same as "action" until Phase 3). */
export type SpellTiming = "sorcery" | "action" | "reaction";

export type Zone =
  | "mainDeck"
  | "runeDeck"
  | "hand"
  | "base"
  | "battlefield"
  | "runePool"
  | "championZone"
  | "legend"
  | "trash"
  | "banishment";

/** A static card definition, projected from the Set 1 catalog into what the engine needs. */
export interface CardDef {
  id: CardDefId;
  name: string;
  type: EngineCardType;
  colors: CardColor[];
  /** Character/region tags (e.g. ["Trifarian","Darius","Noxus"]) — used for Chosen Champion and
   *  Signature deck-legality checks (must share a tag with the legend). */
  tags: string[];
  /** Energy cost (pay by exhausting runes). */
  energy: number;
  /** Power cost (pay by recycling runes). */
  power: number;
  /** Combat stat (units). */
  might: number;
  text: string;
  /** Units normally enter exhausted; a few enter ready (card text). Default false. */
  entersReady: boolean;
  /** [Ganking] — may move battlefield-to-battlefield directly (bypassing the base<->battlefield
   *  Standard Move restriction that applies to every other unit). */
  ganking: boolean;
  /** [Assault N] — +N Might while this unit is the attacker (mover) in a Showdown. 0 if none. */
  assault: number;
  /** [Shield N] — +N Might while this unit is the defender in a Showdown. 0 if none. */
  shield: number;
  /** [Tank] — must be assigned combat damage before any non-Tank unit at the same battlefield. */
  tank: boolean;
  /** "You may play me to an open battlefield" — may be played directly to a battlefield with no
   *  units from either player (a narrower exception than the base "battlefield you control" rule). */
  playToOpenBattlefield: boolean;
  /** [Accelerate] — may pay this extra cost at play time to enter ready instead of exhausted. */
  accelerateCost: { energy: number; rune: CardColor } | null;
  /** [Deflect N] — an opponent must spend N floating rainbow runes to choose this unit as the
   *  target of a spell or ability. 0 if none. */
  deflect: number;
  /** "While I'm buffed, I have an additional +N Might" (e.g. Wizened Elder) — on top of the
   *  standard +1 every buffed unit already gets. 0 if none. */
  extraMightWhileBuffed: number;
  /** "Other friendly units have +N Might here" (e.g. Darius - Executioner, Garen - Commander) — a
   *  static aura granted to every OTHER friendly unit in the same zone (same battlefield, or base)
   *  as this one. 0 if none. */
  auraMightBonus: number;
  /** "While I'm buffed, I have [Ganking]" (e.g. Bilgewater Bully) — conditional on the current
   *  buff state, not a fixed flag like `ganking`. */
  gankingWhileBuffed: boolean;
  /** Only meaningful for spell-type cards — see `SpellTiming`. Non-spells are always "sorcery"
   *  (unused). */
  timing: SpellTiming;
  image: string | null;
}

export interface CardInstance {
  iid: InstanceId;
  defId: CardDefId;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  /** Battlefield index when zone === "battlefield", else null. */
  battlefield: number | null;
  /** Ready (false) vs exhausted (true). Applies to units and runes. */
  exhausted: boolean;
  /** Damage marked this combat (units); cleared when survivors heal. */
  damage: number;
  /** [Buff] — idempotent: giving a buff to an already-buffed unit does nothing extra. +1 Might. */
  buffed: boolean;
  /** [Temporary] — killed at the start of its controller's next Beginning Phase, before scoring. */
  temporary: boolean;
  /** Stunned — doesn't deal combat damage this turn (can still be targeted/killed normally).
   *  Cleared for everyone at the top of every `startTurn` call (a stun always reads "this turn"). */
  stunned: boolean;
  /** A "this turn" Might modifier from an ability (e.g. Ahri's -1 to an attacker). Signed; cleared
   *  at the top of every `startTurn` call, same cadence as `stunned`. */
  tempMightDelta: number;
  /** [Ganking] granted "this turn" by an ability (e.g. Miss Fortune's legend ability), on top of
   *  whatever the card's own printed `ganking` flag says. Cleared the same way as `stunned`. */
  gankingThisTurn: boolean;
  /** [Assault N] granted "this turn" by a spell/ability (e.g. Cleave), ADDED to the card's own
   *  printed `assault` value. Cleared the same way as `stunned`. */
  assaultThisTurn: number;
  /** [Shield N] granted "this turn" by a spell/ability (e.g. Block), ADDED to the card's own
   *  printed `shield` value. Cleared the same way as `stunned`. */
  shieldThisTurn: number;
  /** [Tank] granted "this turn" by a spell/ability (e.g. Block), on top of whatever the card's own
   *  printed `tank` flag says. Cleared the same way as `stunned`. */
  tankThisTurn: boolean;
}

export interface PlayerState {
  id: PlayerId;
  legendDefId: CardDefId;
  /** The legend's own instance (zone "legend") — exhausts/readies like any other permanent, so
   *  "exhaust me" legend abilities have somewhere to track that. */
  legendIid: InstanceId;
  /** Draw pile (top = index 0). */
  mainDeck: InstanceId[];
  /** Rune draw pile (top = index 0). */
  runeDeck: InstanceId[];
  hand: InstanceId[];
  /** Channeled runes in play (rune instances live in zone "runePool"); this preserves order. */
  runePool: InstanceId[];
  /** The Chosen Champion instance (zone "championZone"), or null if already played / none chosen. */
  championZone: InstanceId | null;
  /** Floated Energy in the rune pool (spent on energy costs; cleared at end of turn). */
  energy: number;
  /** Floated Power in the rune pool (spent on power costs; cleared at end of turn). */
  power: number;
  /** Floating colored runes (from Seals/legend "[Add]" abilities), spendable on colored-rune
   *  ability costs. Cleared at end of turn, same as energy/power. */
  floatingRunes: RuneColor[];
  /** [Legion] — true once you've played a card this turn (checked, then set, on each play). */
  playedCardThisTurn: boolean;
  /** Sun Disc: "The next unit you play this turn enters ready." Consumed by the next unit played
   *  (cleared either way — whether or not a unit gets played before the turn ends). */
  nextUnitEntersReady: boolean;
  points: number;
  hasTakenTurn: boolean;
  /** "Take a turn after this one" (e.g. Time Warp) — consumed one at a time by the "endTurn"
   *  action: while positive, ending your turn starts ANOTHER turn for you instead of your
   *  opponent's. A plain counter rather than a queue since nothing in the Set 1 corpus grants more
   *  than one extra turn at a time, but it stacks correctly if that ever changes. */
  extraTurns: number;
}

export interface Battlefield {
  index: number;
  defId: CardDefId;
  name: string;
  text: string;
  presentedBy: PlayerId;
  controller: PlayerId | null;
}

/**
 * An in-progress Showdown. Rule 337-345: it opens with an ACTION WINDOW (`windowOpen: true`) where
 * players may play `[Action]`/`[Reaction]` spells, alternating Focus, before any damage math
 * happens — only once both players pass in a row with nothing played (or neither had anything
 * legal to play in the first place, closing it instantly) does it become a normal damage-
 * assignment Showdown: both sides deal damage equal to their total Might, each side distributes it
 * among the OTHER side's units (lethal before wound). Collected one side at a time for UI purposes
 * but applied simultaneously (to pre-Showdown state).
 */
export interface Showdown {
  battlefield: number;
  attacker: PlayerId;
  /** Damage each side has left to assign. Meaningless (stays [0,0]) while `windowOpen`. */
  remaining: [number, number];
  /** damage assigned to each instance id (by the opposing side). */
  assigned: Record<number, number>;
  /** Which side is currently assigning (null while `windowOpen`, or once both are done). */
  toAssign: PlayerId | null;
  /** Whether the pre-combat Action Window (rule 340-345) is still open. */
  windowOpen: boolean;
  /** Who currently holds Focus (may play a spell or pass) while `windowOpen`. Starts as the player
   *  who applied Contested status (rule 341) — the attacker for a Combat-initiated Showdown. */
  focus: PlayerId;
  /** Consecutive passes with nothing played in between; reset to 0 by any spell played. The window
   *  closes once this reaches 2 (both players passed in a row) — rule 345. */
  passesInRow: number;
}

/** Pre-game mulligan: seat 0 decides first, then seat 1; null once both are done. */
export interface MulliganState {
  pending: PlayerId | null;
}

/**
 * An optional ("may") triggered ability awaiting a yes/no (and possibly a target) decision from
 * the player it triggered for — e.g. Volibear's "you may exhaust me to channel a rune". Modeled
 * the same way as `MulliganState`/`Showdown`: a small pending-decision sub-state that gates
 * `getLegalActions` to just the deciding player until it's resolved. `kind` is a registry key
 * looked up in `triggers.ts`'s optional-trigger table.
 *
 * `maxPicks`/`picked` support "up to N" multi-target abilities (e.g. Kinkou Monk's "buff up to
 * two other friendly units", Undercover Agent's "discard 2"): each `resolveTrigger` with a target
 * applies the effect to just that one target and appends it to `picked`; the trigger stays
 * pending (re-offering the remaining legal targets, minus anything already picked) until either
 * `picked.length` reaches `maxPicks` or the player declines. Ordinary single-target triggers just
 * use `maxPicks: 1`.
 */
export interface PendingTrigger {
  kind: string;
  sourceIid: InstanceId;
  player: PlayerId;
  maxPicks: number;
  picked: InstanceId[];
}

export interface GameState {
  rng: RngState;
  ply: number;
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  players: [PlayerState, PlayerState];
  battlefields: Battlefield[];
  instances: Record<number, CardInstance>;
  defs: Record<string, CardDef>;
  mulligan: MulliganState;
  /** Non-null while a Showdown needs damage assignment. */
  showdown: Showdown | null;
  /** Non-null while an optional ("may") triggered ability awaits its decision. */
  pendingTrigger: PendingTrigger | null;
  winner: PlayerId | "draw" | null;
  log: string[];
}

export function getInstance(state: GameState, iid: InstanceId): CardInstance {
  const inst = state.instances[iid as number];
  if (!inst) throw new Error(`Unknown instance ${iid}`);
  return inst;
}

export function unitsAt(
  state: GameState,
  battlefield: number,
  player: PlayerId,
): CardInstance[] {
  return Object.values(state.instances).filter(
    (i) =>
      i.zone === "battlefield" &&
      i.battlefield === battlefield &&
      i.controller === player &&
      state.defs[i.defId]!.type === "unit",
  );
}

/** Sum of "other friendly units have +N Might here" auras from every OTHER friendly unit in the
 *  same zone (same battlefield, or base) as `inst` — see `CardDef.auraMightBonus`. */
export function friendlyAuraBonus(state: GameState, inst: CardInstance): number {
  let bonus = 0;
  for (const other of Object.values(state.instances)) {
    if (other.iid === inst.iid) continue;
    if (other.controller !== inst.controller) continue;
    if (other.zone !== inst.zone) continue;
    if (inst.zone === "battlefield" && other.battlefield !== inst.battlefield) continue;
    bonus += state.defs[other.defId]!.auraMightBonus;
  }
  return bonus;
}

/**
 * A unit's Might in combat: base Might, plus [Buff] (+1, idempotent — see `CardInstance.buffed`
 * — plus `extraMightWhileBuffed` on top for a card like Wizened Elder), plus any "other friendly
 * units have +N Might here" auras, plus [Assault N] if `player` is the Showdown's attacker (the
 * side that moved in), plus [Shield N] if `player` is the defender. Outside of an active Showdown
 * (`attacker` omitted) the Assault/Shield keywords don't apply — pass `undefined` for plain display.
 */
export function effectiveMight(
  state: GameState,
  inst: CardInstance,
  attacker: PlayerId | undefined,
): number {
  const def = state.defs[inst.defId]!;
  const buffBonus = inst.buffed ? 1 + def.extraMightWhileBuffed : 0;
  const base = Math.max(1, def.might + buffBonus + inst.tempMightDelta + friendlyAuraBonus(state, inst));
  if (attacker === undefined) return base;
  return base + (inst.controller === attacker ? def.assault + inst.assaultThisTurn : def.shield + inst.shieldThisTurn);
}

/** Whether a unit can move battlefield-to-battlefield directly: its own printed [Ganking], a
 *  "this turn" grant from an ability (e.g. Miss Fortune's legend ability), or a conditional grant
 *  while buffed (e.g. Bilgewater Bully). */
export function hasGanking(state: GameState, inst: CardInstance): boolean {
  const def = state.defs[inst.defId]!;
  return def.ganking || inst.gankingThisTurn || (def.gankingWhileBuffed && inst.buffed);
}

/** [Tank] — must be assigned combat damage before any non-Tank unit at the same battlefield.
 *  Either printed on the card, or granted "this turn" by a spell/ability (e.g. Block). */
export function hasTank(state: GameState, inst: CardInstance): boolean {
  return state.defs[inst.defId]!.tank || inst.tankThisTurn;
}

/** Stunned units don't deal combat damage this turn — they contribute 0 to their side's total. */
export function dealsDamage(inst: CardInstance): boolean {
  return !inst.stunned;
}

/**
 * [Deflect N] — whether `player` (an ability/trigger's acting side) can legally choose `target` as
 * a target: always true for a friendly target or a Deflect-free enemy one; for a Deflect N enemy
 * target, `player` must have N floating rainbow runes available. Doesn't spend anything — pure
 * legality check, paired with `payDeflect` below at resolution time.
 */
export function canChooseThroughDeflect(state: GameState, player: PlayerId, target: CardInstance): boolean {
  if (target.controller === player) return true;
  const n = state.defs[target.defId]!.deflect;
  if (n === 0) return true;
  return state.players[player].floatingRunes.filter((r) => r === "rainbow").length >= n;
}

/** Spends the floating rainbow runes a Deflect N target costs to choose (no-op if not applicable). */
export function payDeflect(state: GameState, player: PlayerId, target: CardInstance): void {
  if (target.controller === player) return;
  const n = state.defs[target.defId]!.deflect;
  for (let i = 0; i < n; i++) {
    const idx = state.players[player].floatingRunes.indexOf("rainbow");
    if (idx !== -1) state.players[player].floatingRunes.splice(idx, 1);
  }
}

export function totalMightAt(
  state: GameState,
  battlefield: number,
  player: PlayerId,
  attacker?: PlayerId,
): number {
  return unitsAt(state, battlefield, player)
    .filter(dealsDamage)
    .reduce((sum, i) => sum + effectiveMight(state, i, attacker), 0);
}

/** A unit is Mighty while it has 5+ Might (base + Buff; Assault/Shield don't count — they only
 *  apply while attacking/defending, whereas Mighty is a plain, always-checkable property). */
export function isMighty(state: GameState, inst: CardInstance): boolean {
  return effectiveMight(state, inst, undefined) >= 5;
}

/** Give a unit a Buff. Idempotent — a unit that already has one gets no additional effect. */
export function giveBuff(inst: CardInstance): void {
  inst.buffed = true;
}

/** Spend a unit's Buff (consuming it for an additional effect). Returns whether it had one. */
export function spendBuff(inst: CardInstance): boolean {
  const had = inst.buffed;
  inst.buffed = false;
  return had;
}

/** Whether the player has a floating rune usable to pay a cost of the given color ("rainbow" as
 *  the required color = any one floating rune accepted, the common "any color" cost convention;
 *  a floating "rainbow" rune, e.g. from Kai'Sa, is itself a wildcard that satisfies any color). */
export function hasFloatingRune(state: GameState, player: PlayerId, required: RuneColor): boolean {
  const runes = state.players[player].floatingRunes;
  if (required === "rainbow") return runes.length > 0;
  return runes.some((r) => r === required || r === "rainbow");
}

/** Spends one floating rune toward a cost of the given color (prefers an exact-color match,
 *  falling back to a wildcard "rainbow" rune; a "rainbow" cost itself just spends any one). */
export function spendFloatingRune(state: GameState, player: PlayerId, required: RuneColor): void {
  const runes = state.players[player].floatingRunes;
  let idx = required === "rainbow" ? -1 : runes.findIndex((r) => r === required);
  if (idx === -1) idx = runes.findIndex((r) => r === "rainbow");
  if (idx === -1 && required === "rainbow") idx = 0;
  if (idx !== -1) runes.splice(idx, 1);
}

/** Ready rune instances a player can still exhaust for energy. */
export function readyRunes(state: GameState, player: PlayerId): CardInstance[] {
  return state.players[player].runePool
    .map((iid) => state.instances[iid as number]!)
    .filter((r) => !r.exhausted);
}
