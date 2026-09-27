import React, { useLayoutEffect, useRef, useState } from "react";
import styles from "./Desktop.module.css";
import type { AppId, Frame, RectLike } from "./windowManager";

const ICON = 50;
const SLOT = ICON + 4; // icon plus its 2px side margins
const SEPARATOR = 13;
const PADDING = 5;
const MAX_SCALE = 1.55;
const RANGE = 150;
/** Longest side of a minimized window's preview inside its slot. */
const PREVIEW = ICON - 4;

export const APP_ICONS: Record<AppId, { name: string; icon: string }> = {
  finder: { name: "Finder", icon: "/finder-dock.png" },
  spotify: { name: "Spotify", icon: "/spotify-dock.png" },
  terminal: { name: "Terminal", icon: "/terminal-dock.png" },
};

const DOCK_APPS: AppId[] = ["finder", "spotify", "terminal"];

export interface DockThumb {
  id: string;
  app: AppId;
  title: string;
  frame: Frame;
}

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/** A window of this size, scaled to fit a Dock slot. */
const previewSize = (w: number, h: number) => {
  const scale = Math.min(PREVIEW / w, PREVIEW / h);
  return { scale, w: w * scale, h: h * scale };
};

/**
 * Where a window being minimized now will end up: the preview slot about to be
 * added at the end of the Dock, after any windows already on their way there.
 * The Dock is centered, so it shifts left by half of whatever it grows by.
 */
export const dockDropRect = (id: string, frame: Frame): RectLike | null => {
  const marker = document.querySelector("[data-dock-drop]")?.getBoundingClientRect();
  if (!marker) return null;
  const inFlight = document.querySelectorAll(`[data-window-phase="minimizing"]:not([data-window-id="${CSS.escape(id)}"])`).length;
  const growth = SLOT * (1 + inFlight) + (document.querySelector("[data-dock-thumb]") ? 0 : SEPARATOR);
  const slotLeft = marker.left + growth / 2 - SLOT + 2;
  const { w, h } = previewSize(frame.w, frame.h);
  return { left: slotLeft + (ICON - w) / 2, top: marker.top + (ICON - h) / 2, width: w, height: h };
};

/** On-screen rect of a minimized window's Dock preview. */
export const dockPreviewRect = (id: string) =>
  document.querySelector(`[data-dock-preview="${CSS.escape(id)}"]`)?.getBoundingClientRect();

/**
 * A still copy of a window for its Dock preview, like the snapshot macOS keeps
 * of a minimized window: same markup and classes, plus what cloneNode leaves
 * behind (canvas pixels and scroll offsets, copied once it's in the document).
 */
const snapshotWindow = (source: HTMLElement, host: HTMLElement) => {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-window-id");
  clone.removeAttribute("data-window-phase");
  clone.removeAttribute("role");
  clone.removeAttribute("aria-label");
  clone.classList.remove(styles.windowHidden);
  // Fill the host, which follows the window's frame, so the copy reflows like
  // the real window if the desktop resizes while it's minimized.
  Object.assign(clone.style, { left: "0px", top: "0px", width: "100%", height: "100%", zIndex: "auto" });

  const canvases = clone.querySelectorAll("canvas");
  source.querySelectorAll("canvas").forEach((canvas, i) => {
    const copy = canvases[i];
    if (!copy) return;
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d")?.drawImage(canvas, 0, 0);
  });

  host.appendChild(clone);

  const from = source.querySelectorAll("*");
  const to = clone.querySelectorAll("*");
  from.forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) {
      to[i].scrollTop = el.scrollTop;
      to[i].scrollLeft = el.scrollLeft;
    }
  });
  return clone;
};

const WindowPreview = ({ id, frame }: { id: string; frame: Frame }) => {
  const host = useRef<HTMLDivElement>(null);
  const { scale, w, h } = previewSize(frame.w, frame.h);

  useLayoutEffect(() => {
    const source = document.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(id)}"]`);
    if (!source || !host.current) return;
    const clone = snapshotWindow(source, host.current);
    return () => clone.remove();
  }, [id]);

  return (
    <span
      className={styles.dockPreview}
      data-dock-preview={id}
      style={{ width: w, height: h, left: (ICON - w) / 2, top: (ICON - h) / 2 }}
    >
      <div ref={host} className={styles.dockPreviewHost} style={{ width: frame.w, height: frame.h, transform: `scale(${scale})` }} inert />
    </span>
  );
};

const DockItem = ({
  label,
  scale,
  running,
  bouncing,
  onClick,
  onBounceEnd,
  children,
  ...rest
}: {
  label: string;
  scale: number;
  running?: boolean;
  bouncing?: boolean;
  onClick: () => void;
  onBounceEnd?: () => void;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cx(styles.dockItem, bouncing && styles.dockBounce)}
    style={{ width: ICON * scale }}
    onAnimationEnd={onBounceEnd}
    {...rest}
  >
    <span className={styles.dockIcon} style={{ transform: `scale(${scale})` }} aria-hidden>
      {children}
    </span>
    {/* Sits over the (possibly magnified) icon, so the art can hold markup a button can't. */}
    <button
      type="button"
      className={styles.dockHit}
      style={{ transform: `scale(${scale})` }}
      aria-label={label}
      onClick={onClick}
    />
    <span className={styles.dockTooltip} style={{ bottom: ICON * scale + 14 }} aria-hidden>
      {label}
    </span>
    {running && <span className={styles.dockDot} aria-hidden />}
  </div>
);

export const Dock = ({
  running,
  thumbs,
  bouncing,
  magnify,
  onLaunch,
  onRestore,
  onBounceEnd,
}: {
  running: Set<AppId>;
  thumbs: DockThumb[];
  bouncing: AppId | null;
  magnify: boolean;
  onLaunch: (app: AppId) => void;
  onRestore: (id: string, from?: RectLike) => void;
  onBounceEnd: () => void;
}) => {
  const ref = useRef<HTMLElement>(null);
  const [scales, setScales] = useState<number[] | null>(null);
  const count = DOCK_APPS.length + thumbs.length;
  const scaleAt = (i: number) => scales?.[i] ?? 1;

  // Magnification is computed from where each icon sits at rest, so growing
  // icons don't shift the targets under the pointer.
  const onPointerMove = (e: React.PointerEvent) => {
    if (!magnify || e.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const restWidth = PADDING * 2 + count * SLOT + (thumbs.length ? SEPARATOR : 0);
    const left = rect.left + rect.width / 2 - restWidth / 2 + PADDING;
    setScales(
      Array.from({ length: count }, (_, i) => {
        const center = left + i * SLOT + (i >= DOCK_APPS.length ? SEPARATOR : 0) + SLOT / 2;
        const d = Math.abs(e.clientX - center);
        return d >= RANGE ? 1 : 1 + ((MAX_SCALE - 1) * (1 + Math.cos((Math.PI * d) / RANGE))) / 2;
      }),
    );
  };

  return (
    <nav
      ref={ref}
      className={styles.dock}
      aria-label="Dock"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setScales(null)}
    >
      {DOCK_APPS.map((app, i) => (
        <DockItem
          key={app}
          label={APP_ICONS[app].name}
          scale={scaleAt(i)}
          running={running.has(app)}
          bouncing={bouncing === app}
          onBounceEnd={onBounceEnd}
          onClick={() => onLaunch(app)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_ICONS[app].icon} alt="" draggable={false} />
        </DockItem>
      ))}

      {thumbs.length > 0 && <span className={styles.dockSeparator} aria-hidden />}

      {thumbs.map((thumb, i) => (
        <DockItem
          key={thumb.id}
          label={thumb.title}
          scale={scaleAt(DOCK_APPS.length + i)}
          data-dock-thumb={thumb.id}
          onClick={() => onRestore(thumb.id, dockPreviewRect(thumb.id))}
        >
          <WindowPreview id={thumb.id} frame={thumb.frame} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.dockThumbBadge} src={APP_ICONS[thumb.app].icon} alt="" draggable={false} />
        </DockItem>
      ))}

      {/* Where the next minimized window lands. */}
      <span data-dock-drop style={{ width: 0, height: ICON, flexShrink: 0 }} aria-hidden />
    </nav>
  );
};
