import { useRouter } from "next/router";
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { MacOSRelease } from "../../lib/macos";
import { PROJECTS, getProject, type ProjectId } from "../projects/data";
import { AppScreen } from "./AppScreen";
import styles from "./Desktop.module.css";
import { DesktopIcon } from "./DesktopIcon";
import { APP_ICONS, Dock, dockPreviewRect, type DockThumb } from "./Dock";
import { FinderApp, locationTitle } from "./FinderApp";
import { useMediaQuery, useReducedMotion } from "./hooks";
import { MenuBar } from "./MenuBar";
import { Notice } from "./Notice";
import { SpotifyApp } from "./SpotifyApp";
import { TERMINAL_TITLE, TerminalApp } from "./TerminalApp";
import { Window } from "./Window";
import {
  defaultFrame,
  initialWMState,
  isVisible,
  wmReducer,
  zoomFrame,
  type AppId,
  type Bounds,
  type RectLike,
  type Win,
} from "./windowManager";

const TIP_KEY = "projects:tip-dismissed";
const APP_IDS: AppId[] = ["finder", "spotify", "terminal"];

const readTipDismissed = () => {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
};

const windowTitle = (win: Win) =>
  win.app === "finder" ? locationTitle(win.history[win.index]) : win.app === "terminal" ? TERMINAL_TITLE : "Spotify";

/**
 * The Projects page as a macOS desktop. On large screens folders open in
 * Finder windows and the Dock launches Spotify and Terminal. On smaller
 * screens folders open the project page and Dock apps open full screen.
 */
export const Desktop = ({ macos }: { macos: MacOSRelease }) => {
  const router = useRouter();
  const windowed = useMediaQuery("(min-width: 64em)");
  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion;

  const rootRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [wm, dispatch] = useReducer(wmReducer, initialWMState);
  const [selected, setSelected] = useState<ProjectId | null>(null);
  const [bouncing, setBouncing] = useState<AppId | null>(null);
  const [tip, setTip] = useState<"hidden" | "shown" | "done">("hidden");

  // Track the desktop's size (it changes with the window and the sidebar) and
  // pull windows back into view when it shrinks.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) };
      setBounds(next);
      dispatch({ type: "clamp", bounds: next });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Tip banner: shown once a moment after load until it's dismissed or a folder is opened.
  useEffect(() => {
    const show = setTimeout(() => setTip(readTipDismissed() ? "done" : "shown"), 800);
    const hide = setTimeout(() => setTip((t) => (t === "shown" ? "done" : t)), 15000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  const dismissTip = useCallback(() => {
    setTip("done");
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Private mode or blocked storage: the tip just shows again next visit.
    }
  }, []);

  /* ─── Windows (large screens) ─── */

  const ordered = wm.order.map((id) => wm.wins.find((w) => w.id === id)!);

  const openWindow = (app: AppId, location?: ProjectId) => {
    if (!bounds) return;
    const count = wm.wins.filter(isVisible).length;
    dispatch({ type: "open", app, location, frame: defaultFrame(app, bounds, count), animate });
  };

  const restore = (id: string, from: RectLike | undefined = dockPreviewRect(id)) => {
    dispatch({ type: "restore", id, from, animate });
  };

  /** Brings an app forward: focus a visible window, else restore a minimized one, else launch. */
  const activate = (app: AppId) => {
    const wins = ordered.filter((w) => w.app === app && w.phase !== "closing");
    const visible = wins.filter(isVisible);
    if (visible.length) return dispatch({ type: "focus", id: visible[visible.length - 1].id });
    const minimized = wins.filter((w) => w.minimized).sort((a, b) => (b.minimizedSeq ?? 0) - (a.minimizedSeq ?? 0));
    if (minimized.length) return restore(minimized[0].id);
    if (app !== "finder" && animate) setBouncing(app);
    openWindow(app);
  };

  const openProject = (id: ProjectId) => {
    dismissTip();
    if (!windowed) {
      router.push(getProject(id).href);
      return;
    }
    const existing = ordered.findLast((w) => w.app === "finder" && w.phase !== "closing" && w.history[w.index] === id);
    if (!existing) return openWindow("finder", id);
    if (existing.minimized) restore(existing.id);
    else dispatch({ type: "focus", id: existing.id });
  };

  /* ─── Full-screen apps (small screens) ─── */

  // The open app lives in the URL (?app=terminal) so the browser's back button closes it.
  const queryApp = router.query.app;
  const screenApp = !windowed && APP_IDS.includes(queryApp as AppId) ? (queryApp as AppId) : null;
  const pushedScreen = useRef(false);

  const openScreen = (app: AppId) => {
    pushedScreen.current = true;
    router.push({ pathname: router.pathname, query: { app } }, undefined, { shallow: true, scroll: false });
  };

  const closeScreen = () => {
    if (pushedScreen.current) router.back();
    else router.replace({ pathname: router.pathname }, undefined, { shallow: true, scroll: false });
  };

  /* ─── Render ─── */

  const activeWin = windowed ? wm.wins.find((w) => w.id === wm.active) : undefined;
  const running = new Set<AppId>(["finder"]);
  if (windowed) wm.wins.forEach((w) => running.add(w.app));
  else if (screenApp) running.add(screenApp);

  const thumbs: DockThumb[] = windowed
    ? wm.wins
        .filter((w) => w.minimized)
        .sort((a, b) => (a.minimizedSeq ?? 0) - (b.minimizedSeq ?? 0))
        .map((w) => ({ id: w.id, app: w.app, title: windowTitle(w), frame: w.frame }))
    : [];

  return (
    <div ref={rootRef} className={`${styles.theme} ${styles.desktop}`}>
      <div
        className={styles.wallpaper}
        onPointerDown={() => {
          setSelected(null);
          dispatch({ type: "blur" });
        }}
      />

      <MenuBar app={activeWin?.app ?? "finder"} />

      <div className={styles.icons}>
        {PROJECTS.map((project) => (
          <DesktopIcon
            key={project.id}
            project={project}
            selected={selected === project.id}
            focused={!activeWin}
            openOnTap={!windowed}
            onSelect={() => {
              setSelected(project.id);
              dispatch({ type: "blur" });
            }}
            onOpen={() => openProject(project.id)}
          />
        ))}
      </div>

      {windowed &&
        bounds &&
        wm.wins.map((win) => {
          const z = 10 + wm.order.indexOf(win.id);
          const common = {
            win,
            zIndex: z,
            active: wm.active === win.id,
            bounds,
            full: zoomFrame(bounds),
            dispatch,
            animate,
            title: windowTitle(win),
          };
          if (win.app === "finder") {
            return (
              <Window key={win.id} {...common} variant="unified" minSize={{ w: 420, h: 300 }}>
                <FinderApp
                  location={win.history[win.index]}
                  canBack={win.index > 0}
                  canForward={win.index < win.history.length - 1}
                  onNavigate={(location) => dispatch({ type: "navigate", id: win.id, location })}
                  onGo={(delta) => dispatch({ type: "go", id: win.id, delta })}
                />
              </Window>
            );
          }
          if (win.app === "spotify") {
            return (
              <Window key={win.id} {...common} variant="untitled" tone="spotify" minSize={{ w: 380, h: 300 }}>
                <SpotifyApp paused={win.minimized} />
              </Window>
            );
          }
          return (
            <Window key={win.id} {...common} tone="terminal">
              <TerminalApp macos={macos} />
            </Window>
          );
        })}

      <Dock
        running={running}
        thumbs={thumbs}
        bouncing={bouncing}
        magnify={windowed}
        onLaunch={(app) => (windowed ? activate(app) : openScreen(app))}
        onRestore={restore}
        onBounceEnd={() => setBouncing(null)}
      />

      {tip === "shown" && (
        <Notice
          title="Finder"
          icon={APP_ICONS.finder.icon}
          body={windowed ? "Double-click a folder to open a project." : "Tap a folder to open a project."}
          onDismiss={dismissTip}
        />
      )}

      <AppScreen app={screenApp} macos={macos} onBack={closeScreen} />
    </div>
  );
};
