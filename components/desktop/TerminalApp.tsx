import React, { useEffect, useState } from "react";
import styles from "./Desktop.module.css";
import { useReducedMotion } from "./hooks";

const LOGO = [
  "                    'c.",
  "                 ,xNMM.",
  "               .OMMMMo",
  "               OMMM0,",
  "     .;loddo:' loolloddol;.",
  "   cKMMMMMMMMMMNWMMMMMMMMMM0:",
  " .KMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " XMMMMMMMMMMMMMMMMMMMMMMMX.",
  ";MMMMMMMMMMMMMMMMMMMMMMMM:",
  ":MMMMMMMMMMMMMMMMMMMMMMMM:",
  ".MMMMMMMMMMMMMMMMMMMMMMMMX.",
  " kMMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " .XMMMMMMMMMMMMMMMMMMMMMMMMMMk",
  "  .XMMMMMMMMMMMMMMMMMMMMMMMMK.",
  "    kMMMMMMMMMMMMMMMMMMMMMMd",
  "     ;KMMMMMMMWXXWMMMMMMMk.",
  "       .cooc,.    .,coo:.",
];
const LOGO_WIDTH = Math.max(...LOGO.map((line) => line.length));

// The classic rainbow Apple, top to bottom.
const LOGO_COLORS = [
  "#305D87", "#305D87", "#305D87", "#305D87",
  "#D2A700", "#D2A700", "#D2A700",
  "#F66605", "#F66605", "#F66605",
  "#C000C0", "#C000C0", "#C000C0", "#C000C0",
  "#007E8D", "#007E8D", "#007E8D",
];

const SWATCHES = ["#384A54", "#F66605", "#305D87", "#D2A700", "#007E8D", "#C000C0", "#247B68", "#CFD8DC"];

// Aritim Dark
const LABEL = "#3a71a4";
const DIM = "#2f5d86";

const HOST = "Kevin@MacBookPro.lan";
const BIRTHDAY = new Date(1999, 4, 27);

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Time since the birthday, formatted like neofetch's uptime. */
const uptime = (now: Date) => {
  let years = now.getFullYear() - BIRTHDAY.getFullYear();
  const anniversary = new Date(BIRTHDAY);
  anniversary.setFullYear(BIRTHDAY.getFullYear() + years);
  if (anniversary > now) anniversary.setFullYear(BIRTHDAY.getFullYear() + --years);
  const days = Math.floor((now.getTime() - anniversary.getTime()) / 86_400_000);
  return [plural(years, "year"), plural(days, "day"), plural(now.getHours(), "hour"), plural(now.getMinutes(), "min")].join(
    ", ",
  );
};

const buildInfo = (): [string | null, string][] => [
  [null, HOST],
  [null, "-".repeat(HOST.length)],
  ["OS", "macOS 26.4 25E246 arm64"],
  ["Host", "MacBookPro18,4"],
  ["Kernel", "25.4.0"],
  ["Uptime", uptime(new Date())],
  ["Shell", "zsh 5.9"],
  ["Resolution", "1800x1169"],
  ["DE", "Aqua"],
  ["WM", "Rectangle"],
  ["Terminal", "Apple_Terminal"],
  ["Terminal Font", "SFMono-Regular"],
  ["CPU", "Apple M1 Max"],
  ["GPU", "Apple M1 Max"],
  ["Memory", `${4000 + Math.floor(Math.random() * 8000)}MiB / 32768MiB`],
];

export const TERMINAL_TITLE = "Kevin — -zsh — 80×24";

const Prompt = () => (
  <>
    <span style={{ color: DIM }}>(base) </span>
    <span style={{ color: LABEL }}>Kevin@MacBookPro</span> ~ %{" "}
  </>
);

/** `neofetch`, typed out line by line. Wraps the info below the logo in narrow windows. */
export const TerminalApp = () => {
  const reducedMotion = useReducedMotion();
  const [info] = useState(buildInfo);
  const rows = Math.max(LOGO.length, info.length);
  // One step per row, then the color swatches, then the next prompt.
  const steps = rows + 2;
  const [step, setStep] = useState(reducedMotion ? steps : 0);

  useEffect(() => {
    if (reducedMotion) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
      let n = 0;
      interval = setInterval(() => {
        setStep(++n);
        if (n >= steps) clearInterval(interval);
      }, 40);
    }, 400);
    return () => {
      clearTimeout(delay);
      clearInterval(interval);
    };
  }, [reducedMotion, steps]);

  return (
    <div className={styles.terminal}>
      <div className={styles.termLine}>
        <Prompt />
        neofetch
      </div>
      <div className={styles.termOutput}>
        <div className={styles.termBlock} style={{ minWidth: `${LOGO_WIDTH}ch` }} aria-hidden>
          {LOGO.slice(0, step).map((line, i) => (
            <div key={i} style={{ color: LOGO_COLORS[i] }}>
              {line}
            </div>
          ))}
        </div>
        <div className={styles.termBlock}>
          {info.slice(0, step).map(([label, value], i) => (
            <div key={i}>
              {label ? (
                <>
                  <b style={{ color: LABEL }}>{label}</b>: {value}
                </>
              ) : (
                <b style={{ color: LABEL }}>{value}</b>
              )}
            </div>
          ))}
          {step > rows && (
            <div className={styles.termSwatches} aria-hidden>
              {SWATCHES.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
          )}
        </div>
      </div>
      {step > rows + 1 && (
        <div className={styles.termLine} style={{ marginTop: "1.45em" }}>
          <Prompt />
          <span className={styles.termCursor} />
        </div>
      )}
    </div>
  );
};
