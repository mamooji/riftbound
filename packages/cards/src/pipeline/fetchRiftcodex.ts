/**
 * Riftbound Set 1 card-data pipeline — covers both Origins (OGN) and Origins: Proving Grounds
 * (OGS), the starter-deck-only companion set published the same day as Origins and still part
 * of Set 1.
 *
 * Run with:  pnpm --filter @riftbound/cards fetch          (OGN -> data/origins.json)
 *            pnpm --filter @riftbound/cards fetch ogs       (OGS -> data/provinggrounds.json)
 *
 * Pages through the open Riftcodex REST API, normalizes every card into the shape the app +
 * engine consume, and writes a committed snapshot. The app NEVER calls the API at runtime — it
 * imports these snapshots.
 *
 * Riftcodex cost model (important): `energy` and `power` are both PLAY COSTS (pay energy by
 * exhausting runes, power by recycling runes); `might` is the combat stat. Card ART is Riot IP —
 * we store only the official image URL, never the bytes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.riftcodex.com/cards";
const SET_ID = (process.argv[2] ?? "ogn").toLowerCase();
const OUT_FILES: Record<string, string> = {
  ogn: "origins.json",
  ogs: "provinggrounds.json",
};
const PAGE_SIZE = 50; // API max

interface RawCard {
  riftbound_id?: string;
  name?: string;
  collector_number?: number;
  attributes?: { energy?: number | null; might?: number | null; power?: number | null };
  classification?: {
    type?: string;
    supertype?: string | null;
    rarity?: string;
    domain?: string[];
  };
  text?: { plain?: string; flavour?: string };
  media?: { image_url?: string | null; artist?: string | null };
  tags?: string[];
  metadata?: { alternate_art?: boolean; signature?: boolean };
}

export interface CatalogCard {
  id: string;
  name: string;
  number: number;
  type: string;
  supertype: string | null;
  domains: string[];
  rarity: string;
  energy: number | null;
  power: number | null;
  might: number | null;
  text: string;
  flavour: string;
  image: string | null;
  artist: string | null;
  tags: string[];
  alternateArt: boolean;
  signature: boolean;
}

function normalize(raw: RawCard): CatalogCard {
  const a = raw.attributes ?? {};
  const c = raw.classification ?? {};
  return {
    id: String(raw.riftbound_id ?? raw.collector_number ?? raw.name ?? ""),
    name: String(raw.name ?? "Unknown"),
    number: Number(raw.collector_number ?? 0),
    type: String(c.type ?? "").toLowerCase(),
    supertype: c.supertype ? String(c.supertype).toLowerCase() : null,
    domains: (c.domain ?? []).map((d) => String(d).toLowerCase()),
    rarity: String(c.rarity ?? "").toLowerCase(),
    energy: a.energy ?? null,
    power: a.power ?? null,
    might: a.might ?? null,
    text: String(raw.text?.plain ?? ""),
    flavour: String(raw.text?.flavour ?? ""),
    image: raw.media?.image_url ?? null,
    artist: raw.media?.artist ?? null,
    tags: raw.tags ?? [],
    alternateArt: raw.metadata?.alternate_art ?? false,
    signature: raw.metadata?.signature ?? false,
  };
}

async function fetchAll(): Promise<CatalogCard[]> {
  const out: CatalogCard[] = [];
  let page = 1;
  let pages = 1;
  do {
    const url = `${API}?set_id=${SET_ID}&limit=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Riftcodex ${res.status} ${res.statusText} for ${url}`);
    const body = (await res.json()) as { items: RawCard[]; pages: number; total: number };
    out.push(...body.items.map(normalize));
    pages = body.pages;
    console.log(`page ${page}/${pages} (${out.length}/${body.total})`);
    page++;
  } while (page <= pages);
  return out;
}

async function main(): Promise<void> {
  const cards = await fetchAll();
  cards.sort((a, b) => a.number - b.number);

  const byType: Record<string, number> = {};
  for (const c of cards) byType[c.type] = (byType[c.type] ?? 0) + 1;

  const outFile = OUT_FILES[SET_ID];
  if (!outFile) throw new Error(`Unknown set id "${SET_ID}"; expected one of ${Object.keys(OUT_FILES).join(", ")}`);
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, `../../data/${outFile}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ set: SET_ID, count: cards.length, byType, cards }, null, 2),
  );
  console.log(`Wrote ${cards.length} cards to ${outPath}`);
  console.log("By type:", byType);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
