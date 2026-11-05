import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useRouter } from "next/router";
import { useMediaQuery } from "../hooks";
import { APP_IDS, type AppId } from "./apps";
import { isVisible, type WMState } from "./windowManager";

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

const subscribeMinute = (onChange: () => void) => {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, 60_000 - (Date.now() % 60_000) + 50);
  };
  schedule();
  return () => clearTimeout(timer);
};

/**
 * The current time, rounded to the minute and re-rendered when the minute
 * changes. `null` during SSR and hydration so the server's clock (and time
 * zone) never ends up in the markup.
 */
export const useMinuteClock = () => {
  const minute = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
};

const TIP_KEY = "projects:tip-dismissed";

const readTipDismissed = () => {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
};

/** Tip banner: shown once a moment after load until it's dismissed or a folder is opened. */
export const useTipBanner = () => {
  const [tip, setTip] = useState<"hidden" | "shown" | "done">("hidden");

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

  return { tip, dismissTip };
};

/**
 * The full-screen app on small screens. It lives in the URL (?app=terminal) so
 * the browser's back button closes it.
 */
export const useAppScreenRoute = (windowed: boolean) => {
  const router = useRouter();
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

  return { screenApp, openScreen, closeScreen };
};

/**
 * Focuses a window (or the desktop) that isn't otherwise focusable, only until
 * focus moves on or the pointer goes down inside it. Left focusable, a click on
 * its content would focus the whole window, and the keyboard would scroll from
 * there instead of the list under the pointer (and ring the window).
 */
const handOffFocus = (el: HTMLElement) => {
  const release = () => {
    el.removeEventListener("blur", release);
    el.removeEventListener("pointerdown", release, true);
    el.removeAttribute("tabindex");
    delete el.dataset.focusHandoff;
  };
  el.tabIndex = -1;
  el.dataset.focusHandoff = "";
  el.focus({ preventScroll: true });
  if (document.activeElement !== el) return release();
  el.addEventListener("blur", release);
  el.addEventListener("pointerdown", release, true);
};

/**
 * When the key window changes because the focused control went away (its
 * window closed or minimized, or its Dock preview was restored), focus moves
 * to the window now in front, or to the desktop, instead of dropping to <body>.
 */
export const useKeyWindowFocus = (wm: WMState, rootRef: RefObject<HTMLElement | null>) => {
  const lastActive = useRef(wm.active);
  useEffect(() => {
    const prev = lastActive.current;
    lastActive.current = wm.active;
    if (prev === wm.active) return;
    const focused = document.activeElement;
    const holder = focused?.closest<HTMLElement>("[data-window-id]")?.dataset.windowId;
    const stranded =
      !focused || focused === document.body || (holder !== undefined && !wm.wins.some((w) => w.id === holder && isVisible(w)));
    if (!stranded) return;
    const next = wm.active ? rootRef.current?.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(wm.active)}"]`) : null;
    const target = next ?? rootRef.current;
    if (target) handOffFocus(target);
  }, [wm.active, wm.wins, rootRef]);
};
