// The tuning panel. Motion is tuned by dragging, not by describing, so this is
// the deliverable of the motion step and not a garnish on it.
//
// It is a DOM overlay rather than canvas because forty live sliders on canvas is
// a widget toolkit nobody asked for, and because the browser already has one.
// It does not fit in a 420x300 postcard, so tuning mode borrows a bigger window
// through the same helper the gallery uses (window-size.ts) and gives it back on
// exit. The shipped window is never this size.
//
// The panel is a right-hand strip and the swarm is told to stay out from under
// it, so all forty are visible while their constants are being dragged. Judging
// motion you cannot see is the failure mode this is avoiding.

/**
 * One live constant. Getters and setters rather than an object-plus-key pair so
 * a knob can front anything — a nested config field, a derived value, a count
 * that has to reconcile a population.
 */
export interface Knob {
  group: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
  /** changing this invalidates pre-rendered art, not just the simulation */
  rebuild?: boolean;
  /** shown under the label when the number alone does not explain itself */
  hint?: string;
}

export interface TuningPanelOptions {
  knobs: Knob[];
  /** called after a `rebuild` knob changes, before the next frame */
  onRebuild(): void;
  /** current values as pasteable JSON */
  dump(): string;
}

export interface TuningPanel {
  visible(): boolean;
  toggle(): boolean;
  setVisible(v: boolean): void;
  /** pull config back into the inputs, for changes made from outside */
  sync(): void;
}

// The window tuning mode asks for, and how much of it the panel occupies. The
// width is set by the knob count: forty rows in one column needs a scrollbar and
// a wrist, two columns fits without either.
export const TUNING_SIZE = { width: 1120, height: 640 };
export const TUNING_PANEL_WIDTH = 520;
export const TUNING_PANEL_INSET = 8;

export function createTuningPanel(options: TuningPanelOptions): TuningPanel {
  const root = document.createElement("div");
  root.className = "tuner";
  root.style.width = `${TUNING_PANEL_WIDTH}px`;
  root.style.right = `${TUNING_PANEL_INSET}px`;
  root.style.top = `${TUNING_PANEL_INSET}px`;
  root.style.bottom = `${TUNING_PANEL_INSET}px`;

  // The whole window surface is draggable. Without this, dragging a slider
  // drags the widget across the desktop — the same class of bug as a butterfly
  // touch being swallowed, and the same fix: whatever the press landed on wins.
  root.addEventListener("mousedown", (e) => e.stopPropagation());

  const head = document.createElement("header");
  head.textContent = "flight · t to close";
  root.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "tuner-grid";
  root.appendChild(grid);

  const syncers: Array<() => void> = [];
  let currentGroup = "";
  let groupEl: HTMLElement | null = null;

  for (const knob of options.knobs) {
    if (knob.group !== currentGroup || !groupEl) {
      currentGroup = knob.group;
      groupEl = document.createElement("section");
      const h = document.createElement("h2");
      h.textContent = knob.group;
      groupEl.appendChild(h);
      grid.appendChild(groupEl);
    }
    groupEl.appendChild(buildRow(knob, options.onRebuild, syncers));
  }

  const foot = document.createElement("footer");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "copy config";
  const note = document.createElement("span");
  note.className = "tuner-note";
  foot.appendChild(copy);
  foot.appendChild(note);
  root.appendChild(foot);

  // Always shown as well as copied. The clipboard can fail quietly — an
  // unfocused document, a permission, a webview quirk — and an afternoon of
  // tuning that ends in a silently empty paste is not recoverable.
  const out = document.createElement("textarea");
  out.className = "tuner-out";
  out.readOnly = true;
  out.hidden = true;
  root.appendChild(out);

  copy.addEventListener("click", () => {
    const text = options.dump();
    out.value = text;
    out.hidden = false;
    out.select();
    navigator.clipboard?.writeText(text).then(
      () => {
        note.textContent = "copied";
      },
      () => {
        note.textContent = "clipboard refused — select below";
      },
    );
  });

  document.body.appendChild(root);

  let shown = false;

  function setVisible(v: boolean): void {
    shown = v;
    root.style.display = v ? "flex" : "none";
    if (v) sync();
  }

  function sync(): void {
    for (const s of syncers) s();
  }

  setVisible(false);

  return {
    visible: () => shown,
    setVisible,
    toggle: () => {
      setVisible(!shown);
      return shown;
    },
    sync,
  };
}

function buildRow(knob: Knob, onRebuild: () => void, syncers: Array<() => void>): HTMLElement {
  const row = document.createElement("label");
  row.className = "tuner-row";

  const name = document.createElement("span");
  name.className = "tuner-label";
  name.textContent = knob.label;
  if (knob.hint) name.title = knob.hint;
  row.appendChild(name);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(knob.min);
  range.max = String(knob.max);
  range.step = String(knob.step);
  row.appendChild(range);

  // The readout is an input, not a caption: dragging finds the value, typing
  // reproduces one from a config you already pasted somewhere.
  const num = document.createElement("input");
  num.type = "number";
  num.className = "tuner-num";
  num.min = String(knob.min);
  num.max = String(knob.max);
  num.step = String(knob.step);
  row.appendChild(num);

  const show = (v: number) => {
    range.value = String(v);
    num.value = String(round(v, knob.step));
  };

  const apply = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(knob.max, Math.max(knob.min, v));
    knob.set(clamped);
    show(clamped);
    if (knob.rebuild) onRebuild();
  };

  range.addEventListener("input", () => apply(range.value));
  num.addEventListener("change", () => apply(num.value));

  syncers.push(() => show(knob.get()));
  show(knob.get());
  return row;
}

// Keep the readout as short as the knob's own resolution, so a slider stepping
// by 0.01 does not report seventeen digits of float.
function round(v: number, step: number): number {
  const dp = Math.max(0, Math.ceil(-Math.log10(step || 1)));
  return Number(v.toFixed(Math.min(6, dp)));
}
