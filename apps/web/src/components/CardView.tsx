import { motion } from "motion/react";
import { Swords, Zap, Gem, ChevronUp, Hourglass, ZapOff, Sparkles } from "lucide-react";
import type { CardDef } from "@riftbound/engine";
import { colorHex } from "@/lib/domains.js";
import { cn } from "@/lib/utils.js";

interface CardViewProps {
  def: CardDef;
  size?: "sm" | "md";
  exhausted?: boolean;
  selected?: boolean;
  playable?: boolean;
  faceDown?: boolean;
  disabled?: boolean;
  targetable?: boolean;
  buffed?: boolean;
  temporary?: boolean;
  stunned?: boolean;
  /** A small standalone "activate ability" affordance — distinct from `onClick` (which is often
   *  already claimed by move/play selection), so an ability can be cast without conflicting with
   *  the card's main click behavior. */
  castable?: boolean;
  castSelected?: boolean;
  onCast?: () => void;
  onClick?: () => void;
  onInspect?: (def: CardDef | null) => void;
}

export function CardView({
  def,
  size = "md",
  exhausted,
  selected,
  playable,
  faceDown,
  disabled,
  targetable,
  buffed,
  temporary,
  stunned,
  castable,
  castSelected,
  onCast,
  onClick,
  onInspect,
}: CardViewProps) {
  const accent = colorHex(def.colors[0]);
  const dims = size === "sm" ? "h-24 w-[68px]" : "h-32 w-[92px]";
  const isUnit = def.type === "unit";

  if (faceDown) {
    return (
      <div className={cn(dims, "shrink-0 rounded-lg border border-primary/20 bg-[repeating-linear-gradient(135deg,hsl(245_40%_18%)_0_8px,hsl(245_40%_14%)_8px_16px)] shadow-inner")} />
    );
  }

  return (
    <motion.button
      layout
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => onInspect?.(def)}
      onMouseLeave={() => onInspect?.(null)}
      whileHover={disabled ? { scale: 1.04 } : { y: -8, scale: 1.03 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={cn(dims, "group relative shrink-0 overflow-hidden rounded-lg border text-left shadow-md", disabled ? "cursor-default" : "cursor-pointer")}
      style={{
        // `rotate` lives in `style` (a Framer motion value), not `animate` — combined with the
        // `layout` prop above, an `animate`-driven rotate can get stuck until another animation
        // cycle nudges it (only resolving on the next hover/click), while `style.rotate` composes
        // correctly with layout's own FLIP transform and always tracks `exhausted` reliably.
        rotate: exhausted ? 90 : 0,
        borderColor: selected ? "hsl(var(--ring))" : targetable ? "hsl(0 80% 60%)" : `${accent}66`,
        boxShadow: selected
          ? "0 0 0 2px hsl(var(--ring)), 0 8px 24px -8px hsl(var(--ring) / 0.6)"
          : targetable
            ? "0 0 0 2px hsl(0 80% 60%), 0 0 18px -4px hsl(0 80% 60%)"
            : playable
              ? `0 0 0 1px ${accent}, 0 0 18px -6px ${accent}`
              : "none",
        // Two layers, NOT one alpha-blended gradient: a solid opaque base (`hsl(...)`, no alpha)
        // sits behind the accent tint. A single gradient whose first stop is a low-alpha color
        // (e.g. `${accent}22`) blends with whatever is BEHIND the element on the page — when
        // cards overlap (fanned hand, stacked battlefield units), the card underneath bled
        // through the top of the one in front. Layering an opaque color as the bottom background
        // makes the tint composite against THAT instead, so the card is opaque at every pixel.
        background: `linear-gradient(180deg, ${accent}22, transparent 45%), hsl(224 30% 10%)`,
      }}
    >
      <div className="relative h-1/2 w-full overflow-hidden" style={{ background: `radial-gradient(120% 100% at 50% 0%, ${accent}55, transparent 70%), hsl(224 30% 14%)` }}>
        {def.image && (
          <img src={def.image} alt="" loading="lazy" className="h-full w-full object-cover object-top opacity-90" />
        )}
      </div>
      <div className="px-1.5 pt-1 text-[10px] font-semibold leading-tight text-foreground line-clamp-2">{def.name}</div>

      {/* Costs (top-left): energy, and power below if any */}
      <div className="absolute left-1 top-1 flex flex-col gap-0.5">
        <span className="flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-sky-300 backdrop-blur">
          <Zap className="!size-2.5" style={{ color: "hsl(214 90% 65%)" }} />
          {def.energy}
        </span>
        {def.power > 0 && (
          <span className="flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-violet-300 backdrop-blur">
            <Gem className="!size-2.5" style={{ color: "hsl(275 70% 68%)" }} />
            {def.power}
          </span>
        )}
      </div>

      {/* Might (bottom-right, units only) */}
      {isUnit && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-rose-200 backdrop-blur">
          {def.might}
          <Swords className="!size-2.5" style={{ color: "hsl(0 80% 66%)" }} />
        </div>
      )}

      {/* Status badges (top-right): Buff / Temporary / Stunned. */}
      {(buffed || temporary || stunned) && (
        <div className="absolute right-1 top-1 flex flex-col gap-0.5">
          {buffed && (
            <span title="Buffed (+1 Might)" className="flex items-center justify-center rounded-full bg-emerald-500/80 p-0.5">
              <ChevronUp className="!size-2.5 text-black" />
            </span>
          )}
          {temporary && (
            <span title="Temporary — dies at the start of its controller's next Beginning Phase" className="flex items-center justify-center rounded-full bg-amber-500/80 p-0.5">
              <Hourglass className="!size-2.5 text-black" />
            </span>
          )}
          {stunned && (
            <span title="Stunned — deals no combat damage this turn" className="flex items-center justify-center rounded-full bg-slate-400/80 p-0.5">
              <ZapOff className="!size-2.5 text-black" />
            </span>
          )}
        </div>
      )}

      {/* A standalone "activate ability" affordance, independent of the card's main onClick. */}
      {castable && (
        <button
          type="button"
          title="Activate ability"
          onClick={(e) => {
            e.stopPropagation();
            onCast?.();
          }}
          className="absolute -bottom-1 -left-1 flex size-5 items-center justify-center rounded-full border shadow-md transition-transform hover:scale-110"
          style={{
            borderColor: castSelected ? "hsl(var(--ring))" : "hsl(45 95% 55% / 0.8)",
            background: castSelected ? "hsl(var(--ring))" : "hsl(45 95% 20%)",
            boxShadow: castSelected ? "0 0 10px -2px hsl(var(--ring))" : "none",
          }}
        >
          <Sparkles className="!size-2.5 text-amber-100" />
        </button>
      )}
    </motion.button>
  );
}
