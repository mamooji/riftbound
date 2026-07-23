/**
 * The set of card ids the engine actually scripts — the single source of truth for "what can be
 * tested," used by the manual-testing UI to build its checklist. Unions every registry that carries
 * card behaviour: activated abilities, simple spell effects, compound spell casters, and every
 * triggered/passive ability (whose registry `kind` strings embed the card id, e.g.
 * `onPlaySelf:ogn-136-298`, `spell:ogn-029-298`).
 */
import { ABILITIES } from "./abilities.js";
import { ALL_TRIGGERS } from "./triggerCore.js";
import { SPELL_EFFECTS } from "./spells.js";
import { SPELL_CASTERS } from "./spellsCompound.js";

const ID_RE = /(?:ogn|ogs)-\d+-\d+/;

/** Every catalog card id with scripted engine behaviour, sorted. */
export function scriptedCardIds(): string[] {
  const ids = new Set<string>();
  for (const id of Object.keys(ABILITIES)) ids.add(id);
  for (const id of Object.keys(SPELL_EFFECTS)) ids.add(id);
  for (const id of Object.keys(SPELL_CASTERS)) ids.add(id);
  for (const kind of Object.keys(ALL_TRIGGERS)) {
    const m = ID_RE.exec(kind);
    if (m) ids.add(m[0]);
  }
  return [...ids].sort();
}
