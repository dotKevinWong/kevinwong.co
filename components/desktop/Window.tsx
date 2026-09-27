import React, { useLayoutEffect, useRef, useState } from "react";
import styles from "./Desktop.module.css";
import { CloseGlyph, MinimizeGlyph, ZoomGlyph } from "./icons";
import { clampFrame, MENUBAR_H, type Bounds, type Frame, type RectLike, type Win, type WMAction } from "./windowManager";

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/** A transform that maps `from` (the window's own rect) onto `to`, with a 0 0 origin. */
const rectTransform = (from: DOMRect, to: RectLike) =>
  `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;

export const TrafficLights = ({
  title,
  floating,
  onClose,
  onMinimize,
  onZoom,
}: {
  title: string;
  floating?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onZoom: () => void;
}) => (
  <div className={cx(styles.traffic, floating && styles.trafficFloating)} data-no-drag>
    <button type="button" className={cx(styles.light, styles.lightClose)} aria-label={`Close ${title}`} onClick={onClose}>
      <CloseGlyph />
    </button>
    <button
      type="button"
      className={cx(styles.light, styles.lightMinimize)}
      aria-label={`Minimize ${title}`}
      onClick={onMinimize}
    >
      <MinimizeGlyph />
    </button>
    <button type="button" className={cx(styles.light, styles.lightZoom)} aria-label={`Zoom ${title}`} onClick={onZoom}>
      <ZoomGlyph />
    </button>
  </div>
);

export const Window = ({
  win,
  title,
  zIndex,
  active,
  bounds,
  full,
  dispatch,
  animate,
  variant = "plain",
  tone,
  minSize = { w: 360, h: 220 },
  children,
}: {
  win: Win;
  /** Accessible name; also shown in the title bar of plain windows. */
  title: string;
  zIndex: number;
  active: boolean;
  bounds: Bounds;
  /** The zoomed frame. */
  full: Frame;
  dispatch: React.Dispatch<WMAction>;
  /** False when the user prefers reduced motion: close and minimize happen at once. */
  animate: boolean;
  /**
   * "plain": a title bar with the title centred.
   * "untitled": a title bar with just the traffic lights.
   * "unified": no title bar; traffic lights float over the content, which
   * marks its own draggable areas with `data-drag-region`.
   */
  variant?: "plain" | "unified" | "untitled";
  tone?: "terminal" | "spotify";
  minSize?: { w: number; h: number };
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Frame while a drag or resize is in progress; committed on pointer up.
  const [live, setLive] = useState<Frame | null>(null);
  const frame = live ?? win.frame;
  const { id, phase } = win;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    let anim: Animation;
    switch (phase) {
      case "opening":
        anim = el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
        break;
      case "closing":
        anim = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], {
          duration: 140,
          easing: "ease-in",
          fill: "forwards",
        });
        break;
      case "minimizing": {
        const own = el.getBoundingClientRect();
        const drop = document.querySelector("[data-dock-drop]")?.getBoundingClientRect();
        const to = drop
          ? { left: drop.left, top: drop.top + 5, width: 50, height: 40 }
          : { left: own.left + own.width / 2, top: window.innerHeight, width: 1, height: 1 };
        anim = el.animate(
          [
            { transformOrigin: "0 0", transform: "none", opacity: 1 },
            { transformOrigin: "0 0", transform: rectTransform(own, to), opacity: 0.3 },
          ],
          { duration: 420, easing: "cubic-bezier(0.5, 0, 0.75, 0.25)", fill: "forwards" },
        );
        break;
      }
      case "restoring": {
        const own = el.getBoundingClientRect();
        const from = win.restoreFrom;
        anim = el.animate(
          from
            ? [
                { transformOrigin: "0 0", transform: rectTransform(own, from), opacity: 0.3 },
                { transformOrigin: "0 0", transform: "none", opacity: 1 },
              ]
            : [{ opacity: 0 }, { opacity: 1 }],
          { duration: 360, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        );
        break;
      }
      default:
        return;
    }
    anim.onfinish = () => dispatch({ type: "phaseEnd", id, phase });
    return () => {
      anim.onfinish = null;
      anim.cancel();
    };
    // restoreFrom is captured with the phase change; it never changes on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, id, dispatch]);

  const track = (target: Element, pointerId: number, compute: (dx: number, dy: number) => Frame, x0: number, y0: number) => {
    target.setPointerCapture(pointerId);
    let last: Frame | null = null;
    const move = (e: Event) => {
      const ev = e as PointerEvent;
      last = compute(ev.clientX - x0, ev.clientY - y0);
      setLive(last);
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (last) dispatch({ type: "frame", id, frame: last });
      setLive(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const isDragTarget = (target: EventTarget) => {
    const el = target as Element;
    return !!el.closest?.("[data-drag-region]") && !el.closest("button, a, input, textarea, [data-no-drag]");
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isDragTarget(e.target) || !ref.current) return;
    e.preventDefault();
    const start = win.frame;
    track(ref.current, e.pointerId, (dx, dy) => clampFrame({ ...start, x: start.x + dx, y: start.y + dy }, bounds), e.clientX, e.clientY);
  };

  const onResizeStart = (dir: ResizeDir) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = win.frame;
    track(
      e.currentTarget,
      e.pointerId,
      (dx, dy) => {
        let { x, y, w, h } = s;
        if (dir.includes("e")) w = Math.min(Math.max(minSize.w, s.w + dx), bounds.w - s.x);
        if (dir.includes("s")) h = Math.min(Math.max(minSize.h, s.h + dy), bounds.h - s.y);
        if (dir.includes("w")) {
          w = Math.max(minSize.w, s.w - dx);
          x = s.x + s.w - w;
        }
        if (dir.includes("n")) {
          h = Math.max(minSize.h, Math.min(s.h - dy, s.y + s.h - MENUBAR_H));
          y = s.y + s.h - h;
        }
        return { x, y, w, h };
      },
      e.clientX,
      e.clientY,
    );
  };

  const close = () => dispatch({ type: "close", id, animate });
  const minimize = () => dispatch({ type: "minimize", id, animate });
  const zoom = () => dispatch({ type: "zoom", id, full });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className={cx(
        styles.window,
        active ? styles.windowActive : styles.windowInactive,
        variant === "unified" && styles.windowVibrant,
        win.animateFrame && !live && styles.windowZooming,
        win.minimized && styles.windowHidden,
        tone === "terminal" && styles.toneTerminal,
        tone === "spotify" && styles.toneSpotify,
      )}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, zIndex }}
      onPointerDownCapture={() => {
        if (!active) dispatch({ type: "focus", id });
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (isDragTarget(e.target)) zoom();
      }}
    >
      {variant === "unified" ? (
        <TrafficLights title={title} floating onClose={close} onMinimize={minimize} onZoom={zoom} />
      ) : (
        <div className={styles.titlebar} data-drag-region>
          <TrafficLights title={title} onClose={close} onMinimize={minimize} onZoom={zoom} />
          {variant === "plain" && <div className={styles.title}>{title}</div>}
        </div>
      )}
      <div className={styles.windowBody}>{children}</div>
      {RESIZE_DIRS.map((dir) => (
        <div key={dir} className={styles.resize} data-dir={dir} onPointerDown={onResizeStart(dir)} aria-hidden />
      ))}
    </div>
  );
};
