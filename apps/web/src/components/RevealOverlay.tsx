import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Coins, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { HUMAN, useGame } from "@/store.js";

/** Coin-flip reveal of the (engine-decided, random) first player before the duel starts. */
export function RevealOverlay() {
  const game = useGame((s) => s.game);
  const confirmReveal = useGame((s) => s.confirmReveal);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), 1400);
    return () => window.clearTimeout(t);
  }, []);

  if (!game) return null;
  const youFirst = game.firstPlayer === HUMAN;

  return (
    <motion.div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex flex-col items-center gap-6 text-center">
        <motion.div
          className="flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-900 shadow-[0_0_60px_-10px_hsl(var(--primary))]"
          initial={{ rotateY: 0 }}
          animate={{ rotateY: settled ? 900 : 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          style={{ transformStyle: "preserve-3d" }}
        >
          <Coins className="size-12 text-white" />
        </motion.div>

        {settled ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="text-3xl font-black tracking-tight">
              {youFirst ? "You go first" : "Opponent goes first"}
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              {youFirst
                ? "You take the initiative. Your opponent channels an extra rune on their first turn to compensate."
                : "You go second — you channel an extra rune on your first turn to compensate."}
            </p>
            <Button size="lg" className="mt-2" onClick={confirmReveal}>
              Enter the Rift
              <ChevronRight />
            </Button>
          </motion.div>
        ) : (
          <div className="text-lg font-semibold text-muted-foreground">Flipping for initiative…</div>
        )}
      </div>
    </motion.div>
  );
}
