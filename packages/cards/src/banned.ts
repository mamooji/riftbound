/**
 * Set 1 (Origins) banned cards.
 *
 * A dedicated space for the ban list so the deck builder can flag/forbid banned cards. Only
 * Origins cards are listed here (cross-set bans like Called Shot / Draven Vanquisher / Master Yi
 * belong to later sets and are out of scope for Set 1). Structured by format so 2v2 can extend
 * Standard. Sources: official Riftbound ban announcements (2026-03-31 and 2026-07-24).
 */
export type BanFormat = "standard" | "2v2";

export interface BanEntry {
  id: string;
  name: string;
  /** ISO date the ban took effect. */
  since: string;
}

/** Origins cards banned in Standard Constructed. */
export const STANDARD_BANS: BanEntry[] = [
  { id: "ogn-182-298", name: "Scrapheap", since: "2026-03-31" },
  { id: "ogn-168-298", name: "Fight or Flight", since: "2026-03-31" },
  { id: "ogn-177-298", name: "Stealthy Pursuer", since: "2026-07-24" },
  // Battlefields
  { id: "ogn-292-298", name: "The Dreaming Tree", since: "2026-03-31" },
  { id: "ogn-284-298", name: "Obelisk of Power", since: "2026-03-31" },
  { id: "ogn-285-298", name: "Reaver's Row", since: "2026-03-31" },
  { id: "ogn-290-298", name: "The Arena's Greatest", since: "2026-07-24" },
  { id: "ogn-276-298", name: "Aspirant's Climb", since: "2026-07-24" },
];

/** Origins cards banned only in 2v2 (on top of the full Standard list). */
export const TEAM_ONLY_BANS: BanEntry[] = [
  // (No Origins-only 2v2 bans yet; Master Yi is from a later set.)
];

export const BANS: Record<BanFormat, BanEntry[]> = {
  standard: STANDARD_BANS,
  "2v2": [...STANDARD_BANS, ...TEAM_ONLY_BANS],
};

const BANNED_IDS: Record<BanFormat, Set<string>> = {
  standard: new Set(STANDARD_BANS.map((b) => b.id)),
  "2v2": new Set(BANS["2v2"].map((b) => b.id)),
};

export function isBanned(cardId: string, format: BanFormat = "standard"): boolean {
  return BANNED_IDS[format].has(cardId);
}
