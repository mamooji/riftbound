/**
 * Builder state <-> engine `ScenarioConfig`, plus presets that stand a card up on a sensible board
 * so most cards are testable in one click.
 */
import type { CardColor, PlayerId } from "@riftbound/shared";
import type { CardDef, ScenarioConfig, Zone } from "@riftbound/engine";
import { scriptedCardIds } from "@riftbound/engine";
import { allDefs, type TestCard } from "./inventory.ts";

export type Seat = 0 | 1;
export type PlaceZone = Extract<Zone, "hand" | "base" | "battlefield" | "championZone" | "trash" | "facedown">;

export interface BuilderCard {
  defId: string;
  zone: PlaceZone;
  battlefield?: number;
  exhausted?: boolean;
  buffed?: boolean;
  stunned?: boolean;
}

export interface BuilderSeat {
  legendDefId: string;
  cards: BuilderCard[];
  energy: number;
  power: number;
  points: number;
  playedCardThisTurn: boolean;
  floatingRainbow: number;
  /** Ready runes to channel, by color. */
  runeColors: CardColor[];
}

export interface Builder {
  seats: [BuilderSeat, BuilderSeat];
  battlefields: [string, string];
  battlefieldControllers: [PlayerId | null, PlayerId | null];
  activePlayer: Seat;
}

const NEUTRAL_LEGEND = "ogn-247-298"; // Kai'Sa — activated-only, no surprise passives
const INCINERATE = "ogs-003-024"; // cheap Action opener so [Reaction] counters have a spell to hit
const ALL_COLORS: CardColor[] = ["fury", "calm", "mind", "body", "chaos", "order"];

/** A couple of vanilla units (no scripted behaviour) to populate boards without firing side effects. */
function vanillaUnits(): string[] {
  const scripted = new Set(scriptedCardIds());
  const defs = allDefs();
  return Object.values(defs)
    .filter((d) => d.type === "unit" && !scripted.has(d.id as string) && d.might >= 2 && d.energy <= 4)
    .sort((a, b) => b.might - a.might)
    .map((d) => d.id as string)
    .slice(0, 6);
}

function seat(legendDefId: string): BuilderSeat {
  return {
    legendDefId,
    cards: [],
    energy: 12,
    power: 12,
    points: 0,
    playedCardThisTurn: true, // enables [Legion] conditions & Darius/Sun Disc; harmless otherwise
    floatingRainbow: 3,
    runeColors: [...ALL_COLORS],
  };
}

/** A rich two-sided board: friendly units at base + a contested battlefield, ready to test almost
 *  anything (targets, auras, showdowns, priority). */
export function defaultBoard(): Builder {
  const vanilla = vanillaUnits();
  const [u0, u1, u2] = [vanilla[0]!, vanilla[1] ?? vanilla[0]!, vanilla[2] ?? vanilla[0]!];
  const bfs = battlefieldIds();

  const p0 = seat(NEUTRAL_LEGEND);
  p0.cards = [
    { defId: u0, zone: "base" },
    { defId: u1, zone: "base" },
    { defId: u2, zone: "battlefield", battlefield: 0 },
  ];
  const p1 = seat(NEUTRAL_LEGEND);
  p1.cards = [
    { defId: u0, zone: "base" },
    { defId: u1, zone: "battlefield", battlefield: 0 }, // contests P0's unit at bf0
  ];

  return {
    seats: [p0, p1],
    battlefields: bfs,
    battlefieldControllers: [null, null],
    activePlayer: 0,
  };
}

/** Stand up a scenario to test one specific card. */
export function presetForCard(card: TestCard): Builder {
  const b = defaultBoard();
  if (card.type === "legend") {
    b.seats[0].legendDefId = card.defId;
    return b;
  }
  if (card.type === "spell" && card.def.timing === "reaction") {
    // Reaction spells only do something in response to a Chain: give the opponent (P1) the card and
    // the tester (P0) a cheap spell to play first, opening a Chain the reaction can respond to.
    b.seats[1].cards.push({ defId: card.defId, zone: "hand" });
    b.seats[0].cards.push({ defId: INCINERATE, zone: "hand" });
    return b;
  }
  b.seats[0].cards.push({ defId: card.defId, zone: "hand" });
  return b;
}

/** A ready-made Chain / priority demo: P0 plays Incinerate, P1 can respond with Wind Wall (counter). */
export function priorityDemo(): Builder {
  const b = defaultBoard();
  b.seats[0].cards.push({ defId: INCINERATE, zone: "hand" });
  b.seats[1].cards.push({ defId: "ogn-064-298", zone: "hand" }); // Wind Wall [Reaction] — counter a spell
  return b;
}

function battlefieldIds(): [string, string] {
  const defs = allDefs();
  const bfs = Object.values(defs)
    .filter((d) => d.type === "battlefield")
    .map((d) => d.id as string);
  return [bfs[0]!, bfs[1] ?? bfs[0]!];
}

/** Convert builder state into an engine ScenarioConfig (collecting exactly the defs it references). */
export function toScenarioConfig(b: Builder): ScenarioConfig {
  const defs = allDefs();
  const referenced = new Set<string>([...b.battlefields]);
  for (const s of b.seats) {
    referenced.add(s.legendDefId);
    for (const c of s.cards) referenced.add(c.defId);
  }
  const defList: CardDef[] = [];
  for (const id of referenced) {
    const d = defs[id];
    if (d) defList.push(d);
  }

  return {
    defs: defList,
    battlefields: b.battlefields,
    battlefieldControllers: b.battlefieldControllers,
    activePlayer: b.activePlayer,
    firstPlayer: 0,
    players: [scenarioPlayer(b.seats[0]), scenarioPlayer(b.seats[1])],
  };
}

function scenarioPlayer(s: BuilderSeat): ScenarioConfig["players"][number] {
  return {
    legendDefId: s.legendDefId,
    energy: s.energy,
    power: s.power,
    points: s.points,
    playedCardThisTurn: s.playedCardThisTurn,
    floatingRunes: Array.from({ length: s.floatingRainbow }, () => "rainbow" as const),
    runes: s.runeColors.map((color) => ({ color })),
    cards: s.cards.map((c) => ({
      defId: c.defId,
      zone: c.zone,
      battlefield: c.battlefield,
      exhausted: c.exhausted,
      buffed: c.buffed,
      stunned: c.stunned,
    })),
  };
}
