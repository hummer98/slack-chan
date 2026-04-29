import type { Formatter } from "./format.ts";
import { JsonlFormatter } from "./jsonl.ts";

/**
 * TOON formatter — currently delegates to JSONL. The TOON spec is unresolved
 * (see ADR-0009); real implementation lands in a follow-up task.
 */
export class ToonFormatter implements Formatter {
  private readonly inner = new JsonlFormatter();

  format(record: unknown): string {
    return this.inner.format(record);
  }
}
