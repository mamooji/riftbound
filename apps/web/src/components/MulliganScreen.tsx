import { useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, Loader2 } from "lucide-react";
import { CardView } from "@/components/CardView.js";
import { Button } from "@/components/ui/button.js";
import { HUMAN, useGame } from "@/store.js";

const MAX_MULLIGAN = 2;

/** Return up to 2 opening-hand cards to the deck and redraw, before the real first turn begins. */
export function MulliganScreen() {
  const game = useGame((s) => s.game);
  const playAction = useGame((s) => s.playAction);
  const botThinking = useGame((s) => s.botThinking);
  const [selection, setSelection] = useState<Set<number>>(new Set());

  if (!game) return null;
  const yourTurn = game.mulligan.pending === HUMAN;
  const hand = game.players[HUMAN].hand;

  function toggle(iid: number) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else if (next.size < MAX_MULLIGAN) next.add(iid);
      return next;
    });
  }

  function confirm() {
    playAction({ type: "mulligan", iids: [...selection] });
    setSelection(new Set());
  }

  return (
    <motion.div
      className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/90 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="text-center">
        <h2 className="text-2xl font-black tracking-tight">Mulligan</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {yourTurn
            ? `Pick up to ${MAX_MULLIGAN} cards to shuffle back and redraw.`
            : "Waiting for the opponent to decide…"}
        </p>
      </div>

      {yourTurn ? (
        <>
          <div className="flex gap-3">
            {hand.map((iid) => (
              <CardView
                key={iid}
                def={game.defs[game.instances[iid as number]!.defId]!}
                selected={selection.has(iid as number)}
                onClick={() => toggle(iid as number)}
              />
            ))}
          </div>
          <Button size="lg" onClick={confirm}>
            {selection.size === 0 ? "Keep hand" : `Mulligan ${selection.size} card${selection.size > 1 ? "s" : ""}`}
            <ChevronRight />
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className={botThinking ? "size-4 animate-spin" : "size-4"} />
          Opponent is deciding…
        </div>
      )}
    </motion.div>
  );
}
