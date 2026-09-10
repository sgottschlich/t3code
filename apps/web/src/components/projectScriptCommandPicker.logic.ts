import type { ProjectScript, ProjectScriptIcon } from "@t3tools/contracts";

import type { DetectedProjectScript } from "~/hooks/usePackageManagerScripts";

/** Best-effort icon guess for a detected script, editable afterwards. */
export function guessDetectedScriptIcon(name: string): ProjectScriptIcon {
  const lower = name.toLowerCase();
  if (lower.includes("test")) return "test";
  if (lower.includes("lint")) return "lint";
  if (lower.includes("build")) return "build";
  if (lower.includes("debug")) return "debug";
  if (lower.includes("config") || lower.includes("setup")) return "configure";
  return "play";
}

/**
 * Detected scripts the project does not already run, grouped by source.
 * A script counts as taken when either its command or its (case-insensitive)
 * name matches an existing action, so re-importing cannot create a twin.
 */
export function groupImportableDetectedScripts(input: {
  detected: ReadonlyArray<DetectedProjectScript>;
  scripts: ReadonlyArray<Pick<ProjectScript, "name" | "command">>;
}): {
  readonly npm: ReadonlyArray<DetectedProjectScript>;
  readonly composer: ReadonlyArray<DetectedProjectScript>;
  readonly hasAny: boolean;
} {
  const importable = input.detected.filter(
    (candidate) =>
      !input.scripts.some(
        (script) =>
          script.command === candidate.command ||
          script.name.toLowerCase() === candidate.name.toLowerCase(),
      ),
  );
  const npm = importable.filter((script) => script.source === "npm");
  const composer = importable.filter((script) => script.source === "composer");
  return { npm, composer, hasAny: npm.length > 0 || composer.length > 0 };
}
