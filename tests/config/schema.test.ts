import { describe, expect, it } from "bun:test";
import {
  assertConfig,
  assertOutputConfig,
  assertPartialWorkspaceConfig,
  assertWorkspaceConfig,
} from "../../src/config/schema.ts";
import type { Config, OutputConfig, WorkspaceConfig } from "../../src/config/types.ts";

const validWorkspace: WorkspaceConfig = {
  name: "Acme",
  default_channel: "C0123456",
  tokens_store: "keychain",
};

const validOutput: OutputConfig = {
  format: "jsonl",
  cache_window_days: 7,
};

const validConfig: Config = {
  default_workspace: "T01ABCDEF",
  workspaces: { T01ABCDEF: validWorkspace },
  output: validOutput,
};

describe("assertConfig (positive)", () => {
  it("accepts a fully-populated config", () => {
    expect(() => assertConfig(validConfig)).not.toThrow();
  });

  it("accepts default_workspace = null", () => {
    expect(() => assertConfig({ ...validConfig, default_workspace: null })).not.toThrow();
  });

  it("accepts an empty workspaces map", () => {
    expect(() =>
      assertConfig({ ...validConfig, default_workspace: null, workspaces: {} }),
    ).not.toThrow();
  });

  it("accepts default_channel = null", () => {
    expect(() =>
      assertConfig({
        ...validConfig,
        workspaces: { T01ABCDEF: { ...validWorkspace, default_channel: null } },
      }),
    ).not.toThrow();
  });
});

describe("assertConfig (negative)", () => {
  it("rejects a non-object", () => {
    expect(() => assertConfig(null)).toThrow();
    expect(() => assertConfig("nope")).toThrow();
    expect(() => assertConfig(42)).toThrow();
  });

  it("rejects an invalid default_workspace format", () => {
    expect(() => assertConfig({ ...validConfig, default_workspace: "t01abcdef" })).toThrow(
      /default_workspace/,
    );
    expect(() => assertConfig({ ...validConfig, default_workspace: "T-bad-id" })).toThrow();
    expect(() => assertConfig({ ...validConfig, default_workspace: "" })).toThrow();
  });

  it("rejects a workspaces key that is not a valid team_id", () => {
    expect(() =>
      assertConfig({ ...validConfig, workspaces: { t01abcdef: validWorkspace } }),
    ).toThrow(/team_id/i);
    expect(() => assertConfig({ ...validConfig, workspaces: { "": validWorkspace } })).toThrow();
  });

  it("rejects an invalid output.format", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, format: "yaml" } }),
    ).toThrow(/format/);
  });

  it("rejects a string cache_window_days", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, cache_window_days: "7" } }),
    ).toThrow(/cache_window_days/);
  });

  it("rejects a negative cache_window_days", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, cache_window_days: -1 } }),
    ).toThrow();
  });

  it("rejects a non-integer cache_window_days", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, cache_window_days: 1.5 } }),
    ).toThrow();
  });

  it("rejects cache_window_days < 1 (minimum)", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, cache_window_days: 0 } }),
    ).toThrow();
  });

  it("rejects an invalid tokens_store", () => {
    expect(() =>
      assertConfig({
        ...validConfig,
        workspaces: { T01ABCDEF: { ...validWorkspace, tokens_store: "memory" } },
      }),
    ).toThrow(/tokens_store/);
  });

  it("rejects an empty workspace name", () => {
    expect(() =>
      assertConfig({
        ...validConfig,
        workspaces: { T01ABCDEF: { ...validWorkspace, name: "" } },
      }),
    ).toThrow(/name/);
  });

  it("rejects when output is missing", () => {
    const broken: Record<string, unknown> = { ...validConfig };
    delete broken.output;
    expect(() => assertConfig(broken)).toThrow();
  });

  it("rejects when workspaces is missing", () => {
    const broken: Record<string, unknown> = { ...validConfig };
    delete broken.workspaces;
    expect(() => assertConfig(broken)).toThrow();
  });
});

describe("assertConfig (forward compat)", () => {
  it("accepts unknown top-level fields (ignored)", () => {
    expect(() => assertConfig({ ...validConfig, future_feature: "x" })).not.toThrow();
  });

  it("accepts unknown fields inside [workspace.<id>]", () => {
    expect(() =>
      assertConfig({
        ...validConfig,
        workspaces: { T01ABCDEF: { ...validWorkspace, future_feature: "x" } },
      }),
    ).not.toThrow();
  });

  it("accepts unknown fields inside [output]", () => {
    expect(() =>
      assertConfig({ ...validConfig, output: { ...validOutput, future_feature: "x" } }),
    ).not.toThrow();
  });
});

describe("assertWorkspaceConfig", () => {
  it("accepts a valid workspace", () => {
    expect(() => assertWorkspaceConfig(validWorkspace)).not.toThrow();
  });

  it("rejects when name is missing or non-string", () => {
    expect(() => assertWorkspaceConfig({ ...validWorkspace, name: undefined })).toThrow();
    expect(() => assertWorkspaceConfig({ ...validWorkspace, name: 1 })).toThrow();
  });

  it("rejects when tokens_store is missing", () => {
    const broken: Record<string, unknown> = { ...validWorkspace };
    delete broken.tokens_store;
    expect(() => assertWorkspaceConfig(broken)).toThrow();
  });
});

describe("assertOutputConfig", () => {
  it("accepts a valid OutputConfig", () => {
    expect(() => assertOutputConfig(validOutput)).not.toThrow();
  });

  it("accepts each member of OUTPUT_FORMATS", () => {
    expect(() => assertOutputConfig({ format: "jsonl", cache_window_days: 7 })).not.toThrow();
    expect(() => assertOutputConfig({ format: "toon", cache_window_days: 7 })).not.toThrow();
    expect(() => assertOutputConfig({ format: "human", cache_window_days: 7 })).not.toThrow();
  });
});

describe("assertPartialWorkspaceConfig", () => {
  it("accepts an empty object", () => {
    expect(() => assertPartialWorkspaceConfig({})).not.toThrow();
  });

  it("accepts a partial with only one field", () => {
    expect(() => assertPartialWorkspaceConfig({ default_channel: "C9" })).not.toThrow();
    expect(() => assertPartialWorkspaceConfig({ default_channel: null })).not.toThrow();
    expect(() => assertPartialWorkspaceConfig({ tokens_store: "file" })).not.toThrow();
    expect(() => assertPartialWorkspaceConfig({ name: "Acme" })).not.toThrow();
  });

  it("rejects an unknown field type", () => {
    expect(() => assertPartialWorkspaceConfig({ tokens_store: "memory" })).toThrow();
    expect(() => assertPartialWorkspaceConfig({ name: "" })).toThrow();
    expect(() => assertPartialWorkspaceConfig({ default_channel: 42 })).toThrow();
  });
});
