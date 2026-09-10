import { describe, expect, it } from "vite-plus/test";

import {
  groupImportableDetectedScripts,
  guessDetectedScriptIcon,
} from "./projectScriptCommandPicker.logic";

const npm = (name: string) => ({ name, command: `npm run ${name}`, source: "npm" as const });
const composer = (name: string) => ({
  name,
  command: `composer run-script ${name}`,
  source: "composer" as const,
});

describe("guessDetectedScriptIcon", () => {
  it.each<[string, string]>([
    ["test", "test"],
    ["test:unit", "test"],
    ["lint", "lint"],
    ["build", "build"],
    ["debug", "debug"],
    ["setup", "configure"],
    ["config", "configure"],
    ["dev", "play"],
  ])("maps %s to %s", (name, expected) => {
    expect(guessDetectedScriptIcon(name)).toBe(expected);
  });

  it("ignores case", () => {
    expect(guessDetectedScriptIcon("Build:Prod")).toBe("build");
  });
});

describe("groupImportableDetectedScripts", () => {
  it("splits detected scripts by source", () => {
    const grouped = groupImportableDetectedScripts({
      detected: [npm("dev"), composer("migrate")],
      scripts: [],
    });

    expect(grouped.npm.map((script) => script.name)).toEqual(["dev"]);
    expect(grouped.composer.map((script) => script.name)).toEqual(["migrate"]);
    expect(grouped.hasAny).toBe(true);
  });

  it("drops scripts whose command is already an action", () => {
    const grouped = groupImportableDetectedScripts({
      detected: [npm("dev"), npm("build")],
      scripts: [{ name: "Anything", command: "npm run dev" }],
    });

    expect(grouped.npm.map((script) => script.name)).toEqual(["build"]);
  });

  it("drops scripts whose name is already an action, ignoring case", () => {
    const grouped = groupImportableDetectedScripts({
      detected: [npm("build")],
      scripts: [{ name: "BUILD", command: "make all" }],
    });

    expect(grouped.npm).toEqual([]);
    expect(grouped.hasAny).toBe(false);
  });

  it("reports nothing to offer for an empty detection", () => {
    expect(groupImportableDetectedScripts({ detected: [], scripts: [] }).hasAny).toBe(false);
  });
});
