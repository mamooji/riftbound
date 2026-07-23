import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Swords, ChevronRight, MapPin, Hammer, Crown } from "lucide-react";
import { BATTLEFIELD_POOL, DECK_LIST, renderCardText } from "@riftbound/cards";
import { DOMAIN_STYLES } from "@/lib/domains.js";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { useGame } from "@/store.js";

export function SetupScreen() {
  const deck = useGame((s) => s.deck);
  const battlefieldId = useGame((s) => s.battlefieldId);
  const setStarter = useGame((s) => s.setStarter);
  const setBattlefield = useGame((s) => s.setBattlefield);
  const beginDuel = useGame((s) => s.beginDuel);
  const openDeckBuilder = useGame((s) => s.openDeckBuilder);

  const ready = deck !== null && battlefieldId !== null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-black tracking-tight text-transparent"
        >
          RIFTBOUND
        </motion.h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set 1 · Origins — build your presence, contest the battlefields, race to 8.
        </p>
      </header>

      <Section
        step={1}
        title="Choose your deck"
        hint="Pick a starter, or build your own from all Set 1 cards."
        action={
          <Button variant="outline" size="sm" onClick={openDeckBuilder}>
            <Hammer /> Deck builder
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DECK_LIST.map((d) => {
            const ds = DOMAIN_STYLES[d.domain];
            const active = deck?.label === d.name;
            return (
              <motion.button
                key={d.id}
                whileHover={{ y: -4 }}
                onClick={() => setStarter(d.id)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 text-left transition-colors",
                  active ? "border-transparent" : "border-border hover:border-white/20",
                )}
                style={{
                  boxShadow: active ? `0 0 0 2px ${ds.color}, 0 12px 30px -12px ${ds.color}` : "none",
                  background: active ? `linear-gradient(180deg, ${ds.soft}, hsl(var(--card)))` : "hsl(var(--card))",
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-lg" style={{ background: ds.soft, color: ds.color }}>
                    <Swords className="size-4" />
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full" style={{ background: ds.color }}>
                      <Check className="size-3 text-black" />
                    </span>
                  )}
                </div>
                <div className="font-semibold">{d.name}</div>
                <Badge variant="muted" className="mt-1 w-fit" style={{ color: ds.color }}>{ds.label}</Badge>
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Crown className="size-3" /> {d.legendName}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{d.playstyle}</p>
              </motion.button>
            );
          })}
        </div>
        {deck && !DECK_LIST.some((d) => d.name === deck.label) && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            <Hammer className="size-4 text-primary" />
            Custom deck selected: <span className="font-semibold">{deck.label}</span>
          </div>
        )}
      </Section>

      <Section
        step={2}
        title="Present a battlefield"
        hint="You reveal one; your opponent reveals one — two battlefields are contested."
      >
        <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
          {BATTLEFIELD_POOL.map((b) => {
            const active = battlefieldId === b.id;
            return (
              <motion.button
                key={b.id}
                whileHover={{ y: -3 }}
                onClick={() => setBattlefield(b.id)}
                className={cn(
                  "relative flex h-32 flex-col justify-end overflow-hidden rounded-xl border text-left transition-colors",
                  active ? "border-primary" : "border-border hover:border-white/20",
                )}
                style={{ boxShadow: active ? "0 0 0 2px hsl(var(--ring))" : "none" }}
              >
                {b.image ? (
                  <img
                    src={b.image}
                    alt=""
                    className="absolute inset-0 h-full w-full scale-150 object-cover object-center"
                  />
                ) : (
                  <div className="felt absolute inset-0" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
                <div className="relative p-3">
                  <MapPin className="size-3.5 text-primary/90 drop-shadow" />
                  <div className="mt-0.5 text-sm font-semibold leading-tight text-white drop-shadow">{b.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-white/70">
                    {renderCardText(b.text)}
                  </div>
                </div>
                {active && (
                  <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary">
                    <Check className="size-3 text-primary-foreground" />
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </Section>

      <div className="mt-8 flex items-center justify-center">
        <Button size="lg" disabled={!ready} onClick={beginDuel} className="min-w-56">
          {ready ? "Begin duel" : "Pick a deck & battlefield"}
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  hint,
  action,
  children,
}: {
  step: number;
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-bold">{step}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="hidden text-xs text-muted-foreground sm:block">{hint}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}
