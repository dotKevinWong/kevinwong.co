import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import fetcher from "../../lib/fetcher";

/** Matches a media query. Reports `serverValue` during SSR and hydration. */
export const useMediaQuery = (query: string, serverValue = false) => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
};

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

export type NowPlayingData = {
  album?: string;
  /** null when the track has no album art. */
  albumImageUrl?: string | null;
  albumUrl?: string;
  artist?: string;
  artistUrl?: string;
  isPlaying?: boolean;
  songUrl?: string;
  title?: string;
  currentDuration?: number;
  totalDuration?: number;
};

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Spotify now-playing state with a progress value that ticks between polls.
 * `poll` says whether this caller refetches every 15s; either way SWR still
 * fetches on mount and when the tab regains focus.
 */
export const useNowPlaying = ({ poll }: { poll: boolean }) => {
  // Same key and fetcher as the sidebar's NowPlaying, so they share one cache
  // entry. SWR runs a timer for every hook that sets refreshInterval, so only one
  // caller polls at a time. The Spotify window is only on screen from 64em up,
  // where the sidebar's widget already polls, so it passes false (and stays quiet
  // while parked below 64em). The full-screen app only mounts below 64em, where
  // the Sidebar holds its requests while PageShell hides it, so it passes true.
  const { data: response, error } = useSWR<NowPlayingData>("/api/nowplaying", fetcher, {
    refreshInterval: poll ? 15000 : 0,
    dedupingInterval: 1000,
  });
  // As in the sidebar: SWR keeps the last good response when a poll fails, so a
  // failed poll reads as Not Playing rather than an old song still ticking along.
  const data = error ? undefined : response;
  const hasTrack = !!data?.songUrl;
  const isPlaying = hasTrack && !!data?.isPlaying;

  // Time elapsed since `data` last changed; reset whenever a new response lands.
  const [clock, setClock] = useState({ data, elapsed: 0 });
  if (clock.data !== data) setClock({ data, elapsed: 0 });

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setClock((c) => ({ ...c, elapsed: c.elapsed + 1000 })), 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

  const total = Math.max(0, data?.totalDuration ?? 0);
  const raw = Math.max(0, data?.currentDuration ?? 0) + (isPlaying ? clock.elapsed : 0);
  const current = total > 0 ? Math.min(raw, total) : raw;

  return { data, hasTrack, isPlaying, current, total, pct: total > 0 ? (current / total) * 100 : 0 };
};
