import React, { useRef, useState } from "react";
import styles from "./Desktop.module.css";
import type { AppId } from "./windowManager";

const ICON = 50;
const SLOT = ICON + 4; // icon plus its 2px side margins
const SEPARATOR = 13;
const PADDING = 5;
const MAX_SCALE = 1.55;
const RANGE = 150;

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
}

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
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onBounceEnd?: () => void;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    aria-label={label}
    className={`${styles.dockItem} ${bouncing ? styles.dockBounce : ""}`}
    style={{ width: ICON * scale }}
    onClick={onClick}
    onAnimationEnd={onBounceEnd}
    {...rest}
  >
    <span className={styles.dockIcon} style={{ transform: `scale(${scale})` }}>
      {children}
    </span>
    <span className={styles.dockTooltip} style={{ bottom: ICON * scale + 14 }} aria-hidden>
      {label}
    </span>
    {running && <span className={styles.dockDot} aria-hidden />}
  </button>
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
  onRestore: (id: string, from: DOMRect) => void;
  onBounceEnd: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
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
          onClick={(e) => onRestore(thumb.id, e.currentTarget.querySelector(`.${styles.dockThumb}`)!.getBoundingClientRect())}
        >
          <span className={styles.dockThumb} aria-hidden>
            <span className={styles.dockThumbBar}>
              <span style={{ background: "#ff5f57" }} />
              <span style={{ background: "#febc2e" }} />
              <span style={{ background: "#28c840" }} />
            </span>
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.dockThumbBadge} src={APP_ICONS[thumb.app].icon} alt="" draggable={false} />
        </DockItem>
      ))}

      {/* Where the next minimized window lands. */}
      <span data-dock-drop style={{ width: 0, height: ICON, flexShrink: 0 }} aria-hidden />
    </nav>
  );
};
