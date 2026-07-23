/**
 * Trigger-hook dispatch — deterministic, immediate, no stack/priority. Each hook here is called
 * from exactly one concrete existing engine event (see actions.ts/showdown.ts/setup.ts): playing
 * a card, a unit arriving at a battlefield, conquering a battlefield, a unit dying, the start of a
 * Beginning Phase, the end of a turn, and a unit being stunned. There's no queue and no
 * interleaving — multiple simultaneous automatic triggers just resolve in a fixed order (the
 * acting player's own board, iteration order), and at most one "needs a real decision" trigger can
 * be pending at a time (a second one in the same event is dropped this pass — a known, accepted
 * limitation given how rarely two choice-needing triggers can coincide in the small curated set
 * implemented here).
 *
 * "May" triggers and "mandatory but must choose among 2+ targets" triggers both use the same
 * `GameState.pendingTrigger` sub-state (gates `getLegalActions` to just the deciding player, same
 * shape as `mulligan`/`showdown`). Anything with 0 or 1 legal targets (or no target at all) that
 * ISN'T optional auto-resolves immediately — "skip when forced," same philosophy already used in
 * showdown.ts.
 */
import { opponentOf, type InstanceId, type PlayerId } from "@riftbound/shared";
import { drawFromMain, recycleTopOfMainDeck } from "./deck.js";
import { createToken, RECRUIT_TOKEN } from "./tokens.js";
import {
  canChooseThroughDeflect,
  effectiveMight,
  getInstance,
  giveBuff,
  hasFloatingRune,
  isMighty,
  payDeflect,
  spendBuff,
  spendFloatingRune,
  type CardDef,
  type CardInstance,
  type GameState,
} from "./state.js";

export interface TriggerEffect {
  mandatory: boolean;
  /** "Up to N" multi-target abilities (e.g. Kinkou Monk's "buff up to two", Undercover Agent's
   *  "discard 2") — default 1. Each accepted pick calls `resolve` once and stays pending (offering
   *  the remaining legal targets minus anything already picked) until N picks or a decline. Not
   *  used by `legalBattlefields` triggers, which only ever offer a single one-shot pick. */
  maxPicks?: number;
  /** By default, a target already picked this sequence is excluded from the next pick (right for
   *  "buff up to two OTHER units" or "discard 2" — you wouldn't re-pick the same one). A handful of
   *  cards are N truly INDEPENDENT instructions instead (Falling Star's "Deal 3 to a unit. Deal 3
   *  to a unit.", Icathian Rain's six "Deal 2 to a unit"s) where the SAME unit may legally be
   *  targeted again by a later instruction. Set true to allow that. */
  allowRepeatTargets?: boolean;
  condition?: (state: GameState, player: PlayerId, sourceIid: InstanceId, ctx: unknown) => boolean;
  legalTargets?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => InstanceId[];
  /** For effects that target a BATTLEFIELD rather than a game object (e.g. "deal 3 to all enemy
   *  units at a battlefield") — mutually exclusive with `legalTargets`. Always a single, immediate
   *  pick (no multi-pick concept; no Set 1 card needs to choose more than one battlefield). */
  legalBattlefields?: (state: GameState, player: PlayerId, sourceIid: InstanceId) => number[];
  resolve: (
    state: GameState,
    player: PlayerId,
    sourceIid: InstanceId,
    targetIid?: InstanceId,
    battlefield?: number,
  ) => void;
  /** For "do X per pick, THEN do Y once" abilities (e.g. Undercover Agent's "discard 2, then draw
   *  2") — called exactly once when the pick sequence ends (maxPicks reached, declined, or no more
   *  legal targets), including the 0/1-target auto-resolve path. `picked` is however many targets
   *  were actually picked (may be fewer than `maxPicks` if there weren't enough legal ones). */
  onComplete?: (state: GameState, player: PlayerId, sourceIid: InstanceId, picked: InstanceId[]) => void;
}

/** Every registered trigger, keyed by the same `kind` string used in `pendingTrigger.kind` — one
 *  merged table so `resolvePendingTrigger` (and `getLegalActions`, to enumerate target choices)
 *  can look any of them back up after a decision. Exported so other registries (e.g. `spells.ts`)
 *  can feed the same shared table/pending-decision machinery instead of inventing a second one. */
export const ALL_TRIGGERS: Record<string, TriggerEffect> = {};
export function register(kind: string, spec: TriggerEffect): string {
  ALL_TRIGGERS[kind] = spec;
  return kind;
}

/** Exported so other registries (`spells.ts`) can chain a SECOND trigger from within an `onComplete`
 *  callback — e.g. a "each player does X, starting with the next player" spell fires one player's
 *  decision, then its `onComplete` fires the other's via this same function. */
export function fireTrigger(
  state: GameState,
  kind: string,
  player: PlayerId,
  sourceIid: InstanceId,
  ctx: unknown,
): void {
  if (state.pendingTrigger) return; // one pending decision at a time (see file header)
  const spec = ALL_TRIGGERS[kind]!;
  if (spec.condition && !spec.condition(state, player, sourceIid, ctx)) return;

  if (spec.legalBattlefields) {
    const bfs = spec.legalBattlefields(state, player, sourceIid);
    if (bfs.length === 0) {
      if (spec.mandatory) spec.onComplete?.(state, player, sourceIid, []);
      return;
    }
    if (spec.mandatory && bfs.length === 1) {
      spec.resolve(state, player, sourceIid, undefined, bfs[0]);
      spec.onComplete?.(state, player, sourceIid, []);
      return;
    }
    state.pendingTrigger = { kind, sourceIid, player, maxPicks: 1, picked: [] };
    return;
  }

  const targets = spec.legalTargets ? spec.legalTargets(state, player, sourceIid) : null;

  if (targets !== null && targets.length === 0) {
    // Nothing to target -- most triggers just no-op, but a mandatory "X, then Y" effect (e.g.
    // Undercover Agent's "discard 2, then draw 2") still needs its "then Y" half to happen even
    // when there was nothing to discard.
    if (spec.mandatory) spec.onComplete?.(state, player, sourceIid, []);
    return;
  }
  if (spec.mandatory && (targets === null || targets.length <= 1)) {
    spec.resolve(state, player, sourceIid, targets?.[0]);
    spec.onComplete?.(state, player, sourceIid, targets ?? []);
    return;
  }
  state.pendingTrigger = { kind, sourceIid, player, maxPicks: spec.maxPicks ?? 1, picked: [] };
}

export function resolvePendingTrigger(
  state: GameState,
  accept: boolean,
  targetIid?: InstanceId,
  battlefield?: number,
): void {
  const pending = state.pendingTrigger;
  if (!pending) throw new Error("resolvePendingTrigger: nothing pending");
  const spec = ALL_TRIGGERS[pending.kind]!;
  if (!accept) {
    state.pendingTrigger = null;
    spec.onComplete?.(state, pending.player, pending.sourceIid, pending.picked);
    return;
  }

  if (spec.legalBattlefields) {
    const legalBfs = spec.legalBattlefields(state, pending.player, pending.sourceIid);
    if (battlefield === undefined || !legalBfs.includes(battlefield)) {
      throw new Error("resolvePendingTrigger: invalid battlefield");
    }
    state.pendingTrigger = null;
    spec.resolve(state, pending.player, pending.sourceIid, undefined, battlefield);
    spec.onComplete?.(state, pending.player, pending.sourceIid, []);
    return;
  }

  let legal: InstanceId[] = [];
  if (spec.legalTargets) {
    legal = spec.legalTargets(state, pending.player, pending.sourceIid);
    if (!spec.allowRepeatTargets) legal = legal.filter((t) => !pending.picked.includes(t));
    if (targetIid === undefined || !legal.includes(targetIid)) {
      throw new Error("resolvePendingTrigger: invalid target");
    }
  }
  // Clear BEFORE calling resolve() -- resolve() may itself fire another trigger (e.g. Solari
  // Shieldbearer's stun -> Leona's onStun reaction), which `fireTrigger`'s "one pending decision
  // at a time" guard would otherwise block if this one were still considered "pending."
  state.pendingTrigger = null;
  spec.resolve(state, pending.player, pending.sourceIid, targetIid);
  if (!spec.legalTargets) return; // plain yes/no trigger, no multi-pick concept

  // If resolve() itself opened a NEW pending decision (a chained trigger), let that run first --
  // don't clobber it by re-opening this "up to N" prompt underneath it (and defer onComplete,
  // since the sequence isn't really done from the player's point of view until that resolves too).
  if (state.pendingTrigger !== null) return;

  const picked = [...pending.picked, targetIid!];
  let stillLegal = spec.legalTargets(state, pending.player, pending.sourceIid);
  if (!spec.allowRepeatTargets) stillLegal = stillLegal.filter((t) => !picked.includes(t));
  if (picked.length < pending.maxPicks && stillLegal.length > 0) {
    state.pendingTrigger = { ...pending, picked };
  } else {
    spec.onComplete?.(state, pending.player, pending.sourceIid, picked);
  }
}

function legendDef(state: GameState, player: PlayerId): CardDef {
  const legendIid = state.players[player].legendIid;
  return state.defs[getInstance(state, legendIid).defId]!;
}

/** Channels the top `count` runes from the rune deck straight into the pool, already exhausted
 *  (i.e. "channel N runes exhausted") — used by Volibear's legend ability, Tasty Faefolk, Soaring
 *  Scout, and (exported) the Mobilize/Catalyst of Aeons spells. Stops early if the rune deck runs
 *  out; returns how many were actually channeled. */
export function channelRunesExhausted(state: GameState, player: PlayerId, count: number): number {
  const p = state.players[player];
  let channeled = 0;
  for (let i = 0; i < count; i++) {
    const top = p.runeDeck.shift();
    if (top === undefined) break;
    const rune = getInstance(state, top);
    rune.zone = "runePool";
    rune.exhausted = true;
    p.runePool.push(top);
    channeled++;
  }
  return channeled;
}

/**
 * Applies flat damage to every unit at a battlefield (both sides) and resolves any resulting
 * deaths (lethal check only — no assignment choice, since it's a uniform amount to everyone, not
 * a Might-based split). Used by Kog'Maw's Deathknell. Snapshots the victim list up front so
 * removing a unit mid-loop can't skip/duplicate anyone.
 */
function dealDamageToUnitsAt(state: GameState, battlefield: number, amount: number): void {
  const victims = Object.values(state.instances).filter(
    (i) => i.zone === "battlefield" && i.battlefield === battlefield && state.defs[i.defId]!.type === "unit",
  );
  for (const v of victims) v.damage += amount;
  for (const v of victims) {
    if (v.zone === "battlefield" && v.damage >= effectiveMight(state, v, undefined)) {
      v.zone = "trash";
      v.battlefield = null;
      v.damage = 0;
      state.log.push(`P${v.controller} loses ${state.defs[v.defId]!.name}`);
      onUnitDeath(state, v);
      onKillStunnedEnemy(state, v);
      onUnitDeathAtBattlefield(state, v, battlefield);
    }
  }
}

function friendlyUnits(state: GameState, player: PlayerId, exclude?: InstanceId) {
  return Object.values(state.instances)
    .filter(
      (i) =>
        i.controller === player &&
        (i.zone === "base" || i.zone === "battlefield") &&
        state.defs[i.defId]!.type === "unit" &&
        i.iid !== exclude,
    )
    .map((i) => i.iid);
}

/** Creates a Recruit token wherever `sourceIid` itself currently is (its base or battlefield). */
function createRecruitHere(state: GameState, player: PlayerId, sourceIid: InstanceId, count = 1): void {
  const src = getInstance(state, sourceIid);
  for (let i = 0; i < count; i++) {
    createToken(state, player, RECRUIT_TOKEN, src.zone === "battlefield" ? "battlefield" : "base", src.battlefield);
  }
}

// ---------------------------------------------------------------------------------------------
// Legend abilities (16 total) — activated ones live in abilities.ts; these are the triggered +
// passive ones. Master Yi - Wuju Bladesman (Starter)'s passive lone-defender bonus is handled in
// showdown.ts's `mightIn`, not here (it's pure combat math, not an event).
// ---------------------------------------------------------------------------------------------

interface OnPlayCtx {
  playedIid: InstanceId;
  playedDef: CardDef;
}

const KAI_SA = "ogn-247-298";
const VOLIBEAR = "ogn-249-298";
const JINX = "ogn-251-298";
const DARIUS = "ogn-253-298";
const AHRI = "ogn-255-298";
const LEE_SIN_LEGEND = "ogn-257-298";
const YASUO = "ogn-259-298";
const LEONA = "ogn-261-298";
const TEEMO = "ogn-263-298";
const VIKTOR_LEGEND = "ogn-265-298";
const MISS_FORTUNE = "ogn-267-298";
const SETT = "ogn-269-298";
const ANNIE_STARTER = "ogs-017-024";
const MASTER_YI_STARTER = "ogs-019-024";
const LUX_STARTER = "ogs-021-024";
const GAREN_STARTER = "ogs-023-024";
void KAI_SA, DARIUS, LEE_SIN_LEGEND, YASUO, TEEMO, VIKTOR_LEGEND, MISS_FORTUNE; // activated — implemented in abilities.ts, documented here for the "all 16" inventory

/** Master Yi - Wuju Bladesman (Starter)'s passive: while a friendly unit defends alone, it gets
 *  +2 Might. Pure combat math (no event), called directly from showdown.ts's `mightIn`. */
export function legendDefenderMightBonus(
  state: GameState,
  inst: CardInstance,
  battlefield: number,
  isDefender: boolean,
): number {
  if (!isDefender) return 0;
  if (legendDef(state, inst.controller).id !== MASTER_YI_STARTER) return 0;
  const defenderCount = Object.values(state.instances).filter(
    (i) => i.zone === "battlefield" && i.battlefield === battlefield && i.controller === inst.controller && state.defs[i.defId]!.type === "unit",
  ).length;
  return defenderCount === 1 ? 2 : 0;
}

const ON_PLAY_LEGEND: Record<string, string> = {
  // Volibear - Relentless Storm: when you play a Mighty unit, you may exhaust me to channel 1
  // rune exhausted (i.e. straight into the pool, already spent-for-the-turn).
  [VOLIBEAR]: register(`onPlayLegend:${VOLIBEAR}`, {
    mandatory: false,
    condition: (state, _player, _source, ctx) => {
      const played = ctx as OnPlayCtx;
      return played.playedDef.type === "unit" && isMighty(state, getInstance(state, played.playedIid));
    },
    resolve: (state, player, sourceIid) => {
      getInstance(state, sourceIid).exhausted = true;
      if (channelRunesExhausted(state, player, 1) > 0) {
        state.log.push(`P${player} channels a rune exhausted (Volibear)`);
      }
    },
  }),
  // Lux - Lady of Luminosity (Starter): when you play a spell costing 5+ Energy, draw 1.
  [LUX_STARTER]: register(`onPlayLegend:${LUX_STARTER}`, {
    mandatory: true,
    condition: (_state, _player, _source, ctx) => {
      const def = (ctx as OnPlayCtx).playedDef;
      return def.type === "spell" && def.energy >= 5;
    },
    resolve: (state, player) => {
      drawFromMain(state, player);
      state.log.push(`P${player} draws 1 (Lux)`);
    },
  }),
};

const ON_BEGINNING_LEGEND: Record<string, string> = {
  // Jinx - Loose Cannon: at the start of your Beginning Phase, draw 1 if you have <=1 in hand.
  [JINX]: register(`onBeginning:${JINX}`, {
    mandatory: true,
    condition: (state, player) => state.players[player].hand.length <= 1,
    resolve: (state, player) => {
      drawFromMain(state, player);
      state.log.push(`P${player} draws 1 (Jinx)`);
    },
  }),
};

const ON_END_TURN_LEGEND: Record<string, string> = {
  // Annie - Dark Child (Starter): at the end of your turn, ready 2 runes.
  [ANNIE_STARTER]: register(`onEndTurn:${ANNIE_STARTER}`, {
    mandatory: true,
    resolve: (state, player) => {
      const runes = state.players[player].runePool
        .map((iid) => getInstance(state, iid))
        .filter((r) => r.exhausted);
      for (const r of runes.slice(0, 2)) r.exhausted = false;
      if (runes.length > 0) state.log.push(`P${player} readies ${Math.min(2, runes.length)} rune(s) (Annie)`);
    },
  }),
};

interface OnConquerCtx {
  battlefield: number;
}

const ON_CONQUER_LEGEND: Record<string, string> = {
  // Sett - The Boss (conquer half; see ON_DEATH_LEGEND below for the death-replacement half):
  // when you conquer, ready me.
  [SETT]: register(`onConquer:${SETT}`, {
    mandatory: true,
    resolve: (state, _player, sourceIid) => {
      getInstance(state, sourceIid).exhausted = false;
    },
  }),
  // Garen - Might of Demacia (Starter): when you conquer, if you have 4+ units at that
  // battlefield, draw 2.
  [GAREN_STARTER]: register(`onConquer:${GAREN_STARTER}`, {
    mandatory: true,
    condition: (state, player, _source, ctx) => {
      const bf = (ctx as OnConquerCtx).battlefield;
      const count = Object.values(state.instances).filter(
        (i) => i.zone === "battlefield" && i.battlefield === bf && i.controller === player && state.defs[i.defId]!.type === "unit",
      ).length;
      return count >= 4;
    },
    resolve: (state, player) => {
      drawFromMain(state, player);
      drawFromMain(state, player);
      state.log.push(`P${player} draws 2 (Garen)`);
    },
  }),
};

/**
 * Sett - The Boss's death-replacement half: "When a buffed unit you control would die, you may
 * pay a rainbow rune and exhaust me to spend its buff and recall it exhausted instead." Modeled as
 * an immediate POST-death recall rather than a strict pre-death replacement — a true replacement
 * effect would need Showdown resolution to pause mid-death-loop for a decision, a meaningfully
 * bigger structural change than every other trigger here (which all fire at a clean, already-
 * resolved hook point). The end state is identical either way: the unit ends up at base,
 * exhausted, its buff spent, and Sett exhausted — so the shortcut costs nothing observable.
 *
 * Keyed unusually: `sourceIid` here is the DYING unit itself (not Sett's legend iid, which is
 * instead looked up via `state.players[player].legendIid` inside `resolve`) — `onUnitDeath` passes
 * the dying instance directly, since `PendingTrigger` has no room for extra context and this is
 * the one case that needs to remember which trashed unit to bring back.
 */
const ON_DEATH_LEGEND: Record<string, string> = {
  [SETT]: register(`onDeathLegend:${SETT}`, {
    mandatory: false, // "you may" -- always a real decision when it's affordable at all
    condition: (state, player, sourceIid) => {
      const dying = getInstance(state, sourceIid);
      const legend = getInstance(state, state.players[player].legendIid);
      return dying.buffed && !legend.exhausted && hasFloatingRune(state, player, "rainbow");
    },
    resolve: (state, player, sourceIid) => {
      const dying = getInstance(state, sourceIid);
      spendBuff(dying);
      dying.zone = "base";
      dying.battlefield = null;
      dying.exhausted = true;
      spendFloatingRune(state, player, "rainbow");
      getInstance(state, state.players[player].legendIid).exhausted = true;
      state.log.push(`P${player} recalls ${state.defs[dying.defId]!.name} instead of losing it (Sett)`);
    },
  }),
};

const ON_STUN_LEGEND: Record<string, string> = {
  // Leona - Radiant Dawn: when you stun one or more enemy units, buff a friendly unit.
  [LEONA]: register(`onStun:${LEONA}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  }),
};

/** Ahri - Nine-Tailed Fox: when an enemy unit attacks a battlefield you control, give it -1 Might
 *  this turn (min 1). Called directly from `startShowdown`, before totals are computed — at that
 *  point `battlefields[bf].controller` still reflects who held it BEFORE this arrival (control is
 *  only recomputed once the Showdown resolves), so "the defender already controlled it" is just
 *  the current controller field. */
export function onAttackDeclared(state: GameState, battlefield: number, attacker: PlayerId): void {
  const defender = opponentOf(attacker);
  if (state.battlefields[battlefield]!.controller !== defender) return;
  if (legendDef(state, defender).id !== AHRI) return;
  for (const inst of Object.values(state.instances)) {
    if (inst.zone === "battlefield" && inst.battlefield === battlefield && inst.controller === attacker) {
      inst.tempMightDelta -= 1;
      state.log.push(`${state.defs[inst.defId]!.name} gets -1 Might this turn (Ahri)`);
    }
  }
}

export function onPlayCard(state: GameState, player: PlayerId, playedInst: CardInstance): void {
  const ctx: OnPlayCtx = { playedIid: playedInst.iid, playedDef: state.defs[playedInst.defId]! };

  for (const inst of Object.values(state.instances)) {
    if (state.pendingTrigger) return;
    if (inst.controller !== player) continue;
    if (inst.zone !== "base" && inst.zone !== "battlefield") continue;
    const kind = ON_PLAY_SELF_KIND[inst.defId];
    if (kind) fireTrigger(state, kind, player, inst.iid, ctx);
  }

  // Gemcraft Seer: "Other friendly units have [Vision]" -- a static grant, not tied to any one
  // card's own on-play ability, so it stacks with whatever the played unit already does above.
  if (!state.pendingTrigger && ctx.playedDef.type === "unit" && playedInst.defId !== GEMCRAFT_SEER) {
    const hasGranter = Object.values(state.instances).some(
      (i) => i.controller === player && (i.zone === "base" || i.zone === "battlefield") && VISION_GRANTERS.has(i.defId),
    );
    if (hasGranter) fireTrigger(state, GRANTED_VISION_KIND, player, playedInst.iid, ctx);
  }

  if (state.pendingTrigger) return;
  const kind = ON_PLAY_LEGEND[legendDef(state, player).id];
  if (kind) fireTrigger(state, kind, player, state.players[player].legendIid, ctx);
}

export function onArrival(state: GameState, battlefield: number, inst: CardInstance): void {
  const kind = ON_ARRIVAL_KIND[inst.defId];
  if (kind) fireTrigger(state, kind, inst.controller, inst.iid, { battlefield });
}

const SUPER_MEGA_DEATH_ROCKET = "ogn-252-298";

/** Triggered abilities that live on a card WHILE IT SITS IN THE TRASH (rule 378: legal, since the
 *  Trash is Public Information) — keyed by defId, checked against the conquering player's own
 *  trash in `onConquer` below. Only Super Mega Death Rocket needs this so far; if a player somehow
 *  has more than one copy in their trash at once, only the first found gets offered per conquer
 *  event (the usual "one pending decision at a time" simplification). */
const ON_CONQUER_FROM_TRASH: Record<string, string> = {
  [SUPER_MEGA_DEATH_ROCKET]: register(`onConquerFromTrash:${SUPER_MEGA_DEATH_ROCKET}`, {
    mandatory: false, // "you may discard 1..."
    legalTargets: (state, player) => state.players[player].hand,
    resolve: (state, player, sourceIid, targetIid) => {
      if (targetIid === undefined) return;
      const discarded = getInstance(state, targetIid);
      state.players[player].hand = state.players[player].hand.filter((h) => h !== targetIid);
      discarded.zone = "trash";
      const card = getInstance(state, sourceIid);
      card.zone = "hand";
      state.players[player].hand.push(sourceIid);
      state.log.push(
        `P${player} discards ${state.defs[discarded.defId]!.name} to return ${state.defs[card.defId]!.name} to hand`,
      );
    },
  }),
};

export function onConquer(state: GameState, battlefield: number, player: PlayerId): void {
  const kind = ON_CONQUER_LEGEND[legendDef(state, player).id];
  if (kind) fireTrigger(state, kind, player, state.players[player].legendIid, { battlefield } satisfies OnConquerCtx);

  if (state.pendingTrigger) return;
  for (const inst of Object.values(state.instances)) {
    if (state.pendingTrigger) break;
    if (inst.owner !== player || inst.zone !== "trash") continue;
    const trashKind = ON_CONQUER_FROM_TRASH[inst.defId];
    if (trashKind) fireTrigger(state, trashKind, player, inst.iid, undefined);
  }
}

export function onUnitDeath(state: GameState, inst: CardInstance): void {
  const kind = ON_DEATH_KIND[inst.defId];
  if (kind) {
    fireTrigger(state, kind, inst.controller, inst.iid, undefined);
    // Karthus - Eternal: "Your [Deathknell] effects trigger an additional time." Only for the
    // simple, fully-automatic Deathknells (no pendingTrigger left open) -- correctly doubling a
    // multi-pick sequence (e.g. Undercover Agent's) would need real bookkeeping this pass didn't
    // build, so that case is left as a known, narrow gap rather than risking a double-fire bug.
    if (!state.pendingTrigger && hasKarthusEternal(state, inst.controller)) {
      fireTrigger(state, kind, inst.controller, inst.iid, undefined);
    }
  }

  if (state.pendingTrigger) return;
  const legendKind = ON_DEATH_LEGEND[legendDef(state, inst.controller).id];
  // `sourceIid` is deliberately the dying unit itself here, not the legend -- see the comment on
  // ON_DEATH_LEGEND above.
  if (legendKind) fireTrigger(state, legendKind, inst.controller, inst.iid, undefined);
}

const KARTHUS_ETERNAL = "ogn-236-298";
function hasKarthusEternal(state: GameState, player: PlayerId): boolean {
  return Object.values(state.instances).some(
    (i) => i.controller === player && (i.zone === "base" || i.zone === "battlefield") && i.defId === KARTHUS_ETERNAL,
  );
}

export function onBeginningPhase(state: GameState, player: PlayerId): void {
  const kind = ON_BEGINNING_LEGEND[legendDef(state, player).id];
  if (kind) fireTrigger(state, kind, player, state.players[player].legendIid, undefined);
}

export function onEndTurn(state: GameState, player: PlayerId): void {
  const kind = ON_END_TURN_LEGEND[legendDef(state, player).id];
  if (kind) fireTrigger(state, kind, player, state.players[player].legendIid, undefined);
}

export function applyStun(state: GameState, targetIid: InstanceId, byPlayer: PlayerId): void {
  const inst = state.instances[targetIid as number];
  if (!inst || inst.stunned) return;
  inst.stunned = true;
  state.log.push(`${state.defs[inst.defId]!.name} is stunned`);

  for (const own of Object.values(state.instances)) {
    if (state.pendingTrigger) break;
    if (own.controller !== byPlayer) continue;
    if (own.zone !== "base" && own.zone !== "battlefield") continue;
    const kind = ON_STUN_SELF[own.defId];
    if (kind) fireTrigger(state, kind, byPlayer, own.iid, undefined);
  }

  if (!state.pendingTrigger) {
    const kind = ON_STUN_LEGEND[legendDef(state, byPlayer).id];
    if (kind) fireTrigger(state, kind, byPlayer, state.players[byPlayer].legendIid, undefined);
  }
}

/** Solari Shrine (and future similar cards): when you kill a stunned enemy unit, react. Called
 *  from showdown.ts's death loop alongside `onUnitDeath`, for the side that WASN'T the dying
 *  unit's controller (i.e. whoever's Showdown dealt the killing blow). */
export function onKillStunnedEnemy(state: GameState, dyingInst: CardInstance): void {
  if (!dyingInst.stunned) return;
  const killer = opponentOf(dyingInst.controller);
  for (const own of Object.values(state.instances)) {
    if (state.pendingTrigger) break;
    if (own.controller !== killer) continue;
    if (own.zone !== "base" && own.zone !== "battlefield") continue;
    const kind = ON_KILL_STUNNED_ENEMY_SELF[own.defId];
    if (kind) fireTrigger(state, kind, killer, own.iid, undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Phase 5 — the two starter decks' own promised mechanics (Lee Sin's buff archetype, Viktor's
// token archetype), plus [Deathknell]/[Vision]/a Stun granter as small self-contained clusters.
// Curated: not every card mentioning these keywords is implemented, see the plan for the list.
// ---------------------------------------------------------------------------------------------

const PIT_ROOKIE = "ogn-136-298";
const CITHRIA = "ogn-139-298";
const SPIRITS_REFUGE = "ogn-063-298";
const WILDCLAW_SHAMAN = "ogn-147-298";
const DANGEROUS_DUO = "ogn-016-298";
const SCRAPYARD_CHAMPION = "ogn-020-298";
const TRIFARIAN_GLORYSEEKER = "ogn-217-298";
const DARIUS_EXECUTIONER = "ogn-243-298";
const VANGUARD_CAPTAIN = "ogn-218-298";
const FAITHFUL_MANUFACTOR = "ogn-211-298";
const FORGE_OF_THE_FUTURE = "ogn-212-298";
const NOXIAN_DRUMMER = "ogn-222-298";
const MACHINE_EVANGEL = "ogn-239-298";
const WATCHFUL_SENTRY = "ogn-096-298";
const SOLARI_SHIELDBEARER = "ogn-051-298";
const JEWELED_COLOSSUS = "ogn-086-298";
const GEMCRAFT_SEER = "ogn-100-298";
const MYSTIC_PORO = "ogn-171-298";
const SAI_SCOUT = "ogn-174-298";
const KINKOU_MONK = "ogn-141-298";
const UNDERCOVER_AGENT = "ogn-178-298";
const ECLIPSE_HERALD = "ogn-059-298";
const SOLARI_SHRINE = "ogn-072-298";
const TASTY_FAEFOLK = "ogn-075-298";
const SOARING_SCOUT = "ogn-216-298";
const EKKO_RECURRENT = "ogn-110-298";
const KOG_MAW = "ogn-190-298";
const KARMA = "ogn-235-298";
/** A generic "granted Vision" kind (Gemcraft Seer: "other friendly units have [Vision]"), distinct
 *  from any specific card's own [Vision] kind — see the grant check in `onPlayCard`. */
const GRANTED_VISION_KIND = register("grantedVision", visionAbility());

function visionAbility(): TriggerEffect {
  return {
    mandatory: false, // "may recycle" — always a real decision, never auto-skipped
    resolve: (state, player) => {
      recycleTopOfMainDeck(state, player);
      onRecycle(state, player);
    },
  };
}

/** Karma - Channeler (and future similar cards): when you recycle one or more cards, buff a
 *  friendly unit. ("Runes aren't cards" — rune recycling for Power doesn't trigger this, only
 *  actual card-recycling like [Vision]'s "may recycle it.") */
export function onRecycle(state: GameState, player: PlayerId): void {
  for (const own of Object.values(state.instances)) {
    if (state.pendingTrigger) break;
    if (own.controller !== player) continue;
    if (own.zone !== "base" && own.zone !== "battlefield") continue;
    const kind = ON_RECYCLE_SELF[own.defId];
    if (kind) fireTrigger(state, kind, player, own.iid, undefined);
  }
}

const ON_RECYCLE_SELF: Record<string, string> = {
  [KARMA]: register(`onRecycleSelf:${KARMA}`, {
    mandatory: true,
    legalTargets: (state, player) => friendlyUnits(state, player),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  }),
};

const ON_PLAY_SELF_KIND: Record<string, string> = {
  // Pit Rookie: when you play me, buff another friendly unit.
  [PIT_ROOKIE]: register(`onPlaySelf:${PIT_ROOKIE}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    legalTargets: (state, player, sourceIid) => friendlyUnits(state, player, sourceIid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  }),
  // Cithria of Cloudfield: when you play ANOTHER unit, buff me.
  [CITHRIA]: register(`onPlaySelf:${CITHRIA}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => {
      const played = ctx as OnPlayCtx;
      return played.playedIid !== sourceIid && played.playedDef.type === "unit";
    },
    resolve: (state, _player, sourceIid) => giveBuff(getInstance(state, sourceIid)),
  }),
  // Spirit's Refuge (gear): when you play this, buff a friendly unit.
  [SPIRITS_REFUGE]: register(`onPlaySelf:${SPIRITS_REFUGE}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    legalTargets: (state, player) => friendlyUnits(state, player),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  }),
  // Wildclaw Shaman: when you play me, you may spend a friendly unit's buff to buff AND ready me.
  // The spent buff and the effect's own target are different things: the chosen target's buff
  // pays the cost, Wildclaw Shaman himself gets the effect.
  [WILDCLAW_SHAMAN]: register(`onPlaySelf:${WILDCLAW_SHAMAN}`, {
    mandatory: false, // "you may" -- always a real decision when there's a legal buff to spend
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    legalTargets: (state, player) => friendlyUnits(state, player).filter((iid) => getInstance(state, iid).buffed),
    resolve: (state, _player, sourceIid, targetIid) => {
      if (targetIid === undefined) return;
      spendBuff(getInstance(state, targetIid));
      const self = getInstance(state, sourceIid);
      giveBuff(self);
      self.exhausted = false;
    },
  }),
  // Vanguard Captain: [Legion] -- when you play me, play two 1-Might Recruit tokens here.
  [VANGUARD_CAPTAIN]: register(`onPlaySelf:${VANGUARD_CAPTAIN}`, {
    mandatory: true,
    condition: (state, player, sourceIid, ctx) =>
      (ctx as OnPlayCtx).playedIid === sourceIid && state.players[player].playedCardThisTurn,
    resolve: (state, player, sourceIid) => createRecruitHere(state, player, sourceIid, 2),
  }),
  // Dangerous Duo: [Legion] -- when you play me, give a unit +2 Might this turn.
  [DANGEROUS_DUO]: register(`onPlaySelf:${DANGEROUS_DUO}`, {
    mandatory: true,
    condition: (state, player, sourceIid, ctx) =>
      (ctx as OnPlayCtx).playedIid === sourceIid && state.players[player].playedCardThisTurn,
    legalTargets: (state, player) => friendlyUnits(state, player),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) getInstance(state, targetIid).tempMightDelta += 2;
    },
  }),
  // Scrapyard Champion: [Legion] -- when you play me, discard 2, then draw 2 (same shape as
  // Undercover Agent's Deathknell, just gated on Legion and firing on play instead of on death).
  [SCRAPYARD_CHAMPION]: register(`onPlaySelf:${SCRAPYARD_CHAMPION}`, {
    mandatory: true,
    maxPicks: 2,
    condition: (state, player, sourceIid, ctx) =>
      (ctx as OnPlayCtx).playedIid === sourceIid && state.players[player].playedCardThisTurn,
    legalTargets: (state, player) => state.players[player].hand,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const inst = getInstance(state, targetIid);
      state.players[player].hand = state.players[player].hand.filter((h) => h !== targetIid);
      inst.zone = "trash";
      state.log.push(`P${player} discards ${state.defs[inst.defId]!.name}`);
    },
    onComplete: (state, player) => {
      drawFromMain(state, player);
      drawFromMain(state, player);
      state.log.push(`P${player} draws 2 (Legion)`);
    },
  }),
  // Trifarian Gloryseeker: [Legion] -- when you play me, buff me.
  [TRIFARIAN_GLORYSEEKER]: register(`onPlaySelf:${TRIFARIAN_GLORYSEEKER}`, {
    mandatory: true,
    condition: (state, player, sourceIid, ctx) =>
      (ctx as OnPlayCtx).playedIid === sourceIid && state.players[player].playedCardThisTurn,
    resolve: (state, _player, sourceIid) => giveBuff(getInstance(state, sourceIid)),
  }),
  // Darius - Executioner: [Legion] -- when you play me, ready me. (His "Other friendly units have
  // +1 Might here" is a static aura, handled generically via CardDef.auraMightBonus -- no trigger
  // needed for that half.)
  [DARIUS_EXECUTIONER]: register(`onPlaySelf:${DARIUS_EXECUTIONER}`, {
    mandatory: true,
    condition: (state, player, sourceIid, ctx) =>
      (ctx as OnPlayCtx).playedIid === sourceIid && state.players[player].playedCardThisTurn,
    resolve: (state, _player, sourceIid) => {
      getInstance(state, sourceIid).exhausted = false;
    },
  }),
  // Faithful Manufactor: when you play me, play a 1-Might Recruit token here.
  [FAITHFUL_MANUFACTOR]: register(`onPlaySelf:${FAITHFUL_MANUFACTOR}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    resolve: (state, player, sourceIid) => createRecruitHere(state, player, sourceIid, 1),
  }),
  // Forge of the Future (gear): when you play this, play a 1-Might Recruit token at your base.
  [FORGE_OF_THE_FUTURE]: register(`onPlaySelf:${FORGE_OF_THE_FUTURE}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    resolve: (state, player) => createToken(state, player, RECRUIT_TOKEN, "base"),
  }),
  // Solari Shieldbearer: when you play me, stun a unit. [Deflect N] targets require paying N
  // floating rainbow runes to be chosen — filtered out of `legalTargets` entirely if unaffordable,
  // and paid as part of resolving the pick.
  [SOLARI_SHIELDBEARER]: register(`onPlaySelf:${SOLARI_SHIELDBEARER}`, {
    mandatory: true,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    legalTargets: (state, player) =>
      Object.values(state.instances)
        .filter(
          (i) =>
            (i.zone === "base" || i.zone === "battlefield") &&
            state.defs[i.defId]!.type === "unit" &&
            canChooseThroughDeflect(state, player, i),
        )
        .map((i) => i.iid),
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      payDeflect(state, player, getInstance(state, targetIid));
      applyStun(state, targetIid, player);
    },
  }),
  // Kinkou Monk: when you play me, buff up to two other friendly units.
  [KINKOU_MONK]: register(`onPlaySelf:${KINKOU_MONK}`, {
    mandatory: true,
    maxPicks: 2,
    condition: (_state, _player, sourceIid, ctx) => (ctx as OnPlayCtx).playedIid === sourceIid,
    legalTargets: (state, player, sourceIid) => friendlyUnits(state, player, sourceIid),
    resolve: (state, _player, _source, targetIid) => {
      if (targetIid !== undefined) giveBuff(getInstance(state, targetIid));
    },
  }),
  // [Vision] cluster: when you play me, look at the top card of your Main Deck; you may recycle it.
  [JEWELED_COLOSSUS]: register(`onPlaySelf:${JEWELED_COLOSSUS}`, visionAbility()),
  [GEMCRAFT_SEER]: register(`onPlaySelf:${GEMCRAFT_SEER}`, visionAbility()),
  [MYSTIC_PORO]: register(`onPlaySelf:${MYSTIC_PORO}`, visionAbility()),
  [SAI_SCOUT]: register(`onPlaySelf:${SAI_SCOUT}`, visionAbility()),
  [KARMA]: register(`onPlaySelf:${KARMA}`, visionAbility()),
};
// The Vision cards' `condition` should only fire for themselves, not other cards being played.
for (const id of [JEWELED_COLOSSUS, GEMCRAFT_SEER, MYSTIC_PORO, SAI_SCOUT, KARMA]) {
  ALL_TRIGGERS[ON_PLAY_SELF_KIND[id]!]!.condition = (_state, _player, sourceIid, ctx) =>
    (ctx as OnPlayCtx).playedIid === sourceIid;
}

/** Gemcraft Seer: "Other friendly units have [Vision]." A static grant, not a one-off trigger --
 *  checked generically in `onPlayCard` below: if the player controls Gemcraft Seer, any OTHER unit
 *  they play also gets a Vision prompt (via the shared `GRANTED_VISION_KIND`), on top of whatever
 *  its own printed abilities already do. */
const VISION_GRANTERS = new Set([GEMCRAFT_SEER]);

const ON_ARRIVAL_KIND: Record<string, string> = {
  // Noxian Drummer: when I move to a battlefield, play a 1-Might Recruit token here.
  [NOXIAN_DRUMMER]: register(`onArrival:${NOXIAN_DRUMMER}`, {
    mandatory: true,
    resolve: (state, player, sourceIid) => createRecruitHere(state, player, sourceIid, 1),
  }),
};

const ON_DEATH_KIND: Record<string, string> = {
  // Machine Evangel: [Deathknell] -- play three 1-Might Recruit tokens into your base.
  [MACHINE_EVANGEL]: register(`onDeath:${MACHINE_EVANGEL}`, {
    mandatory: true,
    resolve: (state, player) => {
      for (let i = 0; i < 3; i++) createToken(state, player, RECRUIT_TOKEN, "base");
    },
  }),
  // Watchful Sentry: [Deathknell] -- draw 1.
  [WATCHFUL_SENTRY]: register(`onDeath:${WATCHFUL_SENTRY}`, {
    mandatory: true,
    resolve: (state, player) => {
      drawFromMain(state, player);
      state.log.push(`P${player} draws 1 (Deathknell)`);
    },
  }),
  // Undercover Agent: [Deathknell] -- discard 2, then draw 2. Discards as many of the 2 as the
  // hand has (even 0), and always draws 2 regardless via `onComplete`.
  [UNDERCOVER_AGENT]: register(`onDeath:${UNDERCOVER_AGENT}`, {
    mandatory: true,
    maxPicks: 2,
    legalTargets: (state, player) => state.players[player].hand,
    resolve: (state, player, _source, targetIid) => {
      if (targetIid === undefined) return;
      const inst = getInstance(state, targetIid);
      state.players[player].hand = state.players[player].hand.filter((h) => h !== targetIid);
      inst.zone = "trash";
      state.log.push(`P${player} discards ${state.defs[inst.defId]!.name}`);
    },
    onComplete: (state, player) => {
      drawFromMain(state, player);
      drawFromMain(state, player);
      state.log.push(`P${player} draws 2 (Deathknell)`);
    },
  }),
  // Tasty Faefolk: [Deathknell] -- channel 2 runes exhausted and draw 1.
  [TASTY_FAEFOLK]: register(`onDeath:${TASTY_FAEFOLK}`, {
    mandatory: true,
    resolve: (state, player) => {
      channelRunesExhausted(state, player, 2);
      drawFromMain(state, player);
      state.log.push(`P${player} channels 2 runes exhausted and draws 1 (Deathknell)`);
    },
  }),
  // Soaring Scout: [Deathknell] -- channel 1 rune exhausted.
  [SOARING_SCOUT]: register(`onDeath:${SOARING_SCOUT}`, {
    mandatory: true,
    resolve: (state, player) => {
      if (channelRunesExhausted(state, player, 1) > 0) {
        state.log.push(`P${player} channels a rune exhausted (Deathknell)`);
      }
    },
  }),
  // Ekko - Recurrent: [Deathknell] -- recycle me (to the bottom of the Main Deck instead of
  // staying in trash) and ready your runes. Best-effort reading of a slightly ambiguous card
  // (fits his "Recurrent" flavor — he comes back to be drawn again); revisit if a ruling turns up.
  // Guarded to be idempotent (checks `zone` first) so a Karthus - Eternal double-fire can't push
  // the same instance into the Main Deck twice.
  [EKKO_RECURRENT]: register(`onDeath:${EKKO_RECURRENT}`, {
    mandatory: true,
    resolve: (state, player, sourceIid) => {
      const inst = getInstance(state, sourceIid);
      if (inst.zone !== "mainDeck") {
        inst.zone = "mainDeck";
        inst.battlefield = null;
        state.players[player].mainDeck.push(sourceIid);
      }
      for (const iid of state.players[player].runePool) getInstance(state, iid).exhausted = false;
      state.log.push(`P${player} recycles Ekko and readies runes (Deathknell)`);
    },
  }),
};

/** Kog'Maw - Caustic: [Deathknell] -- deal 4 to all units at my battlefield. Special-cased outside
 *  the generic ON_DEATH_KIND dispatch because it's the one Deathknell that needs to know WHICH
 *  battlefield the dying unit was at, which `onUnitDeath`'s normal dispatch doesn't carry (the
 *  instance's `battlefield` field is already nulled by the time it fires) — called directly from
 *  showdown.ts's death loop, which already has the battlefield index in scope. */
export function onUnitDeathAtBattlefield(state: GameState, inst: CardInstance, battlefield: number): void {
  if (inst.defId !== KOG_MAW) return;
  dealDamageToUnitsAt(state, battlefield, 4);
  state.log.push(`Kog'Maw deals 4 to all units here (Deathknell)`);
}

const ON_STUN_SELF: Record<string, string> = {
  // Eclipse Herald: when you stun an enemy unit, ready me and give me +1 Might this turn.
  [ECLIPSE_HERALD]: register(`onStunSelf:${ECLIPSE_HERALD}`, {
    mandatory: true,
    resolve: (state, _player, sourceIid) => {
      const inst = getInstance(state, sourceIid);
      inst.exhausted = false;
      inst.tempMightDelta += 1;
    },
  }),
};

const ON_KILL_STUNNED_ENEMY_SELF: Record<string, string> = {
  // Solari Shrine: when you kill a stunned enemy unit, you may exhaust this to draw 1.
  [SOLARI_SHRINE]: register(`onKillStunned:${SOLARI_SHRINE}`, {
    mandatory: false, // "you may exhaust this" -- always a real decision
    condition: (state, _player, sourceIid) => !getInstance(state, sourceIid).exhausted,
    resolve: (state, player, sourceIid) => {
      getInstance(state, sourceIid).exhausted = true;
      drawFromMain(state, player);
      state.log.push(`P${player} draws 1 (Solari Shrine)`);
    },
  }),
};
