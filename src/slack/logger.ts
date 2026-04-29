// Re-export shim. The implementation lives in src/output/logger.ts; this file
// only exists to keep `import { StderrLogger } from "./logger.ts"` working
// from within src/slack/ without forcing relative-path churn across the tree.
export { type Logger, type LogLevel, StderrLogger } from "../output/logger.ts";
