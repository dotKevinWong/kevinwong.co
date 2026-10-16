import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronLeft } from "react-icons/lu";
import type { MacOSRelease } from "../../lib/macos";
import styles from "./Desktop.module.css";
import { APP_ICONS } from "./Dock";
import { FinderList } from "./FinderApp";
import { useReducedMotion } from "./hooks";
import { SpotifyMobile } from "./SpotifyApp";
import { TerminalApp } from "./TerminalApp";
import type { AppId } from "./windowManager";

/**
 * Phone-style full-screen app. Stays mounted while `app` goes back to null so
 * it can animate closed. Portalled to <body> so it covers the site navbar.
 */
export const AppScreen = ({ app, macos, onBack }: { app: AppId | null; macos: MacOSRelease; onBack: () => void }) => {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<AppId | null>(app);
  if (app && app !== shown) setShown(app);
  if (!app && shown && reducedMotion) setShown(null);

  const backRef = useRef<HTMLButtonElement>(null);
  const open = shown !== null;

  // Escape is Back, until the screen starts closing (Back is disabled then too).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.repeat && app) onBack();
  });

  // A real modal: the page behind (all of it lives in #__next; this screen is
  // portalled outside it) goes inert, focus starts on Back, and it returns to
  // whatever opened the screen, usually a Dock button, once the screen is gone.
  // Escape is heard on the document, since a tap on the bar leaves focus on <body>.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const page = document.getElementById("__next");
    if (page) page.inert = true;
    backRef.current?.focus({ preventScroll: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (page) page.inert = false;
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!shown || typeof document === "undefined") return null;
  const closing = !app;

  return createPortal(
    <div
      className={[
        styles.theme,
        styles.appScreen,
        closing && styles.appScreenClosing,
        shown === "terminal" && styles.toneTerminal,
        shown === "spotify" && styles.toneSpotify,
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={APP_ICONS[shown].name}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) setShown(null);
      }}
    >
      <div className={styles.appScreenBar}>
        <button ref={backRef} type="button" className={styles.appScreenBack} onClick={onBack} disabled={closing}>
          <LuChevronLeft />
          Back
        </button>
        <span className={styles.appScreenTitle}>{shown === "finder" ? "Projects" : APP_ICONS[shown].name}</span>
      </div>
      {/* Focusable (not tabbable) so a tap on the content focuses the scroller, and
          arrow keys, Space and Page Down scroll it rather than nothing. */}
      <div className={styles.appScreenBody} tabIndex={-1}>
        {shown === "finder" && <FinderList />}
        {shown === "spotify" && <SpotifyMobile />}
        {shown === "terminal" && <TerminalApp macos={macos} />}
      </div>
    </div>,
    document.body,
  );
};
