import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Zap, Gem, Trophy, Layers, Hand as HandIcon, MapPin, RotateCcw, Swords, Crown, Sparkles, X, Check } from "lucide-react";
import {
  ALL_TRIGGERS,
  maxEnergy,
  maxPower,
  needsAssignment,
  windowIsOpen,
  type CardDef,
  type CardInstance,
  type GameState,
} from "@riftbound/engine";
import { renderCardText } from "@riftbound/cards";
import { VICTORY_POINTS_TO_WIN, type CardColor, type PlayerId } from "@riftbound/shared";
import { colorHex } from "@/lib/domains.js";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { CardView } from "@/components/CardView.js";
import { BOT, HUMAN, humanLegalActions, useGame } from "@/store.js";

function inZone(g: GameState, player: PlayerId, zone: CardInstance["zone"], bf?: number): CardInstance[] {
  return Object.values(g.instances).filter(
    (i) => i.controller === player && i.zone === zone && (bf === undefined || i.battlefield === bf),
  );
}
function unitsAtBf(g: GameState, player: PlayerId, bf: number): CardInstance[] {
  return inZone(g, player, "battlefield", bf).filter((i) => g.defs[i.defId]!.type === "unit");
}
function mightAt(g: GameState, player: PlayerId, bf: number): number {
  return unitsAtBf(g, player, bf).reduce((s, i) => s + g.defs[i.defId]!.might, 0);
}

export function Board() {
  const game = useGame((s) => s.game)!;
  const botThinking = useGame((s) => s.botThinking);
  const humanColor = useGame((s) => s.deck?.color ?? "calm");
  const botColor = useGame((s) => s.botColor);
  const playAction = useGame((s) => s.playAction);
  const backToSetup = useGame((s) => s.backToSetup);
  const [inspected, setInspected] = useState<CardDef | null>(null);

  // Which of the human's own units are selected to move together, which hand/Champion-Zone card
  // is selected to play at a battlefield, and which on-board source (legend/unit/gear) is selected
  // to activate an ability that needs a target. All three are view-only (not engine state) and
  // mutually exclusive — selecting one clears the others — cleared whenever a new turn begins.
  const [selectedUnits, setSelectedUnits] = useState<Set<number>>(new Set());
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedAbility, setSelectedAbility] = useState<number | null>(null);
  useEffect(() => {
    setSelectedUnits(new Set());
    setSelectedCard(null);
    setSelectedAbility(null);
  }, [game.turn, game.activePlayer]);

  const legal = useMemo(() => humanLegalActions(game), [game]);
  const playable = useMemo(() => new Set(legal.filter((a) => a.type === "playCard").map((a) => a.iid)), [legal]);
  // [Hidden] (rule 727): cards in hand that can be hidden facedown, and the union used to decide
  // which hand cards are interactive at all.
  const hideable = useMemo(() => new Set(legal.filter((a) => a.type === "hide").map((a) => a.iid)), [legal]);
  const handInteractive = useMemo(() => new Set([...playable, ...hideable]), [playable, hideable]);
  const movable = useMemo(
    () => new Set(legal.filter((a) => a.type === "moveUnits").map((a) => a.iids[0]!)),
    [legal],
  );
  const assignable = useMemo(() => new Set(legal.filter((a) => a.type === "assignDamage").map((a) => a.targetIid)), [legal]);
  const canEndTurn = legal.some((a) => a.type === "endTurn");
  const floatE = legal.find((a) => a.type === "floatEnergy");
  const floatP = legal.find((a) => a.type === "floatPower");

  // Activated abilities (Seals, legend abilities, a handful of unit/gear abilities): a source is
  // "castable" if any activateAbility action exists for it — with a target, cast selects it and
  // waits for a target click; without one, clicking casts it immediately.
  const abilityActions = useMemo(() => legal.filter((a) => a.type === "activateAbility"), [legal]);
  const castableNoTarget = useMemo(() => new Set(abilityActions.filter((a) => a.targetIid === undefined).map((a) => a.sourceIid)), [abilityActions]);
  const castableWithTarget = useMemo(() => new Set(abilityActions.filter((a) => a.targetIid !== undefined).map((a) => a.sourceIid)), [abilityActions]);
  const abilityTargets = useMemo(
    () =>
      new Set(
        selectedAbility !== null
          ? abilityActions
              .filter((a) => a.sourceIid === selectedAbility)
              .map((a) => a.targetIid)
              .filter((t): t is number => t !== undefined)
          : [],
      ),
    [abilityActions, selectedAbility],
  );
  function clickCast(iid: number) {
    if (castableNoTarget.has(iid)) {
      playAction({ type: "activateAbility", sourceIid: iid });
      return;
    }
    if (!castableWithTarget.has(iid)) return;
    setSelectedUnits(new Set());
    setSelectedCard(null);
    setSelectedAbility(selectedAbility === iid ? null : iid);
  }
  function clickAbilityTarget(targetIid: number): boolean {
    if (selectedAbility === null || !abilityTargets.has(targetIid)) return false;
    playAction({ type: "activateAbility", sourceIid: selectedAbility, targetIid });
    setSelectedAbility(null);
    return true;
  }

  // A pending optional/choice-needing trigger (e.g. Volibear's "may exhaust to channel a rune")
  // awaiting the human's decision — gates all other actions until resolved, same as a mulligan or
  // Showdown assignment.
  const pendingForHuman = game.pendingTrigger?.player === HUMAN ? game.pendingTrigger : null;

  const humanAssigning = game.showdown !== null && needsAssignment(game, HUMAN);
  const humanTurn = game.activePlayer === HUMAN && game.winner === null && game.showdown === null;
  // A Showdown's pre-combat Action Window (rule 340-345): the human holds Focus and may play an
  // [Action]/[Reaction] spell, or Pass -- can happen even when it's NOT their turn (defending).
  const humanHasFocus =
    game.showdown !== null && windowIsOpen(game.showdown) && game.priority === HUMAN;
  // A Closed State (a Chain exists, rule 309.1): the human holds Priority and may respond with a
  // [Reaction] spell before the pending spell resolves — even on the bot's turn.
  const humanCanReact = game.chain.length > 0 && game.priority === HUMAN && game.winner === null;
  const canPass = legal.some((a) => a.type === "pass");

  /** True if this hand/Champion-Zone card has at least one legal battlefield destination (i.e.
   *  playing it is worth a "select, then pick a battlefield" interaction). Units you already
   *  control a battlefield with (or that allow an open one) get this; spells/gear/units with
   *  nowhere to go yet don't, and just play straight to base on a single click. */
  function hasBattlefieldOption(iid: number): boolean {
    return legal.some(
      (a) =>
        (a.type === "playCard" && a.iid === iid && a.battlefield !== undefined) ||
        (a.type === "hide" && a.iid === iid),
    );
  }
  function toggleCardSelect(iid: number) {
    if (!playable.has(iid) && !hideable.has(iid)) return;
    if (!hasBattlefieldOption(iid)) {
      playAction({ type: "playCard", iid }); // no battlefield/hide choice -> just play it
      return;
    }
    if (selectedCard === iid) {
      // Clicking the selected card again plays it to base (only if it's actually playable now;
      // a hide-only card just deselects).
      if (playable.has(iid)) playAction({ type: "playCard", iid });
      setSelectedCard(null);
    } else {
      setSelectedCard(iid);
      setSelectedUnits(new Set());
    }
  }

  /** A battlefield is a valid destination if every selected unit can legally move there, or the
   *  selected hand/Champion-Zone card can be played directly there. */
  function canMoveHere(bfIndex: number): boolean {
    return (
      selectedUnits.size > 0 &&
      [...selectedUnits].every((iid) =>
        legal.some((a) => a.type === "moveUnits" && a.iids[0] === iid && a.to === bfIndex),
      )
    );
  }
  /** True if every selected unit can retreat to base (a Standard Move — no Ganking needed). */
  function canRetreat(): boolean {
    return (
      selectedUnits.size > 0 &&
      [...selectedUnits].every((iid) =>
        legal.some((a) => a.type === "moveUnits" && a.iids[0] === iid && a.to === "base"),
      )
    );
  }
  function canPlayHere(bfIndex: number): boolean {
    return (
      selectedCard !== null &&
      legal.some((a) => a.type === "playCard" && a.iid === selectedCard && a.battlefield === bfIndex)
    );
  }
  /** The selected [Hidden] card can be hidden facedown at this battlefield (rule 727). */
  function canHideHere(bfIndex: number): boolean {
    return (
      selectedCard !== null &&
      legal.some((a) => a.type === "hide" && a.iid === selectedCard && a.battlefield === bfIndex)
    );
  }
  function clickBattlefield(bfIndex: number) {
    if (canPlayHere(bfIndex)) {
      playAction({ type: "playCard", iid: selectedCard!, battlefield: bfIndex });
      setSelectedCard(null);
      return;
    }
    if (canHideHere(bfIndex)) {
      playAction({ type: "hide", iid: selectedCard!, battlefield: bfIndex });
      setSelectedCard(null);
      return;
    }
    if (!canMoveHere(bfIndex)) return;
    playAction({ type: "moveUnits", iids: [...selectedUnits], to: bfIndex });
    setSelectedUnits(new Set());
  }
  function clickBase() {
    if (!canRetreat()) return;
    playAction({ type: "moveUnits", iids: [...selectedUnits], to: "base" });
    setSelectedUnits(new Set());
  }
  function toggleSelectUnit(iid: number) {
    if (!movable.has(iid)) return;
    setSelectedCard(null);
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      next.has(iid) ? next.delete(iid) : next.add(iid);
      return next;
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-1.5 px-4 py-2">
      <PlayerPanel
        game={game} player={BOT} color={botColor} active={game.activePlayer === BOT && game.winner === null}
        thinking={botThinking} onInspect={setInspected} abilityTargets={abilityTargets} onAbilityTarget={clickAbilityTarget}
      />
      <RunePool game={game} player={BOT} />
      <FaceDownHand count={inZone(game, BOT, "hand").length} />
      <BaseRow game={game} player={BOT} onInspect={setInspected} abilityTargets={abilityTargets} onAbilityTarget={clickAbilityTarget} />

      <div className="my-1 grid grid-cols-2 gap-4">
        {game.battlefields.map((bf) => (
          <BattlefieldView
            key={bf.index}
            game={game}
            bf={bf.index}
            def={game.defs[bf.defId]!}
            name={bf.name}
            controller={bf.controller}
            isShowdown={game.showdown?.battlefield === bf.index}
            selectable={canMoveHere(bf.index) || canPlayHere(bf.index) || canHideHere(bf.index)}
            onClick={() => clickBattlefield(bf.index)}
            humanColor={humanColor}
            botColor={botColor}
            playableFacedown={playable}
            onPlayFacedown={(iid) => playAction({ type: "playCard", iid })}
            movable={movable}
            assignable={humanAssigning ? assignable : undefined}
            selectedUnits={selectedUnits}
            onSelectUnit={toggleSelectUnit}
            onAssign={(tid) => playAction({ type: "assignDamage", targetIid: tid })}
            onInspectDef={setInspected}
            castableNoTarget={castableNoTarget}
            castableWithTarget={castableWithTarget}
            selectedAbility={selectedAbility}
            onCast={clickCast}
            abilityTargets={abilityTargets}
            onAbilityTarget={clickAbilityTarget}
          />
        ))}
      </div>

      <BaseRow
        game={game}
        player={HUMAN}
        selectedUnits={selectedUnits}
        movable={movable}
        onUnitClick={toggleSelectUnit}
        onInspect={setInspected}
        selectable={canRetreat()}
        onClick={clickBase}
        castableNoTarget={castableNoTarget}
        castableWithTarget={castableWithTarget}
        selectedAbility={selectedAbility}
        onCast={clickCast}
        abilityTargets={abilityTargets}
        onAbilityTarget={clickAbilityTarget}
      />
      <RunePool
        game={game}
        player={HUMAN}
        onFloatEnergy={humanTurn && floatE ? () => playAction(floatE) : undefined}
        onFloatPower={humanTurn && floatP ? () => playAction(floatP) : undefined}
      />
      <PlayerPanel
        game={game}
        player={HUMAN}
        color={humanColor}
        active={humanTurn}
        onInspect={setInspected}
        championPlayable={playable}
        championSelected={selectedCard}
        onChampionClick={toggleCardSelect}
        castableNoTarget={castableNoTarget}
        castableWithTarget={castableWithTarget}
        selectedAbility={selectedAbility}
        onCast={clickCast}
        abilityTargets={abilityTargets}
        onAbilityTarget={clickAbilityTarget}
      />

      <HandFan
        game={game}
        humanTurn={humanTurn || humanHasFocus || humanCanReact}
        playable={handInteractive}
        selectedCard={selectedCard}
        onPlay={toggleCardSelect}
        onInspect={setInspected}
      />

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={backToSetup}><RotateCcw /> New duel</Button>
          <StatusText game={game} humanTurn={humanTurn} humanAssigning={humanAssigning} humanHasFocus={humanHasFocus} humanCanReact={humanCanReact} selectedCount={selectedUnits.size} cardSelected={selectedCard !== null} />
        </div>
        {humanHasFocus || humanCanReact ? (
          <Button size="lg" variant="secondary" disabled={!canPass} onClick={() => playAction({ type: "pass" })}>
            <X /> Pass
          </Button>
        ) : (
          <Button size="lg" disabled={!humanTurn || !canEndTurn} onClick={() => playAction({ type: "endTurn" })}>End turn</Button>
        )}
      </div>

      <GameLog log={game.log} />

      <CardPreview def={inspected} />
      <AnimatePresence>
        {pendingForHuman && (
          <PendingTriggerOverlay
            game={game}
            pending={pendingForHuman}
            onResolve={(accept, targetIid, battlefield) => playAction({ type: "resolveTrigger", accept, targetIid, battlefield })}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{game.winner !== null && <WinnerOverlay winner={game.winner} onNew={backToSetup} />}</AnimatePresence>
    </div>
  );
}

/** A "may"/choice-needing triggered ability awaiting the human's decision (e.g. Volibear's "you
 *  may exhaust me to channel a rune", or choosing which unit Leona buffs) — styled like the
 *  Mulligan/Showdown-assignment sub-decisions it's modeled the same way as in the engine. */
function PendingTriggerOverlay({
  game, pending, onResolve,
}: {
  game: GameState; pending: NonNullable<GameState["pendingTrigger"]>; onResolve: (accept: boolean, targetIid?: number, battlefield?: number) => void;
}) {
  const spec = ALL_TRIGGERS[pending.kind];
  const source = game.instances[pending.sourceIid as number];
  const sourceName = source ? game.defs[source.defId]!.name : "An ability";
  // Exclude anything already picked this sequence (a "may spend" / "up to N" trigger like Kinkou
  // Monk's) -- the engine's own getLegalActions/resolvePendingTrigger already filter these out, so
  // this has to match or a click on an already-picked target throws "invalid target" and silently
  // fails (the state update never lands, so the modal looks frozen).
  const rawTargets = spec?.legalTargets?.(game, pending.player, pending.sourceIid) ?? null;
  const targets = rawTargets?.filter((t) => !pending.picked.includes(t)) ?? null;
  // Battlefield-targeted effects (e.g. Firestorm's "deal 3 to all enemy units at a battlefield")
  // choose a Battlefield instead of a game object -- mutually exclusive with `legalTargets`.
  const battlefields = spec?.legalBattlefields?.(game, pending.player, pending.sourceIid) ?? null;
  return (
    <motion.div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-7 text-center shadow-2xl" initial={{ scale: 0.9, y: 10 }} animate={{ scale: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-amber-300"><Sparkles className="size-5" /><span className="text-sm font-bold uppercase tracking-wide">Ability triggered</span></div>
        <div className="text-base font-semibold">{sourceName}</div>
        {battlefields && battlefields.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">Choose a battlefield:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {battlefields.map((bf) => (
                <Button key={bf} variant="secondary" onClick={() => onResolve(true, undefined, bf)}>
                  <MapPin /> {game.battlefields[bf]!.name}
                </Button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onResolve(false)}><X /> Skip</Button>
          </>
        ) : targets && targets.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">Choose a target:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {targets.map((t) => {
                const inst = game.instances[t as number]!;
                return (
                  <CardView
                    key={t}
                    def={game.defs[inst.defId]!}
                    size="sm"
                    exhausted={inst.exhausted}
                    onClick={() => onResolve(true, t as number)}
                  />
                );
              })}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onResolve(false)}><X /> Skip</Button>
          </>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onResolve(false)}><X /> Skip</Button>
            <Button onClick={() => onResolve(true)}><Check /> Use it</Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Fixed side panel showing the full card the player is hovering (name, costs, Might, rules). */
function CardPreview({ def }: { def: CardDef | null }) {
  if (!def) return null;
  const accent = colorHex(def.colors[0]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-20 w-56 overflow-hidden rounded-xl border bg-card shadow-2xl" style={{ borderColor: `${accent}88` }}>
      {/* Battlefield card art is landscape and prints its rules text twice (once upside-down, so
          it reads correctly from both sides of the table) — scale up and crop to the center so
          neither text bar shows; portrait unit/legend/rune art crops from the top as usual. */}
      {def.image && (
        <div className="h-40 w-full overflow-hidden">
          <img
            src={def.image}
            alt=""
            className={cn("h-full w-full object-cover", def.type === "battlefield" ? "scale-150 object-center" : "object-top")}
          />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold">{def.name}</span>
          <span className="flex items-center gap-1 text-[11px] font-bold">
            <Zap className="size-3 text-sky-300" />{def.energy}
            {def.power > 0 && <><Gem className="size-3 text-violet-300" />{def.power}</>}
            {def.type === "unit" && <><Swords className="size-3 text-rose-300" />{def.might}</>}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{def.type}</div>
        {def.text && <p className="mt-2 text-[11px] leading-relaxed text-foreground/90">{renderCardText(def.text)}</p>}
      </div>
    </div>
  );
}

function StatusText({ game, humanTurn, humanAssigning, humanHasFocus, humanCanReact, selectedCount, cardSelected }: { game: GameState; humanTurn: boolean; humanAssigning: boolean; humanHasFocus: boolean; humanCanReact: boolean; selectedCount: number; cardSelected: boolean }) {
  let text = "Opponent is playing…";
  if (game.winner !== null) text = "";
  else if (humanCanReact) text = "A spell is on the Chain — respond with a [Reaction] from your hand, or Pass to let it resolve.";
  else if (humanHasFocus) text = "You have Focus — play an Action/Reaction spell from your hand, or Pass.";
  else if (humanAssigning) text = `Showdown! Assign ${game.showdown!.remaining[HUMAN]} damage — click an enemy unit (lethal before wounding).`;
  else if (humanTurn) {
    if (selectedCount > 0) text = `${selectedCount} unit${selectedCount > 1 ? "s" : ""} selected — pick a battlefield to move in, or click Base to retreat.`;
    else if (cardSelected) text = "Pick a battlefield to play it there, or click it again to play to base.";
    else text = "Play cards, then click units to select them and a battlefield to move in. Float ⚡/◆ from your runes.";
  }
  return <p className="hidden text-xs text-muted-foreground sm:block">{text}</p>;
}

function PlayerPanel({
  game, player, color, active, thinking, onInspect, championPlayable, championSelected, onChampionClick,
  castableNoTarget, castableWithTarget, selectedAbility, onCast, abilityTargets, onAbilityTarget,
}: {
  game: GameState; player: PlayerId; color: CardColor; active: boolean; thinking?: boolean;
  onInspect: (def: CardDef | null) => void;
  championPlayable?: Set<number>; championSelected?: number | null; onChampionClick?: (iid: number) => void;
  castableNoTarget?: Set<number>; castableWithTarget?: Set<number>; selectedAbility?: number | null; onCast?: (iid: number) => void;
  abilityTargets?: Set<number>; onAbilityTarget?: (iid: number) => boolean;
}) {
  const p = game.players[player];
  const c = colorHex(color);
  const isBot = player === BOT;
  const legend = game.defs[p.legendDefId];
  const legendInst = game.instances[p.legendIid as number];
  const legendIid = legendInst?.iid as number | undefined;
  const legendTargetable = legendIid !== undefined && (abilityTargets?.has(legendIid) ?? false);
  const legendCastable = legendIid !== undefined && ((castableNoTarget?.has(legendIid) ?? false) || (castableWithTarget?.has(legendIid) ?? false));
  const championInst = p.championZone !== null ? game.instances[p.championZone as number] : null;
  return (
    <motion.div layout className="flex items-center justify-between rounded-xl border px-3 py-1.5" style={{ borderColor: active ? "hsl(var(--ring))" : "hsl(var(--border))", background: active ? "linear-gradient(90deg, hsl(var(--primary)/0.16), transparent)" : "hsl(var(--card))" }}>
      <div className="flex items-center gap-3">
        {legend && legendInst && (
          <CardView
            def={legend}
            size="sm"
            exhausted={legendInst.exhausted}
            targetable={legendTargetable}
            castable={legendCastable}
            castSelected={legendIid !== undefined && selectedAbility === legendIid}
            onCast={() => legendIid !== undefined && onCast?.(legendIid)}
            onClick={legendTargetable && legendIid !== undefined ? () => onAbilityTarget?.(legendIid) : undefined}
            onInspect={onInspect}
          />
        )}
        {championInst && (
          <div className="flex flex-col items-center gap-0.5">
            <CardView
              def={game.defs[championInst.defId]!}
              size="sm"
              selected={championSelected === (championInst.iid as number)}
              disabled={!championPlayable?.has(championInst.iid as number)}
              playable={championPlayable?.has(championInst.iid as number)}
              onClick={() => onChampionClick?.(championInst.iid as number)}
              onInspect={onInspect}
            />
            <span className="flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              <Crown className="size-2" /> champion zone
            </span>
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {isBot ? "Opponent" : "You"}
            <span className="text-xs font-normal" style={{ color: c }}>{legend?.name.split(" - ")[0]}</span>
            {thinking && <span className="animate-pulse text-xs text-muted-foreground">thinking…</span>}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Crown className="size-3" /> Legend {isBot ? "· bot" : ""}</div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 text-sm">
        <ScoreBadge points={p.points} />
        <div className="h-6 w-px bg-border" />
        <Stat icon={<Zap className="size-3.5 text-sky-300" />} value={`${maxEnergy(game, player)}`} title="Available Energy (ready runes + floated)" />
        <Stat icon={<Gem className="size-3.5 text-violet-300" />} value={`${maxPower(game, player)}`} title="Available Power (recyclable runes + floated)" />
        <Stat icon={<HandIcon className="size-3.5 text-muted-foreground" />} value={`${p.hand.length}`} title="Cards in hand" />
        <Stat icon={<Layers className="size-3.5 text-muted-foreground" />} value={`${p.mainDeck.length}`} title="Main deck" />
      </div>
    </motion.div>
  );
}

/** The win-condition tracker — deliberately louder than the secondary stats beside it: bigger
 *  type, a warm gold treatment, and a fill bar toward the 8-point target. */
function ScoreBadge({ points }: { points: number }) {
  const pct = Math.min(100, (points / VICTORY_POINTS_TO_WIN) * 100);
  const close = points >= VICTORY_POINTS_TO_WIN - 2;
  return (
    <div
      title="Victory points — first to 8 wins"
      className="relative flex items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 py-1"
      style={{
        borderColor: close ? "hsl(45 95% 55% / 0.7)" : "hsl(45 95% 55% / 0.35)",
        background: "linear-gradient(90deg, hsl(45 95% 12%), hsl(45 60% 8%))",
        boxShadow: close ? "0 0 16px -4px hsl(45 95% 55% / 0.6)" : "none",
      }}
    >
      <div className="absolute inset-y-0 left-0 bg-amber-400/20" style={{ width: `${pct}%` }} />
      <Trophy className={cn("relative size-4", close ? "text-amber-300" : "text-amber-400/80")} />
      <span className="relative text-base font-black tabular-nums text-amber-200">{points}</span>
      <span className="relative text-[10px] font-semibold text-amber-200/50">/{VICTORY_POINTS_TO_WIN}</span>
    </div>
  );
}

function Stat({ icon, value, title }: { icon: ReactNode; value: string; title: string }) {
  return <span title={title} className="flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-1 font-semibold tabular-nums">{icon}{value}</span>;
}

function RunePool({ game, player, onFloatEnergy, onFloatPower }: { game: GameState; player: PlayerId; onFloatEnergy?: () => void; onFloatPower?: () => void }) {
  const p = game.players[player];
  const runes = p.runePool.map((iid) => game.instances[iid as number]!);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-black/20 px-2 py-1">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">runes</span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {runes.length === 0 && <span className="text-[10px] text-muted-foreground/50">none channeled</span>}
        {runes.map((r) => (
          <RuneChip key={r.iid} def={game.defs[r.defId]!} exhausted={r.exhausted} />
        ))}
      </div>
      {(p.energy > 0 || p.power > 0) && (
        <span className="text-[10px] text-muted-foreground">floated ⚡{p.energy} ◆{p.power}</span>
      )}
      {(onFloatEnergy || onFloatPower) && (
        <div className="flex gap-1">
          <button onClick={onFloatEnergy} disabled={!onFloatEnergy} className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200 enabled:hover:bg-sky-500/30 disabled:opacity-30">+⚡</button>
          <button onClick={onFloatPower} disabled={!onFloatPower} className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 enabled:hover:bg-violet-500/30 disabled:opacity-30">+◆</button>
        </div>
      )}
    </div>
  );
}

/** A compact physical rune card (real art, domain-tinted border) instead of an abstract dot. */
function RuneChip({ def, exhausted }: { def: CardDef; exhausted: boolean }) {
  const accent = colorHex(def.colors[0]);
  return (
    <div
      title={`${def.name} — ${exhausted ? "exhausted" : "ready"}`}
      className="h-10 w-7 shrink-0 overflow-hidden rounded-md border shadow-sm transition-[rotate,opacity] duration-200"
      style={{ borderColor: `${accent}99`, rotate: exhausted ? "90deg" : "0deg", opacity: exhausted ? 0.55 : 1 }}
    >
      {def.image ? (
        <img src={def.image} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        <div className="h-full w-full" style={{ background: accent }} />
      )}
    </div>
  );
}

function FaceDownHand({ count }: { count: number }) {
  return (
    <div className="flex justify-center">
      <div className="flex -space-x-8">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="h-10 w-[52px] shrink-0 rounded-md border border-primary/20 bg-[repeating-linear-gradient(135deg,hsl(245_40%_18%)_0_8px,hsl(245_40%_14%)_8px_16px)] shadow-inner" style={{ transform: `rotate(${(i - (count - 1) / 2) * 3}deg)` }} />
        ))}
      </div>
    </div>
  );
}

/** Facedown [Hidden] cards staged at a battlefield (rule 727). Rendered as card backs; the human's
 *  own facedown cards that are currently playable get a highlight and a click-to-play handler. */
function FacedownRow({ game, bf, playable, onPlay }: {
  game: GameState; bf: number; playable?: Set<number>; onPlay?: (iid: number) => void;
}) {
  const cards = Object.values(game.instances).filter((i) => i.zone === "facedown" && i.battlefield === bf);
  if (cards.length === 0) return null;
  return (
    <div className="flex justify-center gap-1">
      {cards.map((i) => {
        const iid = i.iid as number;
        const canPlay = i.controller === HUMAN && (playable?.has(iid) ?? false);
        return (
          <button
            key={iid}
            type="button"
            disabled={!canPlay}
            onClick={(e) => { e.stopPropagation(); if (canPlay) onPlay?.(iid); }}
            title={canPlay ? "Play this hidden card (ignores its cost)" : "A hidden card"}
            className="h-9 w-[26px] shrink-0 rounded-[4px] border bg-[repeating-linear-gradient(135deg,hsl(245_40%_18%)_0_6px,hsl(245_40%_14%)_6px_12px)] shadow-inner transition-transform"
            style={{
              borderColor: canPlay ? "hsl(var(--ring))" : "hsl(var(--border))",
              boxShadow: canPlay ? "0 0 0 2px hsl(var(--ring))" : undefined,
              cursor: canPlay ? "pointer" : "default",
            }}
          >
            <Sparkles className="mx-auto size-3 text-primary/70" />
          </button>
        );
      })}
    </div>
  );
}

function BattlefieldView(props: {
  game: GameState; bf: number; def: CardDef; name: string; controller: PlayerId | null; isShowdown: boolean;
  selectable: boolean; onClick: () => void; humanColor: CardColor; botColor: CardColor;
  playableFacedown?: Set<number>; onPlayFacedown?: (iid: number) => void;
  movable: Set<number>; assignable: Set<number> | undefined; selectedUnits: Set<number>;
  onSelectUnit: (iid: number) => void; onAssign: (tid: number) => void; onInspectDef: (def: CardDef | null) => void;
  castableNoTarget?: Set<number>; castableWithTarget?: Set<number>; selectedAbility?: number | null; onCast?: (iid: number) => void;
  abilityTargets?: Set<number>; onAbilityTarget?: (iid: number) => boolean;
}) {
  const { game, bf } = props;
  const controlColor = props.controller === HUMAN ? colorHex(props.humanColor) : props.controller === BOT ? colorHex(props.botColor) : null;
  return (
    <motion.div
      layout onClick={props.onClick}
      className="felt relative flex min-h-[220px] flex-col gap-1.5 overflow-hidden rounded-2xl border p-2.5 text-left transition-colors"
      style={{
        borderColor: props.selectable ? "hsl(var(--ring))" : props.isShowdown ? "hsl(0 80% 60%)" : controlColor ? `${controlColor}88` : "hsl(var(--border))",
        boxShadow: props.selectable ? "0 0 0 2px hsl(var(--ring)), inset 0 0 40px -20px hsl(var(--ring))" : props.isShowdown ? "0 0 0 2px hsl(0 80% 60%), inset 0 0 50px -18px hsl(0 80% 55%)" : "none",
        cursor: props.selectable ? "pointer" : "default",
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 text-xs font-semibold"
          onMouseEnter={(e) => { e.stopPropagation(); props.onInspectDef(props.def); }}
          onMouseLeave={() => props.onInspectDef(null)}
        >
          {props.def.image ? (
            <div className="size-5 shrink-0 overflow-hidden rounded ring-1 ring-primary/40">
              <img src={props.def.image} alt="" className="h-full w-full scale-150 object-cover object-center" />
            </div>
          ) : (
            <MapPin className="size-3.5 text-primary/80" />
          )}
          {props.name}
        </div>
        {props.isShowdown ? <span className="flex items-center gap-1 rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-200"><Swords className="size-3" />showdown</span> : <ControlBadge controller={props.controller} />}
      </div>
      <FacedownRow game={game} bf={bf} playable={props.playableFacedown} onPlay={props.onPlayFacedown} />
      <UnitRow
        game={game} player={BOT} bf={bf} own={false} assignable={props.assignable} onAssign={props.onAssign}
        movable={props.movable} selectedUnits={props.selectedUnits} onSelectUnit={props.onSelectUnit} onInspectDef={props.onInspectDef}
        castableNoTarget={props.castableNoTarget} castableWithTarget={props.castableWithTarget} selectedAbility={props.selectedAbility}
        onCast={props.onCast} abilityTargets={props.abilityTargets} onAbilityTarget={props.onAbilityTarget}
      />
      <div className="flex items-center justify-center gap-2 text-[11px] font-bold tabular-nums">
        <span style={{ color: colorHex(props.botColor) }}>{mightAt(game, BOT, bf)}</span>
        <span className="text-muted-foreground">vs</span>
        <span style={{ color: colorHex(props.humanColor) }}>{mightAt(game, HUMAN, bf)}</span>
      </div>
      <UnitRow
        game={game} player={HUMAN} bf={bf} own color={props.humanColor} assignable={props.assignable} onAssign={props.onAssign}
        movable={props.movable} selectedUnits={props.selectedUnits} onSelectUnit={props.onSelectUnit} onInspectDef={props.onInspectDef}
        castableNoTarget={props.castableNoTarget} castableWithTarget={props.castableWithTarget} selectedAbility={props.selectedAbility}
        onCast={props.onCast} abilityTargets={props.abilityTargets} onAbilityTarget={props.onAbilityTarget}
      />
    </motion.div>
  );
}

/** Renders the actual physical cards at a battlefield (same as base), not abstract pills. */
function UnitRow(props: {
  game: GameState; player: PlayerId; bf: number; own?: boolean; color?: CardColor;
  assignable: Set<number> | undefined; onAssign: (tid: number) => void;
  movable: Set<number>; selectedUnits: Set<number>; onSelectUnit: (iid: number) => void;
  onInspectDef: (def: CardDef | null) => void;
  castableNoTarget?: Set<number>; castableWithTarget?: Set<number>; selectedAbility?: number | null; onCast?: (iid: number) => void;
  abilityTargets?: Set<number>; onAbilityTarget?: (iid: number) => boolean;
}) {
  const units = unitsAtBf(props.game, props.player, props.bf);
  return (
    <div className="flex min-h-[104px] flex-wrap content-start justify-center gap-1">
      <AnimatePresence>
        {units.map((i) => {
          const iid = i.iid as number;
          const abilityTargetable = props.abilityTargets?.has(iid) ?? false;
          const targetable = (props.assignable?.has(iid) ?? false) || abilityTargetable;
          const selectable = !!props.own && props.movable.has(iid);
          const castable = !!props.own && ((props.castableNoTarget?.has(iid) ?? false) || (props.castableWithTarget?.has(iid) ?? false));
          const def = props.game.defs[i.defId]!;
          const onClick = props.assignable?.has(iid)
            ? () => props.onAssign(iid)
            : abilityTargetable
              ? () => props.onAbilityTarget?.(iid)
              : selectable
                ? () => props.onSelectUnit(iid)
                : undefined;
          return (
            <motion.div
              key={iid}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              onClick={(e) => e.stopPropagation()} // don't let a card click also trigger the battlefield's move-here handler
            >
              <CardView
                def={def}
                size="sm"
                exhausted={i.exhausted}
                buffed={i.buffed}
                temporary={i.temporary}
                stunned={i.stunned}
                selected={props.selectedUnits.has(iid)}
                targetable={targetable}
                disabled={!targetable && !selectable && !castable}
                castable={castable}
                castSelected={props.selectedAbility === iid}
                onCast={() => props.onCast?.(iid)}
                onClick={onClick}
                onInspect={props.onInspectDef}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function ControlBadge({ controller }: { controller: PlayerId | null }) {
  if (controller === null) return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">contested</span>;
  const you = controller === HUMAN;
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: you ? "hsl(152 55% 50% / 0.2)" : "hsl(0 72% 58% / 0.2)", color: you ? "hsl(152 60% 60%)" : "hsl(0 75% 68%)" }}>{you ? "you hold" : "bot holds"}</span>;
}

function BaseRow(props: {
  game: GameState; player: PlayerId;
  selectedUnits?: Set<number>; movable?: Set<number>; onUnitClick?: (iid: number) => void;
  onInspect: (def: CardDef | null) => void;
  /** Whether clicking empty space here (a retreat target for selected battlefield units) is legal. */
  selectable?: boolean;
  onClick?: () => void;
  castableNoTarget?: Set<number>; castableWithTarget?: Set<number>; selectedAbility?: number | null; onCast?: (iid: number) => void;
  abilityTargets?: Set<number>; onAbilityTarget?: (iid: number) => boolean;
}) {
  const cards = inZone(props.game, props.player, "base");
  const isBot = props.player === BOT;
  const isOwn = props.player !== BOT;
  return (
    <div
      onClick={props.onClick}
      className="flex min-h-[62px] items-center gap-1.5 rounded-xl border px-2 py-1 transition-colors"
      style={{
        borderColor: props.selectable ? "hsl(var(--ring))" : "hsl(var(--border) / 0.6)",
        background: props.selectable ? "hsl(var(--ring) / 0.08)" : "rgba(0,0,0,0.2)",
        boxShadow: props.selectable ? "0 0 0 2px hsl(var(--ring)), inset 0 0 30px -18px hsl(var(--ring))" : "none",
        cursor: props.selectable ? "pointer" : "default",
      }}
    >
      <span className="mr-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">{isBot ? "opp base" : "base"}</span>
      <AnimatePresence>
        {cards.map((i) => {
          const iid = i.iid as number;
          const abilityTargetable = props.abilityTargets?.has(iid) ?? false;
          const movable = props.movable?.has(iid) ?? false;
          const castable = isOwn && ((props.castableNoTarget?.has(iid) ?? false) || (props.castableWithTarget?.has(iid) ?? false));
          const onClick = abilityTargetable ? () => props.onAbilityTarget?.(iid) : () => props.onUnitClick?.(iid);
          return (
            <motion.div key={i.iid} layout initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
              <CardView
                def={props.game.defs[i.defId]!}
                size="sm"
                exhausted={i.exhausted}
                buffed={i.buffed}
                temporary={i.temporary}
                stunned={i.stunned}
                selected={props.selectedUnits?.has(iid) ?? false}
                targetable={abilityTargetable}
                disabled={!movable && !abilityTargetable && !castable}
                playable={movable}
                castable={castable}
                castSelected={props.selectedAbility === iid}
                onCast={() => props.onCast?.(iid)}
                onClick={onClick}
                onInspect={props.onInspect}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function HandFan({
  game, humanTurn, playable, selectedCard, onPlay, onInspect,
}: {
  game: GameState; humanTurn: boolean; playable: Set<number>; selectedCard: number | null;
  onPlay: (iid: number) => void; onInspect: (def: CardDef | null) => void;
}) {
  const hand = inZone(game, HUMAN, "hand");
  const center = (hand.length - 1) / 2;
  return (
    <div className="flex min-h-28 items-end justify-center">
      <div className="flex -space-x-2">
        <AnimatePresence>
          {hand.map((i, idx) => (
            <motion.div key={i.iid} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: Math.abs(idx - center) * 4 }} exit={{ opacity: 0, y: 24 }} style={{ transform: `rotate(${(idx - center) * 3}deg)`, transformOrigin: "bottom center" }} className="hover:z-10">
              <CardView
                def={game.defs[i.defId]!}
                selected={selectedCard === (i.iid as number)}
                disabled={!humanTurn || !playable.has(i.iid as number)}
                playable={humanTurn && playable.has(i.iid as number)}
                onClick={() => onPlay(i.iid as number)}
                onInspect={onInspect}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function GameLog({ log }: { log: string[] }) {
  const recent = log.slice(-5);
  return (
    <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
      {recent.length === 0 ? <span className="text-muted-foreground/50">Game log…</span> : recent.map((l, idx) => <div key={idx}>{l}</div>)}
    </div>
  );
}

function WinnerOverlay({ winner, onNew }: { winner: PlayerId | "draw"; onNew: () => void }) {
  const text = winner === "draw" ? "Draw!" : winner === HUMAN ? "Victory! 🎉" : "Defeat";
  const win = winner === HUMAN;
  return (
    <motion.div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-12 py-9 text-center shadow-2xl" initial={{ scale: 0.9, y: 10 }} animate={{ scale: 1, y: 0 }}>
        <div className="text-3xl font-black tracking-tight" style={{ color: win ? "hsl(152 60% 55%)" : winner === "draw" ? undefined : "hsl(0 72% 62%)" }}>{text}</div>
        <Button size="lg" onClick={onNew}>Play again</Button>
      </motion.div>
    </motion.div>
  );
}
