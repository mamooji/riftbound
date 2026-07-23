/**
 * UI state store. The engine's GameState is the source of truth; this adds the pre-game flow and
 * drives the bot — including when the bot must decide a mulligan, assign Showdown damage as the
 * DEFENDER, or act on its own turn (it acts whenever it is the "acting player").
 */
import { create } from "zustand";
import {
  applyAction,
  createGame,
  getLegalActions,
  type Action,
  type DeckDefinition,
  type GameState,
} from "@riftbound/engine";
import { HeuristicPolicy, actingPlayer } from "@riftbound/bot";
import {
  BATTLEFIELD_POOL,
  DECKS_BY_ID,
  DECK_LIST,
  type StarterDeckId,
} from "@riftbound/cards";
import type { CardColor } from "@riftbound/shared";

export const HUMAN = 0 as const;
export const BOT = 1 as const;
const BOT_STEP_MS = 650;

export type Phase = "setup" | "deckbuilder" | "reveal" | "mulligan" | "playing";

export interface DeckChoice {
  deck: DeckDefinition;
  label: string;
  color: CardColor;
}

let bot = new HeuristicPolicy(1);

function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function starterChoice(id: StarterDeckId): DeckChoice {
  const m = DECKS_BY_ID[id];
  return { deck: m.deck, label: m.name, color: m.domain };
}

interface UiStore {
  phase: Phase;
  deck: DeckChoice | null;
  battlefieldId: string | null;
  botDeckLabel: string | null;
  botColor: CardColor;
  game: GameState | null;
  botThinking: boolean;

  setStarter: (id: StarterDeckId) => void;
  setCustomDeck: (deck: DeckDefinition, label: string, color: CardColor) => void;
  setBattlefield: (id: string) => void;
  openDeckBuilder: () => void;
  beginDuel: () => void;
  confirmReveal: () => void;
  playAction: (action: Action) => void;
  backToSetup: () => void;
}

export const useGame = create<UiStore>((set, get) => {
  /**
   * Advances the game whenever the BOT is the acting player — a mulligan decision, a Showdown
   * damage assignment, or a normal turn action — then hands control back once it's the human's
   * turn to decide. Also flips the "mulligan" phase to "playing" once both sides have resolved.
   */
  function pump(): void {
    const { game, phase } = get();
    if (!game || game.winner !== null) {
      set({ botThinking: false });
      return;
    }
    if (phase === "mulligan" && game.mulligan.pending === null) {
      set({ phase: "playing" });
    }
    if (actingPlayer(game) !== BOT) {
      set({ botThinking: false });
      return;
    }
    set({ botThinking: true });
    const action = bot.choose(game, BOT);
    const next = applyAction(game, action);
    set({ game: next });
    if (get().phase === "mulligan" && next.mulligan.pending === null) set({ phase: "playing" });
    window.setTimeout(pump, BOT_STEP_MS);
  }

  return {
    phase: "setup",
    deck: null,
    battlefieldId: null,
    botDeckLabel: null,
    botColor: "fury",
    game: null,
    botThinking: false,

    setStarter: (id) => set({ deck: starterChoice(id) }),
    setCustomDeck: (deck, label, color) => set({ deck: { deck, label, color }, phase: "setup" }),
    setBattlefield: (id) => set({ battlefieldId: id }),
    openDeckBuilder: () => set({ phase: "deckbuilder" }),

    beginDuel: () => {
      const { deck, battlefieldId } = get();
      if (!deck || !battlefieldId) return;

      const botMeta = DECK_LIST[randInt(DECK_LIST.length)]!;
      const botBf = BATTLEFIELD_POOL[randInt(BATTLEFIELD_POOL.length)]!;
      const humanBf = BATTLEFIELD_POOL.find((b) => b.id === battlefieldId)!;
      const seed = randInt(1e9);
      bot = new HeuristicPolicy(seed ^ 0x5bd1e995);

      const game = createGame([deck.deck, botMeta.deck], {
        seed,
        battlefields: [humanBf, botBf],
      });

      set({
        botDeckLabel: botMeta.name,
        botColor: botMeta.domain,
        game,
        phase: "reveal",
        botThinking: false,
      });
    },

    confirmReveal: () => {
      set({ phase: "mulligan" });
      pump();
    },

    playAction: (action) => {
      const { game } = get();
      if (!game || game.winner !== null) return;
      if (actingPlayer(game) !== HUMAN) return;
      set({ game: applyAction(game, action) });
      pump();
    },

    backToSetup: () => set({ phase: "setup", game: null, botThinking: false }),
  };
});

/** Legal actions for the human right now (play/move/float/end, mulligan, or Showdown assignment). */
export function humanLegalActions(game: GameState): Action[] {
  return getLegalActions(game, HUMAN);
}
