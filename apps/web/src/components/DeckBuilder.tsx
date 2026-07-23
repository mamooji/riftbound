import { useMemo, useState } from "react";
import { ArrowLeft, Check, Crown, Search, Ban, Plus, Minus, Swords, Zap, Gem } from "lucide-react";
import {
  CARDS,
  cardsByType,
  renderCardText,
  isBanned,
  buildDeck,
  chosenChampionEligible,
  signatureEligible,
  type CatalogCard,
} from "@riftbound/cards";
import type { CardColor } from "@riftbound/shared";
import { colorHex, colorLabel } from "@/lib/domains.js";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { useGame } from "@/store.js";

const MIN_MAIN = 40;
const MAX_COPIES = 3;
const RUNE_TOTAL = 12;
const MAIN_TYPES = ["unit", "spell", "gear"] as const;

/** A legend's domains, excluding colorless (Set 1 legends always have exactly 2). */
function legendDomains(legend: CatalogCard): string[] {
  return legend.domains.filter((d) => d !== "colorless");
}

/** Even split across the legend's domains (remainder to the first) — the default before tuning. */
function evenSplit(domains: string[]): number[] {
  if (domains.length === 0) return [];
  const base = Math.floor(RUNE_TOTAL / domains.length);
  return domains.map((_, i) => (i === domains.length - 1 ? RUNE_TOTAL - base * (domains.length - 1) : base));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Builds the 12-card rune deck from a per-domain count (counts must sum to RUNE_TOTAL). */
function runesFromSplit(domains: string[], counts: number[]): CatalogCard[] {
  if (domains.length === 0) {
    const fallback = CARDS.find((c) => c.type === "rune")!;
    return Array.from({ length: RUNE_TOTAL }, () => fallback);
  }
  const runeCards = domains.map((d) => CARDS.find((c) => c.type === "rune" && c.domains.includes(d))!);
  const result: CatalogCard[] = [];
  domains.forEach((_, i) => {
    for (let k = 0; k < (counts[i] ?? 0); k++) result.push(runeCards[i]!);
  });
  return result;
}

/**
 * A card is legal in the main deck if every one of its domains is within the legend's (colorless
 * ok) — EXCEPT Signature-supertype cards, which must additionally share a character tag with the
 * legend (e.g. Icathian Rain is Kai'Sa's signature; a Fury/Mind legend that isn't Kai'Sa still
 * can't play it, even though the domains match — 36 legends share only 15 domain pairs, so
 * domain-only checks let signatures leak into decks they don't belong in).
 */
function withinLegend(card: CatalogCard, legend: CatalogCard | null): boolean {
  if (!legend) return true;
  if (card.supertype === "signature") return signatureEligible(card, legend);
  return card.domains.every((d) => d === "colorless" || legend.domains.includes(d));
}

export function DeckBuilder() {
  const setCustomDeck = useGame((s) => s.setCustomDeck);
  const backToSetup = useGame((s) => s.backToSetup);

  const [legend, setLegend] = useState<CatalogCard | null>(null);
  const [championId, setChampionId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [runeCounts, setRuneCounts] = useState<number[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "unit" | "spell" | "gear">("all");
  const [query, setQuery] = useState("");

  const legends = useMemo(() => cardsByType("legend"), []);
  const domains = useMemo(() => (legend ? legendDomains(legend) : []), [legend]);
  const champions = useMemo(
    () => (legend ? CARDS.filter((c) => chosenChampionEligible(c, legend)) : []),
    [legend],
  );
  const mainTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const valid = legend !== null && championId !== null && mainTotal >= MIN_MAIN;

  function pickLegend(l: CatalogCard) {
    setLegend(l);
    setChampionId(null);
    setCounts({});
    setRuneCounts(evenSplit(legendDomains(l)));
  }

  /** Max copies of `id` allowed in the MAIN DECK grid — one less if it's the Chosen Champion,
   *  since that zone copy already counts toward the shared 3-copy cap. */
  function maxMainCopies(id: string): number {
    return id === championId ? MAX_COPIES - 1 : MAX_COPIES;
  }

  /** Nudges domain `i`'s rune count, taking/giving the difference to its neighbor (sum stays 12). */
  function adjustRune(i: number, delta: number) {
    setRuneCounts((prev) => {
      if (prev.length !== 2) return prev;
      const other = 1 - i;
      const next = [...prev];
      const a = clamp(next[i]! + delta, 0, RUNE_TOTAL);
      const applied = a - next[i]!;
      next[i] = a;
      next[other] = clamp(next[other]! - applied, 0, RUNE_TOTAL);
      return next;
    });
  }

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CARDS.filter(
      (c) =>
        MAIN_TYPES.includes(c.type as (typeof MAIN_TYPES)[number]) &&
        c.supertype !== "token" && // tokens are card-effect add-ons, not deckbuilt
        (typeFilter === "all" || c.type === typeFilter) &&
        (q === "" || c.name.toLowerCase().includes(q)) &&
        withinLegend(c, legend),
    ).sort((a, b) => (a.energy ?? 0) - (b.energy ?? 0) || a.name.localeCompare(b.name));
  }, [typeFilter, query, legend]);

  function add(c: CatalogCard) {
    if (isBanned(c.id)) return;
    setCounts((prev) => {
      const n = prev[c.id] ?? 0;
      if (n >= maxMainCopies(c.id)) return prev;
      return { ...prev, [c.id]: n + 1 };
    });
  }
  function remove(id: string) {
    setCounts((prev) => {
      const n = (prev[id] ?? 0) - 1;
      const next = { ...prev };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  /** Selecting a Chosen Champion frees up one of its main-deck copy slots (zone copy counts
   *  toward the shared cap) — clamp down if the grid already has 3 copies queued. */
  function pickChampion(id: string) {
    const next = championId === id ? null : id;
    setChampionId(next);
    if (next !== null) {
      setCounts((prev) => {
        const n = prev[next] ?? 0;
        if (n <= MAX_COPIES - 1) return prev;
        return { ...prev, [next]: MAX_COPIES - 1 };
      });
    }
  }

  function useDeck() {
    if (!legend || !championId) return;
    const main = Object.entries(counts).flatMap(([id, n]) => {
      const c = CARDS.find((x) => x.id === id)!;
      return Array.from({ length: n }, () => c);
    });
    const champion = CARDS.find((c) => c.id === championId)!;
    const deck = buildDeck(legend, main, runesFromSplit(domains, runeCounts), champion);
    setCustomDeck(deck, `Custom · ${legend.name.split(" - ")[0]}`, (legend.domains[0] ?? "order") as CardColor);
  }

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col gap-3 px-4 py-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={backToSetup}><ArrowLeft /> Back</Button>
          <h1 className="text-lg font-bold">Deck builder</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-sm tabular-nums", mainTotal >= MIN_MAIN ? "text-emerald-300" : "text-muted-foreground")}>
            Main {mainTotal}/{MIN_MAIN}+ · Runes 12
          </span>
          <Button disabled={!valid} onClick={useDeck}><Check /> Use deck</Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        {/* Browser */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Legend picker */}
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Crown className="size-3.5" /> Legend {legend && <span className="text-foreground">— {legend.name}</span>}</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {legends.map((l) => {
                const active = legend?.id === l.id;
                const c = colorHex((l.domains[0] ?? "order") as CardColor);
                return (
                  <button key={l.id} onClick={() => pickLegend(l)} className={cn("flex shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left", active ? "border-primary" : "border-border hover:border-white/20")} style={{ boxShadow: active ? "0 0 0 1px hsl(var(--ring))" : undefined }}>
                    <span className="flex size-6 items-center justify-center rounded" style={{ background: `${c}22`, color: c }}><Crown className="size-3.5" /></span>
                    <div>
                      <div className="text-xs font-semibold leading-tight">{l.name.split(" - ")[0]}</div>
                      <div className="text-[10px] text-muted-foreground">{l.domains.filter((d) => d !== "colorless").map((d) => colorLabel(d as CardColor)).join(" / ")}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rune split — Set 1 legends have 2 domains; pick how the 12 runes divide between them */}
          {domains.length > 1 && (
            <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-xs font-semibold text-muted-foreground">Rune split</span>
              {domains.map((d, i) => (
                <div key={d} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: colorHex(d as CardColor) }} />
                  <span className="text-xs">{colorLabel(d as CardColor)}</span>
                  <button onClick={() => adjustRune(i, -1)} disabled={(runeCounts[i] ?? 0) <= 0} className="rounded bg-white/10 p-0.5 enabled:hover:bg-white/20 disabled:opacity-30"><Minus className="size-3" /></button>
                  <span className="w-4 text-center text-xs font-bold tabular-nums">{runeCounts[i] ?? 0}</span>
                  <button onClick={() => adjustRune(i, 1)} disabled={(runeCounts[i] ?? 0) >= RUNE_TOTAL} className="rounded bg-white/10 p-0.5 enabled:hover:bg-white/20 disabled:opacity-30"><Plus className="size-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Chosen Champion — starts the game in the Champion Zone (not the 40-card main deck),
              playable from there like any card; must share a character tag with the legend. */}
          {legend && (
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Crown className="size-3.5" /> Chosen Champion
                {championId && <span className="text-foreground">— {CARDS.find((c) => c.id === championId)?.name}</span>}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {champions.length === 0 && (
                  <span className="text-xs text-muted-foreground">No champion cards match this legend.</span>
                )}
                {champions.map((c) => {
                  const active = championId === c.id;
                  const accent = colorHex((c.domains[0] ?? "order") as CardColor);
                  return (
                    <button key={c.id} onClick={() => pickChampion(c.id)} className={cn("flex shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left", active ? "border-primary" : "border-border hover:border-white/20")} style={{ boxShadow: active ? "0 0 0 1px hsl(var(--ring))" : undefined }}>
                      <span className="flex size-6 items-center justify-center rounded" style={{ background: `${accent}22`, color: accent }}><Crown className="size-3.5" /></span>
                      <div>
                        <div className="text-xs font-semibold leading-tight">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">⚡{c.energy ?? 0} · {c.might ?? 0}⚔</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cards…" className="w-40 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            {(["all", "unit", "spell", "gear"] as const).map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)} className={cn("rounded-md px-2 py-1 text-xs capitalize", typeFilter === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/70")}>{t}</button>
            ))}
            {!legend && <span className="text-xs text-muted-foreground">Pick a legend to filter to legal cards.</span>}
          </div>

          {/* Card grid */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
            {pool.map((c) => {
              const banned = isBanned(c.id);
              const n = counts[c.id] ?? 0;
              const accent = colorHex((c.domains[0] ?? "order") as CardColor);
              return (
                <button key={c.id} onClick={() => add(c)} disabled={banned || n >= maxMainCopies(c.id)} className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-left enabled:hover:border-white/25 disabled:opacity-50" style={{ boxShadow: n > 0 ? `inset 3px 0 0 ${accent}` : undefined }}>
                  <div className="flex min-w-0 items-start justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold leading-tight">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-0.5 rounded bg-black/40 px-1 text-[9px] font-bold text-sky-300"><Zap className="size-2" />{c.energy ?? 0}{c.power ? <><Gem className="size-2 text-violet-300" />{c.power}</> : null}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                    <span className="capitalize">{c.type}</span>
                    {c.type === "unit" && <span className="flex items-center gap-0.5"><Swords className="size-2" />{c.might ?? 0}</span>}
                    {banned && <span className="flex items-center gap-0.5 text-rose-400"><Ban className="size-2.5" />banned</span>}
                    {n > 0 && <span className="ml-auto rounded bg-primary px-1 font-bold text-primary-foreground">{n}×</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[9px] leading-tight text-muted-foreground/80">{renderCardText(c.text)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Current deck */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Your deck</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!legend && <p className="p-2 text-xs text-muted-foreground">Choose a legend, then add cards.</p>}
            {legend && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1.5 text-xs">
                <Crown className="size-3.5 text-amber-300" /><span className="font-semibold">{legend.name}</span>
              </div>
            )}
            {legend && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-secondary/30 px-2 py-1.5 text-xs">
                <Crown className="size-3.5 text-muted-foreground" />
                <span className={championId ? "font-semibold" : "text-amber-400"}>
                  {championId ? `Champion Zone: ${CARDS.find((c) => c.id === championId)?.name}` : "No Chosen Champion picked"}
                </span>
              </div>
            )}
            {Object.entries(counts).sort().map(([id, n]) => {
              const c = CARDS.find((x) => x.id === id)!;
              return (
                <div key={id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-white/5">
                  <span className="flex items-center gap-0.5 rounded bg-black/40 px-1 text-[9px] font-bold text-sky-300"><Zap className="size-2" />{c.energy ?? 0}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="tabular-nums text-muted-foreground">{n}×</span>
                  <button onClick={() => remove(id)} className="rounded bg-white/10 p-0.5 hover:bg-white/20"><Minus className="size-3" /></button>
                  <button onClick={() => add(c)} disabled={n >= maxMainCopies(id)} className="rounded bg-white/10 p-0.5 hover:bg-white/20 disabled:opacity-30"><Plus className="size-3" /></button>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {mainTotal} main · 12 runes {valid ? <Badge variant="muted" className="ml-1 text-emerald-300">legal</Badge> : <span className="text-amber-400">need {championId ? `${Math.max(0, MIN_MAIN - mainTotal)} more` : "a Chosen Champion"}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
