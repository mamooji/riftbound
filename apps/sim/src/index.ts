/**
 * Headless simulation harness.
 *
 * Today: pit two policies against each other over many seeded games and report win rates —
 * a fast sanity check that the engine loop is closed and that "smarter" policies actually win.
 * This is the seed of the self-play pipeline: swap in the NN-guided MCTS policy and dump
 * (state, policy, value) records instead of just tallying wins.
 *
 * Run:  pnpm sim   (from repo root)   or   pnpm --filter @riftbound/sim start
 */
import { createGame } from "@riftbound/engine";
import { HeuristicPolicy, RandomPolicy, runGame, type Policy } from "@riftbound/bot";
import { BATTLEFIELD_POOL, STARTER_DECKS } from "@riftbound/cards";

const GAMES = Number(process.env.GAMES ?? 200);

function playMatch(makeP0: () => Policy, makeP1: () => Policy, games: number) {
  const wins: [number, number] = [0, 0];
  let draws = 0;
  let totalPly = 0;
  for (let seed = 0; seed < games; seed++) {
    const state = createGame([STARTER_DECKS["viktor"], STARTER_DECKS["leesin"]], {
      seed,
      battlefields: [BATTLEFIELD_POOL[0]!, BATTLEFIELD_POOL[1]!],
    });
    const final = runGame(state, [makeP0(), makeP1()]);
    totalPly += final.ply;
    if (final.winner === "draw" || final.winner === null) draws++;
    else wins[final.winner]++;
  }
  return { wins, draws, avgPly: totalPly / games };
}

console.log(`Riftbound sim — ${GAMES} games per matchup\n`);

const random = playMatch(() => new RandomPolicy(), () => new RandomPolicy(), GAMES);
console.log(
  `random   vs random   : P0 ${random.wins[0]}  P1 ${random.wins[1]}  draws ${random.draws}  (avg ${random.avgPly.toFixed(0)} plies)`,
);

const heuristic = playMatch(
  (() => {
    let s = 100;
    return () => new HeuristicPolicy(s++);
  })(),
  (() => {
    let s = 500;
    return () => new RandomPolicy(s++);
  })(),
  GAMES,
);
console.log(
  `heuristic vs random  : P0 ${heuristic.wins[0]}  P1 ${heuristic.wins[1]}  draws ${heuristic.draws}  (avg ${heuristic.avgPly.toFixed(0)} plies)`,
);

const p0Rate = ((heuristic.wins[0] / GAMES) * 100).toFixed(1);
console.log(`\nHeuristic (P0) win rate vs Random: ${p0Rate}%`);
console.log(heuristic.wins[0] > heuristic.wins[1] ? "OK: heuristic beats random." : "WARN: heuristic not winning.");
