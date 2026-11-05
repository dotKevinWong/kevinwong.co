import styles from "./Desktop.module.css";

export type AppId = "finder" | "spotify" | "terminal";

/** Every app, in Dock order. */
export const APP_IDS: AppId[] = ["finder", "spotify", "terminal"];

/** The one place an app's name, Dock icon, menu bar menus and color tone are defined. */
export const APPS: Record<AppId, { name: string; icon: string; menus: string[]; tone?: "terminal" | "spotify" }> = {
  finder: { name: "Finder", icon: "/finder-dock.png", menus: ["File", "Edit", "View", "Go", "Window", "Help"] },
  spotify: {
    name: "Spotify",
    icon: "/spotify-dock.png",
    menus: ["File", "Edit", "View", "Playback", "Window", "Help"],
    tone: "spotify",
  },
  terminal: {
    name: "Terminal",
    icon: "/terminal-dock.png",
    menus: ["Shell", "Edit", "View", "Window", "Help"],
    tone: "terminal",
  },
};

/** The tone class for an app's window or full screen (none for Finder). */
export const toneClass = (app: AppId) =>
  APPS[app].tone === "terminal" ? styles.toneTerminal : APPS[app].tone === "spotify" ? styles.toneSpotify : undefined;
