import { AnimatePresence } from "motion/react";
import { useGame } from "@/store.js";
import { SetupScreen } from "@/components/SetupScreen.js";
import { DeckBuilder } from "@/components/DeckBuilder.js";
import { Board } from "@/components/Board.js";
import { RevealOverlay } from "@/components/RevealOverlay.js";
import { MulliganScreen } from "@/components/MulliganScreen.js";

export function App() {
  const phase = useGame((s) => s.phase);
  const game = useGame((s) => s.game);

  return (
    <div className="min-h-screen">
      {phase === "deckbuilder" ? (
        <DeckBuilder />
      ) : phase === "setup" || !game ? (
        <SetupScreen />
      ) : (
        <Board />
      )}
      <AnimatePresence>{phase === "reveal" && <RevealOverlay />}</AnimatePresence>
      <AnimatePresence>{phase === "mulligan" && <MulliganScreen />}</AnimatePresence>
    </div>
  );
}
