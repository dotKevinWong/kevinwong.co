import Parser from "rss-parser";

/** The macOS release shown in the Projects page's neofetch. */
export interface MacOSRelease {
  version: string;
  build: string;
  /** Darwin version, as `uname -r` and neofetch print it. */
  kernel: string;
}

/**
 * Darwin version for a macOS build: the build's leading number is Darwin's
 * major version and its letter the minor (A = 0), e.g. 25E246 -> 25.4.0.
 * Security-only updates after x.6 keep going through the alphabet but stay on
 * Darwin x.6.0 (macOS 14.7, 23H124, is Darwin 23.6.0).
 */
export const kernelForBuild = (build: string) => {
  const match = /^(\d+)([A-Z])/.exec(build);
  return match ? `${match[1]}.${Math.min(match[2].charCodeAt(0) - 65, 6)}.0` : "";
};

const release = (version: string, build: string): MacOSRelease => ({ version, build, kernel: kernelForBuild(build) });

/**
 * Used when neither feed can be reached. The feeds can only move the version
 * forward from here, so bump this now and then.
 */
export const FALLBACK_MACOS = release("27.0", "26A428");

/** Numeric comparison of dotted versions: 26.10 > 26.9, 27.0 > 26.6.2. */
export const compareVersions = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

const VERSION = /^\d+(?:\.\d+){0,2}$/;
const BUILD = /^\d{2}[A-Z]\d{1,5}[a-z]?$/;

/* ─── Apple's developer releases feed ─── */

const APPLE_FEED = "https://developer.apple.com/news/releases/rss/releases.rss";

/**
 * A public release title, with or without the marketing name: "macOS 27.0
 * (26A428)", "macOS Sequoia 15.1 (24B83)". The version must be followed
 * directly by the build, which rules out betas ("macOS 27.2 beta 2 (26B5091g)"),
 * release candidates ("macOS 27.0 RC (26A428)", whose build can equal the
 * final one) and Rapid Security Responses ("macOS 13.4.1 (a) (22F770820d)").
 */
const PUBLIC_RELEASE = /^macOS(?: [A-Z][a-z]+)* (\d+(?:\.\d+){0,2}) \((\d{2}[A-Z]\d{1,5}[a-z]?)\)$/;

export const parseReleaseTitle = (title: string): MacOSRelease | null => {
  const match = PUBLIC_RELEASE.exec(title.trim());
  return match ? release(match[1], match[2]) : null;
};

const rss = new Parser();

/** Public macOS releases in Apple's feed. It's curated and sometimes skips a release. */
const fromAppleFeed = async (): Promise<MacOSRelease[]> => {
  const res = await fetch(APPLE_FEED, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${APPLE_FEED}: HTTP ${res.status}`);
  const feed = await rss.parseString(await res.text());
  return (feed.items ?? []).flatMap((item) => parseReleaseTitle(item.title ?? "") ?? []);
};

/* ─── SOFA, the Mac Admins community's macOS feed ─── */

const SOFA_FEED = "https://sofafeed.macadmins.io/v1/macos_data_feed.json";

type SofaFeed = {
  OSVersions?: { Latest?: { ProductVersion?: string; Build?: string } }[];
  InstallationApps?: {
    LatestUMA?: { version?: string; build?: string };
    AllPreviousUMA?: { version?: string; build?: string }[];
  };
};

/**
 * The latest release of each major version in SOFA. Its per-release Build has
 * been wrong before (26A5428 for 27.0), so builds come from its list of full
 * installers when that has the version.
 */
export const parseSofa = (data: SofaFeed): MacOSRelease[] => {
  const installers = [data.InstallationApps?.LatestUMA, ...(data.InstallationApps?.AllPreviousUMA ?? [])];
  return (data.OSVersions ?? []).flatMap(({ Latest }) => {
    const version = Latest?.ProductVersion ?? "";
    if (!VERSION.test(version)) return [];
    const build = installers.find((app) => app?.version === version)?.build ?? Latest?.Build ?? "";
    return BUILD.test(build) ? [release(version, build)] : [];
  });
};

const fromSofa = async (): Promise<MacOSRelease[]> => {
  const res = await fetch(SOFA_FEED, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${SOFA_FEED}: HTTP ${res.status}`);
  return parseSofa(await res.json());
};

/* ─── Combined ─── */

/**
 * Picks the newest version any source reports, never going below the
 * fallback. For the build, Apple's feed wins over SOFA, which wins over the
 * fallback: `sources` is in that order of trust.
 */
export const pickLatest = (sources: MacOSRelease[][]): MacOSRelease => {
  const all = [...sources.flat(), FALLBACK_MACOS];
  const newest = all.reduce((best, r) => (compareVersions(r.version, best.version) > 0 ? r : best));
  return all.find((r) => compareVersions(r.version, newest.version) === 0)!;
};

/**
 * The newest public macOS release, from Apple's developer releases feed and
 * SOFA (checked in parallel; either is enough), or the fallback. Never throws.
 */
export const latestMacOS = async (): Promise<MacOSRelease> => {
  const results = await Promise.allSettled([fromAppleFeed(), fromSofa()]);
  results.forEach((r) => {
    if (r.status === "rejected") console.warn("Couldn't check the latest macOS release:", String(r.reason));
  });
  return pickLatest(results.map((r) => (r.status === "fulfilled" ? r.value : [])));
};
