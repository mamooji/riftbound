/**
 * Per-card test results, persisted in localStorage and exportable as a Markdown report to paste
 * back to Claude.
 */
import type { TestCard } from "./inventory.ts";

export type Status = "untested" | "pass" | "fail";
export interface Note {
  status: Status;
  note: string;
}
export type Notes = Record<string, Note>;

const KEY = "riftbound-test-notes-v1";

export function loadNotes(): Notes {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Notes;
  } catch {
    return {};
  }
}

export function saveNotes(notes: Notes): void {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

export function getNote(notes: Notes, defId: string): Note {
  return notes[defId] ?? { status: "untested", note: "" };
}

const MARK: Record<Status, string> = { pass: "✅", fail: "❌", untested: "⬜" };

/** A Markdown report grouped by category, listing every tested (pass/fail) card with its note. */
export function toMarkdown(inventory: TestCard[], notes: Notes): string {
  const byCat = new Map<string, TestCard[]>();
  for (const c of inventory) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }

  const counts = { pass: 0, fail: 0, untested: 0 };
  for (const c of inventory) counts[getNoteStatus(notes, c.defId)]++;

  const lines: string[] = [
    `# Riftbound engine — card test results`,
    ``,
    `Totals: ✅ ${counts.pass} pass · ❌ ${counts.fail} fail · ⬜ ${counts.untested} untested (of ${inventory.length}).`,
    ``,
  ];
  for (const [cat, cards] of byCat) {
    const tested = cards.filter((c) => getNoteStatus(notes, c.defId) !== "untested");
    if (tested.length === 0) continue;
    lines.push(`## ${cat}`, ``);
    for (const c of tested) {
      const n = notes[c.defId]!;
      lines.push(`- ${MARK[n.status]} **${c.name}** (\`${c.defId}\`)${n.note ? ` — ${n.note}` : ""}`);
    }
    lines.push(``);
  }

  const failing = inventory.filter((c) => getNoteStatus(notes, c.defId) === "fail");
  if (failing.length) {
    lines.push(`## ❌ Failing — needs a fix`, ``);
    for (const c of failing) {
      const n = notes[c.defId]!;
      lines.push(`- **${c.name}** (\`${c.defId}\`): ${n.note || "(no note)"}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function getNoteStatus(notes: Notes, defId: string): Status {
  return notes[defId]?.status ?? "untested";
}
