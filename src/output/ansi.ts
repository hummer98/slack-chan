// Minimal zero-dep ANSI escape helpers. We honour NO_COLOR, SLACK_CHAN_NO_COLOR,
// and `process.stdout.isTTY === false` to suppress color in pipes / non-TTY env.
// See plan §6 (TTY 検出).

const ESC = String.fromCharCode(0x1b);
const CSI = `${ESC}[`;

function wrap(open: string, close: string, s: string): string {
  return `${CSI}${open}m${s}${CSI}${close}m`;
}

export function isColorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.SLACK_CHAN_NO_COLOR !== undefined) return false;
  return stream.isTTY === true;
}

export interface ColorFns {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  yellowBg(s: string): string;
}

const NOOP: ColorFns = {
  red: (s) => s,
  yellow: (s) => s,
  green: (s) => s,
  cyan: (s) => s,
  magenta: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
  yellowBg: (s) => s,
};

const ON: ColorFns = {
  red: (s) => wrap("31", "39", s),
  yellow: (s) => wrap("33", "39", s),
  green: (s) => wrap("32", "39", s),
  cyan: (s) => wrap("36", "39", s),
  magenta: (s) => wrap("35", "39", s),
  dim: (s) => wrap("2", "22", s),
  bold: (s) => wrap("1", "22", s),
  yellowBg: (s) => wrap("43", "49", s),
};

export function makeColors(enabled: boolean): ColorFns {
  return enabled ? ON : NOOP;
}
