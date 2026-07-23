/**
 * The rune-pool resource system: Energy and Power, and "floating".
 *
 * - Exhaust a READY rune  -> +1 Energy   (rune becomes exhausted; readies next turn)
 * - Recycle ANY rune      -> +1 Power    (rune leaves the pool, back to the rune deck)
 *
 * Both land in the player's pool and stay there until spent or end of turn ("floating"). A ready
 * rune can be exhausted for Energy and then still recycled for Power — the classic float combo.
 *
 * All functions mutate a draft GameState in place (callers hold an Immer draft).
 */
import type { CardColor, InstanceId, PlayerId } from "@riftbound/shared";
import { getInstance, readyRunes, type GameState } from "./state.js";

/** Float Energy: exhaust one ready rune, banking +1 Energy. Returns false if none ready. */
export function floatEnergy(state: GameState, player: PlayerId, runeIid: InstanceId): boolean {
  const rune = state.instances[runeIid as number];
  if (!rune || rune.zone !== "runePool" || rune.controller !== player || rune.exhausted) {
    return false;
  }
  rune.exhausted = true;
  state.players[player].energy += 1;
  return true;
}

/** Float Power: recycle one rune (ready or exhausted) to the rune deck, banking +1 Power. */
export function floatPower(state: GameState, player: PlayerId, runeIid: InstanceId): boolean {
  const rune = state.instances[runeIid as number];
  if (!rune || rune.zone !== "runePool" || rune.controller !== player) return false;
  recycleRune(state, player, runeIid);
  return true;
}

function recycleRune(state: GameState, player: PlayerId, runeIid: InstanceId): void {
  const p = state.players[player];
  const rune = state.instances[runeIid as number]!;
  p.runePool = p.runePool.filter((r) => r !== runeIid);
  rune.zone = "runeDeck";
  rune.exhausted = false;
  rune.battlefield = null;
  p.runeDeck.push(runeIid); // to the bottom, re-channelable later
  p.power += 1;
}

/** Maximum Energy the player could still produce this turn (pool + exhaustable ready runes). */
export function maxEnergy(state: GameState, player: PlayerId): number {
  return state.players[player].energy + readyRunes(state, player).length;
}

/** Maximum Power the player could still produce this turn (pool + recyclable runes). */
export function maxPower(state: GameState, player: PlayerId): number {
  return state.players[player].power + state.players[player].runePool.length;
}

export function canAfford(
  state: GameState,
  player: PlayerId,
  energyCost: number,
  powerCost: number,
): boolean {
  return maxEnergy(state, player) >= energyCost && maxPower(state, player) >= powerCost;
}

/**
 * Auto-pay a cost from the pool, generating resources as needed: exhaust ready runes for Energy
 * first (they stay in the pool), then recycle runes for Power (prefer already-exhausted ones so
 * ready runes remain available). Throws if unaffordable — callers should gate with canAfford.
 */
export function autoPay(
  state: GameState,
  player: PlayerId,
  energyCost: number,
  powerCost: number,
): void {
  const p = state.players[player];

  while (p.energy < energyCost) {
    const rune = readyRunes(state, player)[0];
    if (!rune) throw new Error("autoPay: insufficient Energy");
    rune.exhausted = true;
    p.energy += 1;
  }

  while (p.power < powerCost) {
    const iid = pickRecyclable(state, player);
    if (iid === null) throw new Error("autoPay: insufficient Power");
    recycleRune(state, player, iid);
  }

  p.energy -= energyCost;
  p.power -= powerCost;
}

/** Prefer recycling an already-exhausted rune so ready runes stay usable for Energy. */
function pickRecyclable(state: GameState, player: PlayerId): InstanceId | null {
  const pool = state.players[player].runePool;
  const exhausted = pool.find((iid) => state.instances[iid as number]!.exhausted);
  if (exhausted !== undefined) return exhausted;
  return pool[0] ?? null;
}

/** Whether the player has a ready (unexhausted) rune of the given domain color in their pool —
 *  used for [Accelerate]'s alternate cost, which requires a specific-colored rune, not just any
 *  generic Energy. */
export function hasReadyRuneOfColor(state: GameState, player: PlayerId, color: CardColor): boolean {
  return state.players[player].runePool.some((iid) => {
    const r = getInstance(state, iid);
    return !r.exhausted && state.defs[r.defId]!.colors.includes(color);
  });
}

/** Exhausts one ready rune of the given color (does NOT bank Energy — this is a direct cost
 *  payment, distinct from `floatEnergy`'s generic exhaust-for-Energy conversion). */
export function spendRuneOfColor(state: GameState, player: PlayerId, color: CardColor): void {
  const iid = state.players[player].runePool.find((iid) => {
    const r = getInstance(state, iid);
    return !r.exhausted && state.defs[r.defId]!.colors.includes(color);
  });
  if (iid !== undefined) getInstance(state, iid).exhausted = true;
}

/**
 * Whether [Accelerate]'s alternate cost is affordable ON TOP OF the card's own base cost, paid
 * from the SAME limited pool of ready runes. Naively checking `hasReadyRuneOfColor` and
 * `canAfford(accelerateCost.energy, 0)` independently is wrong: both costs compete for the same
 * ready runes, and the colored-rune requirement reserves one ready rune that can no longer also
 * count toward the combined Energy cost. Reserve it first (in this math), then check what's left.
 */
export function canAffordAccelerate(
  state: GameState,
  player: PlayerId,
  baseEnergy: number,
  basePower: number,
  accelerateEnergy: number,
  accelerateRune: CardColor,
): boolean {
  if (!hasReadyRuneOfColor(state, player, accelerateRune)) return false;
  const p = state.players[player];
  const energyAfterReservingOneRune = p.energy + readyRunes(state, player).length - 1;
  return energyAfterReservingOneRune >= baseEnergy + accelerateEnergy && maxPower(state, player) >= basePower;
}
