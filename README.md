# Riftbound Online

An iterative, browser-based client for **Riftbound** (the League of Legends TCG), starting with
**Set 1 (Origins)** — with a first-class goal of **training a bot to play against**.

The guiding architectural decision: the game rules live in a **pure, deterministic, serializable
TypeScript engine**, not in the UI. The same engine renders the UI, drives the bot, and (later)
runs thousands of headless games per second for self-play / reinforcement learning.

## Status: Phase 1 — playable local vs bot ✅

A **reduced** Riftbound rules slice is fully playable in the browser against a heuristic bot:
energy, playing units, moving to battlefields, combat, battlefield control, and scoring to 8.
This is deliberately simplified (no spells/gear/runes-as-cards, no full stack/priority yet) but
built on the real interfaces so it grows without rework. See
`~/.claude/plans/i-want-to-create-radiant-wind.md` for the full plan.

## Monorepo layout

```
packages/
  shared/   Domain vocabulary (domains, card types, ids) shared everywhere
  engine/   Pure TS rules engine — state, actions, rng, encode, serialize (THE core)
  cards/    Starter decks (offline) + Riftcodex Set 1 data pipeline
  bot/      Policies: RandomPolicy, HeuristicPolicy (MCTS/NN-guided later)
apps/
  web/      React 19 + Vite + Tailwind v4 UI — you vs bot, engine runs client-side
  sim/      Headless harness: pit policies against each other (seed of self-play)
training/   Python PyTorch trainer (later phase; empty for now)
```

## Engine contract (the boundary the UI and every bot share)

```ts
getLegalActions(state, player): Action[]   // enumerable, discrete
applyAction(state, action): GameState      // pure (Immer), validated
isTerminal(state): boolean
getReward(state, player): number           // +1 win / -1 loss / 0 draw
encodeState(state, player): Float32Array   // engine<->neural-net boundary
serialize / deserialize / replay           // deterministic replay for RL + debugging
```

Determinism is a hard requirement (seeded RNG, no `Math.random` in the engine): same seed + same
action log ⇒ identical final state. This is what makes replays and self-play reproducible.

## Getting started

```bash
pnpm install

pnpm --filter @riftbound/web dev      # play in the browser at http://localhost:5173
pnpm --filter @riftbound/engine test  # engine rules + determinism tests (Vitest)
pnpm sim                              # headless: heuristic vs random win rates
pnpm -r typecheck                     # typecheck the whole workspace
```

### Refresh Set 1 card data (optional, hits the network)

```bash
pnpm --filter @riftbound/cards fetch   # caches Origins to packages/cards/data/origins.json
```

Only card *data* is cached — no card art (Riot IP). Runtime never calls the API.

## Roadmap (next)

- Grow the engine toward full Riftbound: spells, gear, runes-as-cards, and the stack + priority
  windows for triggered abilities (the `stack.ts` / `triggers.ts` subsystems).
- Wire real Set 1 cards from the Riftcodex snapshot into engine definitions.
- Bot: MCTS over the action interface → self-play in `apps/sim` (JSONL records) → PyTorch
  trainer in `training/` exporting ONNX → NN-guided MCTS via onnxruntime-node.
- Later: authoritative multiplayer server (the engine is already authoritative-ready).
