import type { ProjectIconColor } from "@t3tools/contracts";

import { projectAccentCssColor } from "~/projectAccentSwatches";

/**
 * Soft fade below the chat header's accent line: the active project's color
 * bleeds downward into the content so "which project am I in" reads without a
 * hard rule across the top. Static, so it costs nothing to keep on screen.
 */
export function ChatHeaderAccent({ color }: { color: ProjectIconColor | null }) {
  if (!color) return null;
  return (
    <div aria-hidden className="pointer-events-none relative z-10 h-0">
      <div
        className="absolute inset-x-0 top-0 h-8 opacity-20"
        style={{
          backgroundImage: `linear-gradient(to bottom, ${projectAccentCssColor(color)}, transparent)`,
        }}
      />
    </div>
  );
}

/** Inset bottom rule on the header itself, in the project's accent color. */
export function chatHeaderAccentStyle(color: ProjectIconColor | null) {
  if (!color) return {};
  return {
    style: {
      boxShadow: `inset 0 -2px 0 0 color-mix(in srgb, ${projectAccentCssColor(color)} 50%, transparent)`,
    },
  };
}
