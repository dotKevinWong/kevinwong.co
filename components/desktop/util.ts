export const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/** Clamps `n` to [min, max]; if max < min, min wins. */
export const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));
