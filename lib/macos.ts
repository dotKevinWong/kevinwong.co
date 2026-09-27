import Parser from "rss-parser";

/** The macOS release shown in the Projects page's neofetch. */
export interface MacOSRelease {
  version: string;
  build: string;
  /** Darwin version, as `uname -r` and neofetch print it. */
  kernel: string;
}

/**
 * The Darwin version neofetch prints for a macOS release. Darwin skipped 26:
 * macOS 26 runs Darwin 25 but macOS 27.0 (26A428) runs Darwin 27.0.0. Security
 * updates after x.6 stay on x.6.0 (macOS 26.7 is Darwin 25.6.0). Older releases,
 * which never show since the fallback is 27.0, roughly follow the build: its
 * number is the major and its letter the minor (A = 0).
 */
export const kernelFor = (version: string, build: string) => {
  const [major, minor = 0] = version.split(".").map(Number);
  if (major >= 27) return `${major}.${Math.min(minor, 6)}.0`;
  if (major === 26) return `25.${Math.min(minor, 6)}.0`;
  const match = /^(\d+)([A-Z])/.exec(build);
  return match ? `${match[1]}.${Math.min(match[2].charCodeAt(0) - 65, 6)}.0` : "";
};

const release = (rawVersion: string, build: string): MacOSRelease => {
  // Apple titles x.0 releases with a bare major ("macOS 26 (25A354)"); sw_vers says 26.0.
  const version = rawVersion.includes(".") ? rawVersion : `${rawVersion}.0`;
  return { version, build, kernel: kernelFor(version, build) };
};

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
// Seed (beta) builds end in a lowercase letter; released ones don't.
const RELEASED_BUILD = /^\d{2}[A-Z]\d{1,5}$/;

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
  const match = PUBLIC_RELEASE.exec(title.replace(/\s+/g, " ").trim());
  return match ? release(match[1], match[2]) : null;
};

const rss = new Parser();

/** Public macOS releases in Apple's feed. It's curated and sometimes skips a release. */
const fromAppleFeed = async (): Promise<MacOSRelease[]> => {
  const res = await fetch(APPLE_FEED, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${APPLE_FEED}: HTTP ${res.status}`);
  const feed = await rss.parseString(await res.text());
  // Newest first, so a release Apple re-posted with a new build (25G82, then 25G83) resolves to the later one.
  return (feed.items ?? [])
    .sort((a, b) => (b.isoDate ?? "").localeCompare(a.isoDate ?? ""))
    .flatMap((item) => parseReleaseTitle(item.title ?? "") ?? []);
};

/* ─── SOFA, the Mac Admins community's macOS feed ─── */

const SOFA_FEED = "https://sofafeed.macadmins.io/v1/macos_data_feed.json";

type SofaInstaller = { title?: string; version?: string; build?: string };
type SofaFeed = {
  OSVersions?: { Latest?: { ProductVersion?: string; Build?: string } }[];
  InstallationApps?: { LatestUMA?: SofaInstaller; AllPreviousUMA?: SofaInstaller[] };
};

/**
 * The latest release of each major version in SOFA. Its per-release Build has
 * been wrong before (26A5428 for 27.0), so builds come from its list of full
 * installers when that has the version, skipping beta installers (on release
 * day it can still list the beta under the final version number).
 */
export const parseSofa = (data: SofaFeed): MacOSRelease[] => {
  const installers = [data.InstallationApps?.LatestUMA, ...(data.InstallationApps?.AllPreviousUMA ?? [])];
  return (data.OSVersions ?? []).flatMap(({ Latest }) => {
    const version = Latest?.ProductVersion ?? "";
    if (!VERSION.test(version)) return [];
    const candidates = [
      ...installers.filter((app) => app?.version === version && !/beta/i.test(app.title ?? "")).map((app) => app?.build),
      Latest?.Build,
    ];
    const build = candidates.find((b): b is string => !!b && RELEASED_BUILD.test(b));
    return build ? [release(version, build)] : [];
  });
};

const fromSofa = async (): Promise<MacOSRelease[]> => {
  const res = await fetch(SOFA_FEED, {
    // SOFA asks consumers to identify themselves.
    headers: { "User-Agent": "kevinwong.co-projects/1.0" },
    signal: AbortSignal.timeout(5000),
  });
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
 * The newest public macOS release from Apple's developer releases feed and
 * SOFA (checked in parallel), or the fallback. Never throws. `checked` is true
 * only when SOFA answered with releases: Apple's feed skips most point
 * releases, so on its own it can't confirm there's nothing newer.
 */
export const latestMacOS = async (): Promise<{ release: MacOSRelease; checked: boolean }> => {
  const sources = await Promise.all(
    [
      { name: "Apple's releases feed", read: fromAppleFeed },
      { name: "SOFA", read: fromSofa },
    ].map(async ({ name, read }) => {
      try {
        const releases = await read();
        if (!releases.length) console.warn(`${name} listed no macOS releases; its format may have changed.`);
        return releases;
      } catch (error) {
        console.warn(`Couldn't read ${name} for the latest macOS release:`, String(error));
        return [];
      }
    }),
  );
  const [, sofa] = sources;
  return { release: pickLatest(sources), checked: sofa.length > 0 };
};
