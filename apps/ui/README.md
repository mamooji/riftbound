# Riftbound Engine — Card Test Bench

An interactive UI for manually verifying scripted engine behaviour: **legend abilities, spells,
gear, and priority/focus passing with spells**. Build a board state from real Set 1 cards, click
through the engine's legal actions as either player, and record a Pass/Fail note per card that you
can export and paste back to Claude.

## Run it

```bash
pnpm ui           # from the repo root  (→ http://127.0.0.1:5199)
# or
pnpm --filter @riftbound/ui dev
```

## How it works

- **Scenario builder** (left → *Scenario builder* tab): pick each player's legend, drop any card
  into any zone (hand / base / battlefield / champion / trash / facedown), set energy/power/points,
  then **Build**. Both seats start flush with resources so cost is rarely the blocker.
- **Checklist** (left → *Checklist* tab): every card the engine scripts (derived from the engine's
  own registries via `scriptedCardIds()`, so it's always complete). Hit **Load ▶** on a card to
  auto-build a sensible board for it. Mark **✅ pass / ❌ fail** and jot what you saw. **Export
  report** copies a Markdown summary to your clipboard (and downloads it) — paste that back to Claude.
- **Game view** (middle): both players' zones, the Chain, pending decisions, Showdown state, and the
  full action log.
- **Actions** (right): the engine's legal actions for the "acting" seat, most interesting first.
  Toggle **Act as P0 / P1** to pass priority / play reactions as the other player — the ● marks
  whose decision the engine is waiting on.

### Testing priority / focus with spells

Use the **⚡ Priority demo** button (top bar) for a ready-made Chain: P0 plays *Incinerate*, then the
engine hands priority to P1, who can respond with *Wind Wall* (counter) — or pass. For any
`[Reaction]` card, the checklist's **Load** puts it in the opponent's hand with a spell for you to
cast first, so there's a Chain to react to.

## Under the hood

Everything runs on the real `@riftbound/engine` (`buildScenario` → `getLegalActions` /
`applyAction`) and `@riftbound/cards` catalog — no mocks. What you see is exactly what the engine does.
