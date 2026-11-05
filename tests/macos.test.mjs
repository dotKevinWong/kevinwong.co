import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_MACOS, compareVersions, kernelFor, parseReleaseTitle, parseSofa, pickLatest } from "../lib/macos.ts";

const rel = (version, build) => ({ version, build, kernel: kernelFor(version, build) });

describe("kernelFor", () => {
  test("macOS 27 and later: Darwin follows the version, with the minor capped at 6", () => {
    assert.equal(kernelFor("27.0", "26A428"), "27.0.0");
    assert.equal(kernelFor("27.3", "26D1"), "27.3.0");
    assert.equal(kernelFor("27.9", "26J1"), "27.6.0");
  });
  test("macOS 26 runs Darwin 25", () => {
    assert.equal(kernelFor("26.0", "25A354"), "25.0.0");
    assert.equal(kernelFor("26.7", "25G83"), "25.6.0");
  });
  test("older releases follow the build: its number is the major and its letter the minor", () => {
    assert.equal(kernelFor("15.1", "24B83"), "24.1.0");
    assert.equal(kernelFor("15.9", "24J1"), "24.6.0");
  });
  test("an unparseable build on an old release gives an empty string", () => {
    assert.equal(kernelFor("15.1", "bad"), "");
  });
});

describe("FALLBACK_MACOS", () => {
  test("is 27.0 (26A428) on Darwin 27.0.0", () => {
    assert.deepEqual(FALLBACK_MACOS, { version: "27.0", build: "26A428", kernel: "27.0.0" });
  });
});

describe("compareVersions", () => {
  test("compares numerically, not as strings", () => {
    assert.equal(compareVersions("26.10", "26.9"), 1);
    assert.equal(compareVersions("27.0", "26.6.2"), 1);
    assert.equal(compareVersions("26.1", "26.2"), -1);
  });
  test("a missing part counts as zero", () => {
    assert.equal(compareVersions("26", "26.0.0"), 0);
    assert.equal(compareVersions("26.0.1", "26"), 1);
  });
});

describe("parseReleaseTitle", () => {
  test("reads a public release, with or without the marketing name", () => {
    assert.deepEqual(parseReleaseTitle("macOS 27.0 (26A428)"), rel("27.0", "26A428"));
    assert.deepEqual(parseReleaseTitle("macOS Sequoia 15.1 (24B83)"), rel("15.1", "24B83"));
  });
  test("a bare major becomes x.0", () => {
    assert.deepEqual(parseReleaseTitle("macOS 26 (25A354)"), rel("26.0", "25A354"));
  });
  test("tolerates extra whitespace", () => {
    assert.deepEqual(parseReleaseTitle("  macOS  27.0   (26A428) "), rel("27.0", "26A428"));
  });
  test("refuses betas, release candidates and Rapid Security Responses", () => {
    assert.equal(parseReleaseTitle("macOS 27.2 beta 2 (26B5091g)"), null);
    assert.equal(parseReleaseTitle("macOS 27.0 RC (26A428)"), null);
    assert.equal(parseReleaseTitle("macOS 13.4.1 (a) (22F770820d)"), null);
    assert.equal(parseReleaseTitle("iOS 27.0 (24A1)"), null);
  });
});

describe("parseSofa", () => {
  test("takes the build from a full installer when SOFA's own Build is wrong", () => {
    const data = {
      OSVersions: [{ Latest: { ProductVersion: "27.0", Build: "26A5428" } }],
      InstallationApps: { LatestUMA: { title: "macOS 27", version: "27.0", build: "26A428" } },
    };
    assert.deepEqual(parseSofa(data), [rel("27.0", "26A428")]);
  });
  test("skips beta installers and falls back to Latest.Build when it looks released", () => {
    const data = {
      OSVersions: [{ Latest: { ProductVersion: "27.0", Build: "26A428" } }],
      InstallationApps: { LatestUMA: { title: "macOS 27 beta", version: "27.0", build: "26A5000" } },
    };
    assert.deepEqual(parseSofa(data), [rel("27.0", "26A428")]);
  });
  test("looks through AllPreviousUMA", () => {
    const data = {
      OSVersions: [{ Latest: { ProductVersion: "26.7", Build: "x" } }],
      InstallationApps: { AllPreviousUMA: [{ title: "macOS 26", version: "26.7", build: "25G83" }] },
    };
    assert.deepEqual(parseSofa(data), [rel("26.7", "25G83")]);
  });
  test("drops a version or build that does not parse", () => {
    const data = {
      OSVersions: [
        { Latest: { ProductVersion: "27.0 beta", Build: "26A428" } },
        { Latest: { ProductVersion: "26.1", Build: "25B5042k" } },
        {},
      ],
    };
    assert.deepEqual(parseSofa(data), []);
  });
  test("an empty feed gives no releases", () => {
    assert.deepEqual(parseSofa({}), []);
  });
});

describe("pickLatest", () => {
  test("never goes below the fallback", () => {
    assert.deepEqual(pickLatest([[rel("26.7", "25G83")], []]), FALLBACK_MACOS);
    assert.deepEqual(pickLatest([]), FALLBACK_MACOS);
  });
  test("picks the newest version any source reports", () => {
    assert.equal(pickLatest([[rel("27.1", "26B1")], [rel("27.2", "26C1")]]).version, "27.2");
  });
  test("for the same version, the earlier source's build wins", () => {
    const apple = [rel("27.1", "26B10")];
    const sofa = [rel("27.1", "26B11")];
    assert.equal(pickLatest([apple, sofa]).build, "26B10");
    assert.equal(pickLatest([sofa, apple]).build, "26B11");
  });
  test("the fallback loses to a source with the same version listed first", () => {
    assert.equal(pickLatest([[rel("27.0", "26A999")]]).build, "26A999");
  });
});
