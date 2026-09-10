import { describe, expect, it } from "vite-plus/test";

import { resolveProjectAccentColor } from "./projectAccentColor";

const project = (overrides: Partial<Parameters<typeof resolveProjectAccentColor>[0]> = {}) =>
  ({
    title: "acme-web",
    workspaceRoot: "/repos/acme-web",
    projectIcon: null,
    ...overrides,
  }) as Parameters<typeof resolveProjectAccentColor>[0];

describe("resolveProjectAccentColor", () => {
  it("uses the color of an explicit lucide override", () => {
    expect(
      resolveProjectAccentColor(
        project({ projectIcon: { kind: "lucide", name: "rocket", color: "rose" } }),
      ),
    ).toBe("rose");
  });

  it("gives an emoji override no accent", () => {
    expect(
      resolveProjectAccentColor(project({ projectIcon: { kind: "emoji", emoji: "🚀" } })),
    ).toBeNull();
  });

  it("falls back to the automatic icon's color", () => {
    expect(resolveProjectAccentColor(project())).not.toBeNull();
  });

  it("is stable for the same project", () => {
    expect(resolveProjectAccentColor(project())).toBe(resolveProjectAccentColor(project()));
  });

  it("has no accent without a project", () => {
    expect(resolveProjectAccentColor(null)).toBeNull();
  });
});
