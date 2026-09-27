import React, { useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronLeft } from "react-icons/lu";
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
export const AppScreen = ({ app, onBack }: { app: AppId | null; onBack: () => void }) => {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<AppId | null>(app);
  if (app && app !== shown) setShown(app);
  if (!app && shown && reducedMotion) setShown(null);

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
        <button type="button" className={styles.appScreenBack} onClick={onBack} disabled={closing}>
          <LuChevronLeft />
          Back
        </button>
        <span className={styles.appScreenTitle}>{shown === "finder" ? "Projects" : APP_ICONS[shown].name}</span>
      </div>
      <div className={styles.appScreenBody}>
        {shown === "finder" && <FinderList />}
        {shown === "spotify" && <SpotifyMobile />}
        {shown === "terminal" && <TerminalApp />}
      </div>
    </div>,
    document.body,
  );
};
