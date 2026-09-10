import { describe, expect, it } from "vite-plus/test";

import {
  shortWindowLabel,
  toSidebarUsageRows,
  usageToneForPercent,
  worstUsageTone,
} from "./SidebarProviderUsage.logic";

type Pools = Parameters<typeof toSidebarUsageRows>[0];

const pool = (windows: ReadonlyArray<{ id: string; label: string; usedPercent: number }>) =>
  [
    {
      driver: "claude",
      accounts: [{ displayName: "Claude", accentColor: undefined }],
      windows: windows.map((window) => ({ ...window, kind: "session" })),
    },
  ] as unknown as Pools;

describe("usageToneForPercent", () => {
  it.each<[number, string]>([
    [0, "default"],
    [74, "default"],
    [75, "warning"],
    [89, "warning"],
    [90, "critical"],
    [100, "critical"],
  ])("maps %i%% used to %s", (percent, expected) => {
    expect(usageToneForPercent(percent)).toBe(expected);
  });
});

describe("worstUsageTone", () => {
  it("takes the most severe tone", () => {
    expect(worstUsageTone(["default", "critical", "warning"])).toBe("critical");
  });

  it("is default for no windows", () => {
    expect(worstUsageTone([])).toBe("default");
  });
});

describe("shortWindowLabel", () => {
  it.each<[string, string]>([
    ["5-hour session", "5h"],
    ["5 hour", "5h"],
    ["Weekly", "1w"],
    ["7-day", "1w"],
    ["Monthly", "1mo"],
    ["primary", "prima…"],
  ])("shortens %s to %s", (label, expected) => {
    expect(shortWindowLabel(label)).toBe(expected);
  });
});

describe("toSidebarUsageRows", () => {
  it("reports remaining share, not used", () => {
    const [row] = toSidebarUsageRows(pool([{ id: "five_hour", label: "5-hour", usedPercent: 30 }]));

    expect(row?.windows[0]?.percentLabel).toBe("70%");
    expect(row?.windows[0]?.usedPercent).toBe(30);
  });

  it("carries the worst window tone onto the row", () => {
    const [row] = toSidebarUsageRows(
      pool([
        { id: "five_hour", label: "5-hour", usedPercent: 10 },
        { id: "seven_day", label: "Weekly", usedPercent: 95 },
      ]),
    );

    expect(row?.tone).toBe("critical");
  });

  it("drops a provider that reports no windows", () => {
    expect(toSidebarUsageRows(pool([]))).toEqual([]);
  });

  it("never reports a negative remaining share", () => {
    const [row] = toSidebarUsageRows(pool([{ id: "x", label: "5-hour", usedPercent: 140 }]));

    expect(row?.windows[0]?.percentLabel).toBe("0%");
  });
});
