import type { ProjectId } from "../projects/data";

export const MENUBAR_H = 24;
/** Space kept clear above the bottom edge for the Dock when zooming windows. */
export const DOCK_RESERVE = 78;

export type AppId = "finder" | "spotify" | "terminal";
export type FinderLocation = "root" | ProjectId;
export type WindowPhase = "opening" | "open" | "minimizing" | "restoring" | "closing";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  w: number;
  h: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Win {
  id: string;
  app: AppId;
  frame: Frame;
  /** The frame to go back to when a zoomed window is un-zoomed. */
  restoreFrame?: Frame;
  /** Animate the next frame change (zoom), as opposed to following the pointer. */
  animateFrame?: boolean;
  minimized: boolean;
  /** Sort key for the Dock's minimized-window area. */
  minimizedSeq?: number;
  phase: WindowPhase;
  /** Dock thumbnail the window is restoring from. */
  restoreFrom?: RectLike;
  /** Finder navigation history. */
  history: FinderLocation[];
  index: number;
}

export interface WMState {
  wins: Win[];
  /** Window ids, back to front. */
  order: string[];
  /** The key window, or null when the desktop itself has focus. */
  active: string | null;
  seq: number;
}

export type WMAction =
  | { type: "open"; app: AppId; location?: FinderLocation; frame: Frame; animate: boolean }
  | { type: "focus"; id: string }
  | { type: "blur" }
  | { type: "frame"; id: string; frame: Frame }
  | { type: "zoom"; id: string; full: Frame }
  | { type: "minimize"; id: string; animate: boolean }
  | { type: "restore"; id: string; from?: RectLike; animate: boolean }
  | { type: "close"; id: string; animate: boolean }
  | { type: "phaseEnd"; id: string; phase: WindowPhase }
  | { type: "navigate"; id: string; location: FinderLocation }
  | { type: "go"; id: string; delta: number }
  | { type: "clamp"; bounds: Bounds };

export const initialWMState: WMState = { wins: [], order: [], active: null, seq: 1 };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** Keep at least part of the title bar reachable: below the menu bar and on screen. */
export const clampFrame = (f: Frame, b: Bounds): Frame => {
  const w = Math.min(f.w, b.w);
  const h = Math.min(f.h, b.h - MENUBAR_H);
  return {
    w,
    h,
    x: clamp(f.x, -(w - 120), b.w - 120),
    y: clamp(f.y, MENUBAR_H, b.h - 44),
  };
};

export const isVisible = (w: Win) => !w.minimized && w.phase !== "minimizing" && w.phase !== "closing";

const topVisible = (state: WMState, exclude?: string) => {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const w = state.wins.find((x) => x.id === state.order[i]);
    if (w && w.id !== exclude && isVisible(w)) return w.id;
  }
  return null;
};

const update = (state: WMState, id: string, patch: (w: Win) => Partial<Win>): WMState => ({
  ...state,
  wins: state.wins.map((w) => (w.id === id ? { ...w, ...patch(w) } : w)),
});

const raise = (state: WMState, id: string): WMState => ({
  ...state,
  order: [...state.order.filter((x) => x !== id), id],
  active: id,
});

const remove = (state: WMState, id: string): WMState => {
  const next = { ...state, wins: state.wins.filter((w) => w.id !== id), order: state.order.filter((x) => x !== id) };
  return { ...next, active: state.active === id ? topVisible(next) : state.active };
};

const finishMinimize = (state: WMState, id: string): WMState => {
  const next = update(state, id, () => ({ minimized: true, phase: "open", minimizedSeq: state.seq }));
  return { ...next, seq: state.seq + 1, active: state.active === id ? topVisible(next, id) : state.active };
};

export const wmReducer = (state: WMState, action: WMAction): WMState => {
  switch (action.type) {
    case "open": {
      const id = `${action.app}-${state.seq}`;
      const win: Win = {
        id,
        app: action.app,
        frame: action.frame,
        minimized: false,
        phase: action.animate ? "opening" : "open",
        history: [action.location ?? "root"],
        index: 0,
      };
      return raise({ ...state, wins: [...state.wins, win], seq: state.seq + 1 }, id);
    }
    case "focus":
      if (state.active === action.id && state.order[state.order.length - 1] === action.id) return state;
      return raise(state, action.id);
    case "blur":
      return state.active === null ? state : { ...state, active: null };
    case "frame":
      return update(state, action.id, () => ({ frame: action.frame, restoreFrame: undefined, animateFrame: false }));
    case "zoom":
      return update(state, action.id, (w) =>
        w.restoreFrame
          ? { frame: w.restoreFrame, restoreFrame: undefined, animateFrame: true }
          : { frame: action.full, restoreFrame: w.frame, animateFrame: true },
      );
    case "minimize": {
      if (!action.animate) return finishMinimize(state, action.id);
      const next = update(state, action.id, () => ({ phase: "minimizing" }));
      return { ...next, active: state.active === action.id ? topVisible(next, action.id) : state.active };
    }
    case "restore":
      return raise(
        update(state, action.id, () => ({
          minimized: false,
          minimizedSeq: undefined,
          phase: action.animate ? "restoring" : "open",
          restoreFrom: action.from,
        })),
        action.id,
      );
    case "close": {
      if (!action.animate) return remove(state, action.id);
      const next = update(state, action.id, () => ({ phase: "closing" }));
      return { ...next, active: state.active === action.id ? topVisible(next, action.id) : state.active };
    }
    case "phaseEnd": {
      const win = state.wins.find((w) => w.id === action.id);
      if (!win || win.phase !== action.phase) return state;
      if (action.phase === "minimizing") return finishMinimize(state, action.id);
      if (action.phase === "closing") return remove(state, action.id);
      return update(state, action.id, () => ({ phase: "open", restoreFrom: undefined }));
    }
    case "navigate":
      return update(state, action.id, (w) =>
        w.history[w.index] === action.location
          ? {}
          : { history: [...w.history.slice(0, w.index + 1), action.location], index: w.index + 1 },
      );
    case "go":
      return update(state, action.id, (w) => ({
        index: clamp(w.index + action.delta, 0, w.history.length - 1),
      }));
    case "clamp":
      return {
        ...state,
        wins: state.wins.map((w) => ({ ...w, frame: clampFrame(w.frame, action.bounds), animateFrame: false })),
      };
  }
};

const DEFAULT_SIZES: Record<AppId, [number, number]> = {
  finder: [820, 560],
  terminal: [720, 460],
  spotify: [600, 440],
};

/** Where a new window goes: a little left of center, cascading with each open window. */
export const defaultFrame = (app: AppId, bounds: Bounds, openCount: number): Frame => {
  const [dw, dh] = DEFAULT_SIZES[app];
  const availH = bounds.h - MENUBAR_H - DOCK_RESERVE - 12;
  const w = Math.max(320, Math.min(dw, bounds.w - 40));
  const h = Math.max(240, Math.min(dh, availH));
  const step = 28 * (openCount % 6);
  return clampFrame(
    {
      w,
      h,
      x: Math.round(Math.max(12, (bounds.w - w) / 2 - 56) + step),
      y: Math.round(MENUBAR_H + Math.max(10, (availH - h) * 0.35) + step),
    },
    bounds,
  );
};

/** The frame a zoomed window fills: everything between the menu bar and the Dock. */
export const zoomFrame = (bounds: Bounds): Frame => ({
  x: 0,
  y: MENUBAR_H,
  w: bounds.w,
  h: Math.max(240, bounds.h - MENUBAR_H - DOCK_RESERVE),
});
