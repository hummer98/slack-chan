import { describe, expect, it } from "bun:test";
import {
  formatLocalTimestamp,
  humanBytes,
  humanRelativeTime,
} from "../../../src/output/human/format.ts";

describe("humanBytes", () => {
  it("0 bytes", () => {
    expect(humanBytes(0)).toBe("0 B");
  });

  it("under 1 KiB stays in B", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(1023)).toBe("1023 B");
  });

  it("KiB scale", () => {
    expect(humanBytes(1024)).toBe("1.0 KiB");
    expect(humanBytes(1536)).toBe("1.5 KiB");
    expect(humanBytes(687820)).toBe("671.7 KiB"); // 687820 / 1024 ≈ 671.7
  });

  it("MiB / GiB scale", () => {
    expect(humanBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(humanBytes(5 * 1024 * 1024 + 512 * 1024)).toBe("5.5 MiB");
    expect(humanBytes(1024 * 1024 * 1024)).toBe("1.0 GiB");
  });

  it("negative becomes 0 B (defensive)", () => {
    expect(humanBytes(-1)).toBe("0 B");
  });
});

describe("humanRelativeTime", () => {
  // now: 2026-05-01 00:00:00 UTC = 1777593600 sec * 1000 = 1777593600000 ms
  const now = 1777593600000;

  it("just now (< 5 sec)", () => {
    expect(humanRelativeTime(now, now - 1000)).toBe("just now");
    expect(humanRelativeTime(now, now - 4999)).toBe("just now");
  });

  it("seconds (5 - 59)", () => {
    expect(humanRelativeTime(now, now - 5_000)).toBe("5 seconds ago");
    expect(humanRelativeTime(now, now - 30_000)).toBe("30 seconds ago");
    expect(humanRelativeTime(now, now - 59_000)).toBe("59 seconds ago");
  });

  it("1 minute boundary (singular)", () => {
    expect(humanRelativeTime(now, now - 60_000)).toBe("1 minute ago");
  });

  it("minutes (2 - 59)", () => {
    expect(humanRelativeTime(now, now - 60_000 * 2)).toBe("2 minutes ago");
    expect(humanRelativeTime(now, now - 60_000 * 59)).toBe("59 minutes ago");
  });

  it("1 hour boundary (singular)", () => {
    expect(humanRelativeTime(now, now - 3_600_000)).toBe("1 hour ago");
  });

  it("hours (2 - 23)", () => {
    expect(humanRelativeTime(now, now - 3_600_000 * 23)).toBe("23 hours ago");
  });

  it("1 day boundary", () => {
    expect(humanRelativeTime(now, now - 86_400_000)).toBe("1 day ago");
  });

  it("days (2 - 29)", () => {
    expect(humanRelativeTime(now, now - 86_400_000 * 3)).toBe("3 days ago");
    expect(humanRelativeTime(now, now - 86_400_000 * 29)).toBe("29 days ago");
  });

  it("months (1 - 11)", () => {
    expect(humanRelativeTime(now, now - 86_400_000 * 30)).toBe("1 month ago");
    expect(humanRelativeTime(now, now - 86_400_000 * 90)).toBe("3 months ago");
  });

  it("years", () => {
    expect(humanRelativeTime(now, now - 86_400_000 * 365)).toBe("1 year ago");
    expect(humanRelativeTime(now, now - 86_400_000 * 365 * 2)).toBe("2 years ago");
  });

  it("future negative becomes 'just now' (defensive)", () => {
    expect(humanRelativeTime(now, now + 10_000)).toBe("just now");
  });
});

describe("formatLocalTimestamp", () => {
  // 2026-04-30 12:00:23 JST = 2026-04-30 03:00:23 UTC = epoch sec 1777518023
  const ts = "1777518023.000000";

  it("Asia/Tokyo (UTC+9) → 2026-04-30 12:00:23", () => {
    expect(formatLocalTimestamp(ts, "Asia/Tokyo")).toBe("2026-04-30 12:00:23");
  });

  it("UTC → 2026-04-30 03:00:23", () => {
    expect(formatLocalTimestamp(ts, "UTC")).toBe("2026-04-30 03:00:23");
  });

  it("America/Los_Angeles (UTC-7 DST in late April) → 2026-04-29 20:00:23", () => {
    expect(formatLocalTimestamp(ts, "America/Los_Angeles")).toBe("2026-04-29 20:00:23");
  });

  it("number ts (epoch ms) also accepted", () => {
    const ms = 1777518023 * 1000;
    expect(formatLocalTimestamp(ms, "Asia/Tokyo")).toBe("2026-04-30 12:00:23");
  });

  it("invalid string → 'invalid date'", () => {
    expect(formatLocalTimestamp("not-a-number", "UTC")).toBe("invalid date");
  });
});
