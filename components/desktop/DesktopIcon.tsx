import React, { useRef, useState } from "react";
import type { Project } from "../projects/data";
import styles from "./Desktop.module.css";
import { FolderGlyph } from "./icons";

const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 450;

/**
 * A draggable folder on the desktop. Clicks and taps are recognised on pointer
 * up so the same code handles mouse and touch: in windowed mode a single click
 * selects and a double click opens; with `openOnTap` a single tap opens.
 */
export const DesktopIcon = ({
  project,
  index,
  selected,
  focused,
  openOnTap,
  onSelect,
  onOpen,
}: {
  project: Project;
  index: number;
  selected: boolean;
  /** Whether the desktop (rather than a window) has focus; selection turns blue. */
  focused: boolean;
  openOnTap: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastTap = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, offset };
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
      const clampTo = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
      setOffset({
        x: parent ? clampTo(start.offset.x + dx, start.offset.x - (own.left - parent.left), start.offset.x + (parent.right - own.right)) : start.offset.x + dx,
        y: parent ? clampTo(start.offset.y + dy, start.offset.y - (own.top - parent.top), start.offset.y + (parent.bottom - own.bottom)) : start.offset.y + dy,
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
      style={{ top: 14 + index * 106, transform: `translate(${offset.x}px, ${offset.y}px)` }}
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
