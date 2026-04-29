import type { Formatter } from "./format.ts";

export class JsonlFormatter implements Formatter {
  format(record: unknown): string {
    return `${JSON.stringify(record)}\n`;
  }
}
