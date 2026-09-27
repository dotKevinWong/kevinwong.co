import React, { useRef, useState } from "react";
import type { Project } from "../projects/data";
import styles from "./Desktop.module.css";
import { FolderGlyph } from "./icons";

const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 450;
const ICON_W = 92; // .icon width
const ICON_H = 100; // roughly .icon height with a one-line label

const clampTo = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * A draggable folder on the desktop. Clicks and taps are recognised on pointer
 * up so the same code handles mouse and touch: in windowed mode a single click
 * selects and a double click opens; with `openOnTap` a single tap opens.
 *
 * Folders start where the project's `desktop` position puts them, kept clear of
 * the edges, the Dock and the tip banner on small screens. Once dragged, a folder
 * keeps its dropped position, clamped in CSS so it stays on the desktop if the
 * desktop later shrinks.
 */
export const DesktopIcon = ({
  project,
  selected,
  focused,
  openOnTap,
  onSelect,
  onOpen,
}: {
  project: Project;
  selected: boolean;
  /** Whether the desktop (rather than a window) has focus; selection turns blue. */
  focused: boolean;
  openOnTap: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) => {
  // Top-left corner in the icon layer once the folder has been dragged.
  const [dropped, setDropped] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastTap = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const layer = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    // Start from where the folder is drawn, whatever clamping put it there.
    const origin = layer ? { x: own.left - layer.left, y: own.top - layer.top } : { x: 0, y: 0 };
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        onSelect();
      }
      setDropped({
        x: clampTo(origin.x + dx, 0, (layer?.width ?? Infinity) - own.width),
        y: clampTo(origin.y + dy, 0, (layer?.height ?? Infinity) - own.height),
      });
    };
    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      setDragging(false);
      if (moved || ev.type === "pointercancel") return;
      if (openOnTap) return onOpen();
      onSelect();
      const now = ev.timeStamp;
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        onOpen();
      } else {
        lastTap.current = now;
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  return (
    <button
      type="button"
      className={[
        styles.icon,
        selected && styles.iconSelected,
        focused && styles.iconFocused,
        dragging && styles.iconDragging,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        dropped
          ? {
              left: `clamp(0px, ${dropped.x}px, calc(100% - ${ICON_W}px))`,
              top: `clamp(0px, ${dropped.y}px, calc(100% - ${ICON_H}px))`,
            }
          : {
              left: `clamp(8px, ${project.desktop.x}%, calc(100% - ${ICON_W + 8}px))`,
              top: `clamp(10px, ${project.desktop.y}%, calc(100% - var(--icon-floor)))`,
            }
      }
      aria-label={`${project.name} folder`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      // Pointer input is handled on pointer up; this only sees keyboard (Space) activation.
      onClick={(e) => {
        if (e.detail === 0) onSelect();
      }}
    >
      <span className={styles.iconImage}>
        <FolderGlyph size={64} badge={project.logo} badgeFit={project.logoFit} />
      </span>
      <span className={styles.iconLabel}>{project.name}</span>
    </button>
  );
};
