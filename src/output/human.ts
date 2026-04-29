import { type ColorFns, isColorEnabled, makeColors } from "./ansi.ts";
import type { Formatter } from "./format.ts";

export interface HumanFormatterOptions {
  /** Override TTY/NO_COLOR detection. Useful for tests. */
  colors?: ColorFns;
}

export class HumanFormatter implements Formatter {
  private readonly colors: ColorFns;

  constructor(opts: HumanFormatterOptions = {}) {
    this.colors = opts.colors ?? makeColors(isColorEnabled());
  }

  format(record: unknown): string {
    const pretty = JSON.stringify(record, null, 2);
    if (pretty === undefined) {
      return `${this.colors.dim(String(record))}\n`;
    }
    return `${this.colors.dim(pretty)}\n`;
  }
}
