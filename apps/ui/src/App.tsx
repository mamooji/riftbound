import { useEffect, useMemo, useState } from "react";
import {
  applyAction,
  buildScenario,
  effectiveMight,
  getLegalActions,
  type Action,
  type CardInstance,
  type GameState,
} from "@riftbound/engine";
import { allDefs, inventory, CATEGORIES, type Category, type TestCard } from "./inventory.ts";
import {
  defaultBoard,
  presetForCard,
  priorityDemo,
  toScenarioConfig,
  type Builder,
  type BuilderSeat,
  type PlaceZone,
  type Seat,
} from "./scenario.ts";
import { actionKey, actionLabel, cardName, phaseLabel, whoActs } from "./labels.ts";
import { getNote, loadNotes, saveNotes, toMarkdown, type Notes, type Status } from "./notes.ts";

const INV = inventory();
const LEGENDS = INV.filter((c) => c.category === "Legends");
const DEFS = allDefs();
const ALL_CARD_OPTS = Object.values(DEFS)
  .filter((d) => d.type !== "battlefield" && d.type !== "rune")
  .sort((a, b) => a.name.localeCompare(b.name));

export function App() {
  const [builder, setBuilder] = useState<Builder>(() => defaultBoard());
  const [game, setGame] = useState<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]);
  const [actingSeat, setActingSeat] = useState<Seat>(0);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"builder" | "checklist">("builder");
  const [notes, setNotes] = useState<Notes>(loadNotes);

  useEffect(() => saveNotes(notes), [notes]);

  function build(b: Builder = builder) {
    try {
      const s = buildScenario(toScenarioConfig(b));
      setGame(s);
      setHistory([]);
      setActingSeat((whoActs(s) ?? 0) as Seat);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function apply(a: Action) {
    if (!game) return;
    try {
      const next = applyAction(game, a);
      setHistory((h) => [...h, game]);
      setGame(next);
      const w = whoActs(next);
      if (w !== null) setActingSeat(w as Seat);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setGame(h[h.length - 1]!);
      return h.slice(0, -1);
    });
  }

  function loadCard(card: TestCard) {
    const b = presetForCard(card);
    setBuilder(b);
    build(b);
    setTab("builder");
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>Riftbound Test Bench</h1>
        <span className="phase">{game ? phaseLabel(game) : "no game built"}</span>
        <div className="spacer" />
        <button onClick={() => build()}>▶ Build / Rebuild</button>
        <button onClick={undo} disabled={history.length === 0}>
          ↺ Undo ({history.length})
        </button>
        <button onClick={() => { const b = priorityDemo(); setBuilder(b); build(b); }}>⚡ Priority demo</button>
      </div>

      <div className="body">
        <div className="col left">
          <div className="tabs">
            <button className={tab === "builder" ? "active" : ""} onClick={() => setTab("builder")}>Scenario builder</button>
            <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}>Checklist ({INV.length})</button>
          </div>
          {tab === "builder" ? (
            <BuilderPanel builder={builder} setBuilder={setBuilder} onBuild={build} />
          ) : (
            <ChecklistPanel notes={notes} setNotes={setNotes} onLoad={loadCard} />
          )}
        </div>

        <div className="col mid">
          {game ? (
            <>
              <Banners state={game} />
              <div className="row" style={{ alignItems: "stretch" }}>
                <SeatView state={game} seat={0} />
                <SeatView state={game} seat={1} />
              </div>
              <h4 style={{ margin: "10px 0 4px" }}>Log</h4>
              <div className="log">
                {game.log.length === 0 ? <span className="muted">(empty)</span> : null}
                {game.log.slice(-60).map((l, i) => (
                  <div className="entry" key={i}>{l}</div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Build a scenario (left) or pick a card from the checklist to test.</p>
          )}
        </div>

        <div className="col right">
          {game && <ActionsPanel state={game} actingSeat={actingSeat} setActingSeat={setActingSeat} apply={apply} />}
          {error && <div className="err">⚠ {error}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Game view
// ---------------------------------------------------------------------------------------------

function Banners({ state }: { state: GameState }) {
  return (
    <>
      {state.winner !== null && <div className="banner win">🏆 {phaseLabel(state)}</div>}
      {state.pendingTrigger && (
        <div className="banner pending">
          ⏳ Pending: <code>{state.pendingTrigger.kind}</code> — P{state.pendingTrigger.player} decides
        </div>
      )}
      {state.chain.length > 0 && (
        <div className="banner chain">
          🔗 Chain (top → bottom): {state.chain.slice().reverse().map((c) => cardName(state, c.sourceIid as number) + (c.countered ? " [countered]" : "")).join("  ·  ")}
          {" — "}P{state.priority} has priority
        </div>
      )}
      {state.showdown && (
        <div className="banner showdown">
          ⚔ Showdown @ {state.battlefields[state.showdown.battlefield]?.name} — attacker P{state.showdown.attacker}
          {state.showdown.toAssign === null
            ? ` · Action Window open (Focus P${state.priority})`
            : ` · damage ${state.showdown.remaining.join("/")}, P${state.showdown.toAssign} assigns`}
        </div>
      )}
    </>
  );
}

function SeatView({ state, seat }: { state: GameState; seat: Seat }) {
  const p = state.players[seat];
  const isTurn = state.activePlayer === seat;
  const legend = state.instances[p.legendIid as number]!;
  const inZone = (zone: string, bf?: number) =>
    Object.values(state.instances).filter(
      (i) => i.controller === seat && i.zone === zone && (bf === undefined || i.battlefield === bf),
    );
  const runeReady = p.runePool.filter((iid) => !state.instances[iid]!.exhausted).length;

  return (
    <div className={`seat card ${seat === 0 ? "p0" : "p1"}`} style={{ flex: 1 }}>
      <h3>
        P{seat}
        <span className={`badge ${seat === 0 ? "p0" : "p1"}`}>pts {p.points}</span>
        {isTurn && <span className="badge turn">turn</span>}
      </h3>
      <div className="small muted" style={{ margin: "4px 0" }}>
        ⚡{p.energy}e · 🔆{p.power}p · runes {runeReady}/{p.runePool.length} ready · float [{p.floatingRunes.join(",") || "—"}]
        {p.playedCardThisTurn ? " · played✓" : ""}
      </div>
      <Zone label="Legend"><Chip state={state} inst={legend} /></Zone>
      {p.championZone !== null && <Zone label="Champion"><Chip state={state} inst={state.instances[p.championZone as number]!} /></Zone>}
      <Zone label={`Hand (${p.hand.length})`}>{p.hand.map((iid) => <Chip key={iid} state={state} inst={state.instances[iid]!} />)}</Zone>
      <Zone label="Base">{inZone("base").map((i) => <Chip key={i.iid} state={state} inst={i} />)}</Zone>
      <Zone label={`${state.battlefields[0]?.name ?? "Field 0"}${state.battlefields[0]?.controller === seat ? " ✓" : ""}`}>
        {inZone("battlefield", 0).map((i) => <Chip key={i.iid} state={state} inst={i} />)}
      </Zone>
      <Zone label={`${state.battlefields[1]?.name ?? "Field 1"}${state.battlefields[1]?.controller === seat ? " ✓" : ""}`}>
        {inZone("battlefield", 1).map((i) => <Chip key={i.iid} state={state} inst={i} />)}
      </Zone>
      {inZone("facedown").length > 0 && <Zone label="Hidden (facedown)">{inZone("facedown").map((i) => <Chip key={i.iid} state={state} inst={i} />)}</Zone>}
      <div className="small muted">trash {Object.values(state.instances).filter((i) => i.owner === seat && i.zone === "trash").length} · deck {p.mainDeck.length}</div>
    </div>
  );
}

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <div className="zone">
      <div className="zlabel">{label}</div>
      <div className="chips">{arr.length === 0 ? <span className="muted small">—</span> : children}</div>
    </div>
  );
}

function Chip({ state, inst }: { state: GameState; inst: CardInstance }) {
  const def = state.defs[inst.defId]!;
  const isUnit = def.type === "unit";
  const might = isUnit ? effectiveMight(state, inst, undefined) : null;
  const icons: string[] = [];
  if (inst.exhausted) icons.push("💤");
  if (inst.buffed) icons.push("＋");
  if (inst.stunned) icons.push("✶");
  if (inst.temporary) icons.push("⧗");
  if (inst.damage > 0) icons.push(`🩸${inst.damage}`);
  return (
    <span className={`chip ${def.type}`} title={def.text}>
      {def.name}
      {might !== null ? <span className="ic">⚔{might}</span> : null}
      {icons.length ? <span className="ic">{icons.join("")}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

function ActionsPanel({
  state,
  actingSeat,
  setActingSeat,
  apply,
}: {
  state: GameState;
  actingSeat: Seat;
  setActingSeat: (s: Seat) => void;
  apply: (a: Action) => void;
}) {
  const suggested = whoActs(state);
  // Surface the interesting moves first; the many float/pass/end actions sink to the bottom.
  const ORDER: Record<Action["type"], number> = {
    resolveTrigger: 0, assignDamage: 1, playCard: 2, activateAbility: 3, moveUnits: 4,
    hide: 5, mulligan: 6, pass: 7, floatEnergy: 8, floatPower: 9, endTurn: 10,
  };
  const actions = [...getLegalActions(state, actingSeat)].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  return (
    <div className="actions">
      <h3>Actions</h3>
      <div className="acting">
        <span className="muted small">Act as</span>
        {[0, 1].map((s) => (
          <button key={s} className={actingSeat === s ? "primary" : ""} onClick={() => setActingSeat(s as Seat)}>
            P{s}
            {suggested === s ? " ●" : ""}
          </button>
        ))}
      </div>
      {suggested !== null && suggested !== actingSeat && (
        <div className="hint">It's P{suggested}'s decision — switch to act, or pass priority as the other seat.</div>
      )}
      {actions.length === 0 ? (
        <p className="muted small">No legal actions for P{actingSeat} right now.</p>
      ) : (
        actions.map((a) => (
          <button key={actionKey(a)} onClick={() => apply(a)}>
            {actionLabel(state, a)}
          </button>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

function BuilderPanel({
  builder,
  setBuilder,
  onBuild,
}: {
  builder: Builder;
  setBuilder: (b: Builder) => void;
  onBuild: (b: Builder) => void;
}) {
  function patchSeat(seat: Seat, patch: Partial<BuilderSeat>) {
    const seats = [...builder.seats] as [BuilderSeat, BuilderSeat];
    seats[seat] = { ...seats[seat], ...patch };
    setBuilder({ ...builder, seats });
  }
  return (
    <div>
      <p className="hint">
        Place any card in any zone for either player, set resources, then Build. Both seats start with ⚡12/🔆12, ready runes of
        every color, and 3 floating rainbow runes, so cost is rarely the blocker.
      </p>
      <label className="field small" style={{ marginBottom: 8 }}>
        Active player
        <select value={builder.activePlayer} onChange={(e) => setBuilder({ ...builder, activePlayer: Number(e.target.value) as Seat })}>
          <option value={0}>P0</option>
          <option value={1}>P1</option>
        </select>
      </label>
      {[0, 1].map((s) => (
        <SeatEditor key={s} seat={s as Seat} data={builder.seats[s as Seat]} patch={(p) => patchSeat(s as Seat, p)} />
      ))}
      <button className="primary" style={{ width: "100%" }} onClick={() => onBuild(builder)}>
        ▶ Build this scenario
      </button>
    </div>
  );
}

function SeatEditor({ seat, data, patch }: { seat: Seat; data: BuilderSeat; patch: (p: Partial<BuilderSeat>) => void }) {
  const [zone, setZone] = useState<PlaceZone>(seat === 0 ? "hand" : "base");
  const [bf, setBf] = useState(0);
  const [q, setQ] = useState("");
  const matches = q.trim()
    ? ALL_CARD_OPTS.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10)
    : [];

  function addCard(defId: string) {
    patch({ cards: [...data.cards, { defId, zone, battlefield: zone === "battlefield" ? bf : undefined }] });
    setQ("");
  }
  function removeCard(idx: number) {
    patch({ cards: data.cards.filter((_, i) => i !== idx) });
  }

  return (
    <div className={`card seat ${seat === 0 ? "p0" : "p1"}`}>
      <h4>P{seat}</h4>
      <label className="field small">
        Legend
        <select value={data.legendDefId} onChange={(e) => patch({ legendDefId: e.target.value })}>
          {LEGENDS.map((l) => (
            <option key={l.defId} value={l.defId}>{l.name}</option>
          ))}
        </select>
      </label>
      <div className="row small" style={{ margin: "6px 0" }}>
        <label className="field">⚡<input type="number" value={data.energy} onChange={(e) => patch({ energy: Number(e.target.value) })} /></label>
        <label className="field">🔆<input type="number" value={data.power} onChange={(e) => patch({ power: Number(e.target.value) })} /></label>
        <label className="field">pts<input type="number" value={data.points} onChange={(e) => patch({ points: Number(e.target.value) })} /></label>
        <label className="field"><input type="checkbox" checked={data.playedCardThisTurn} onChange={(e) => patch({ playedCardThisTurn: e.target.checked })} />played</label>
      </div>
      <div className="row small">
        <select value={zone} onChange={(e) => setZone(e.target.value as PlaceZone)}>
          {(["hand", "base", "battlefield", "championZone", "trash", "facedown"] as PlaceZone[]).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        {zone === "battlefield" && (
          <select value={bf} onChange={(e) => setBf(Number(e.target.value))}>
            <option value={0}>field 0</option>
            <option value={1}>field 1</option>
          </select>
        )}
        <input placeholder="search card…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      {matches.length > 0 && (
        <div className="chips" style={{ marginTop: 4 }}>
          {matches.map((d) => (
            <button key={d.id} className="small" onClick={() => addCard(d.id as string)}>+ {d.name}</button>
          ))}
        </div>
      )}
      <div className="chips" style={{ marginTop: 6 }}>
        {data.cards.map((c, i) => (
          <span key={i} className="chip">
            {DEFS[c.defId]?.name ?? c.defId} <span className="muted">{c.zone}{c.zone === "battlefield" ? c.battlefield : ""}</span>
            <button className="small" style={{ padding: "0 4px", marginLeft: 4 }} onClick={() => removeCard(i)}>×</button>
          </span>
        ))}
        {data.cards.length === 0 && <span className="muted small">no extra cards</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------------------------

function ChecklistPanel({
  notes,
  setNotes,
  onLoad,
}: {
  notes: Notes;
  setNotes: (n: Notes) => void;
  onLoad: (c: TestCard) => void;
}) {
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const [onlyUntested, setOnlyUntested] = useState(false);

  const list = useMemo(
    () =>
      INV.filter((c) => cat === "All" || c.category === cat)
        .filter((c) => !q.trim() || c.name.toLowerCase().includes(q.toLowerCase()))
        .filter((c) => !onlyUntested || getNote(notes, c.defId).status === "untested"),
    [cat, q, onlyUntested, notes],
  );

  function set(defId: string, patch: Partial<{ status: Status; note: string }>) {
    const cur = getNote(notes, defId);
    setNotes({ ...notes, [defId]: { ...cur, ...patch } });
  }

  const counts = { pass: 0, fail: 0, untested: 0 };
  for (const c of INV) counts[getNote(notes, c.defId).status]++;

  async function exportReport() {
    const md = toMarkdown(INV, notes);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      /* clipboard may be blocked; download still works */
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "riftbound-test-results.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <p className="hint">Pick a card → <b>Load</b> to auto-build a board for it, test it via the Actions panel, then mark ✅/❌ and note what you saw. Export copies a Markdown report to your clipboard (and downloads it) to paste back to Claude.</p>
      <div className="row small" style={{ marginBottom: 8 }}>
        <select value={cat} onChange={(e) => setCat(e.target.value as Category | "All")}>
          <option value="All">All ({INV.length})</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c} ({INV.filter((x) => x.category === c).length})</option>
          ))}
        </select>
        <input placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="row small" style={{ marginBottom: 8 }}>
        <label className="field"><input type="checkbox" checked={onlyUntested} onChange={(e) => setOnlyUntested(e.target.checked)} />untested only</label>
        <span className="spacer" />
        <span className="pill" style={{ color: "var(--pass)" }}>✅ {counts.pass}</span>
        <span className="pill" style={{ color: "var(--fail)" }}>❌ {counts.fail}</span>
        <span className="pill muted">⬜ {counts.untested}</span>
      </div>
      <button className="primary" style={{ width: "100%", marginBottom: 10 }} onClick={exportReport}>⬇ Export report (copy + download)</button>

      {list.map((c) => {
        const n = getNote(notes, c.defId);
        return (
          <div className="checkitem" key={c.defId}>
            <div className="row">
              <span className="name">{c.name}</span>
              <span className="pill muted">{c.type}</span>
              <span className="spacer" />
              <button className="small" onClick={() => onLoad(c)}>Load ▶</button>
            </div>
            <div className="small muted" title={c.text} style={{ margin: "2px 0 4px", maxHeight: 34, overflow: "hidden" }}>{c.text}</div>
            <div className="row stbtns">
              <button className={`on ${n.status === "pass" ? "pass" : ""}`} onClick={() => set(c.defId, { status: n.status === "pass" ? "untested" : "pass" })}>✅ pass</button>
              <button className={`on ${n.status === "fail" ? "fail" : ""}`} onClick={() => set(c.defId, { status: n.status === "fail" ? "untested" : "fail" })}>❌ fail</button>
            </div>
            <textarea placeholder="notes (what happened, what was wrong)…" value={n.note} onChange={(e) => set(c.defId, { note: e.target.value })} />
          </div>
        );
      })}
    </div>
  );
}
