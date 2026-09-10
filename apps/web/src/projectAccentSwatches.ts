import type { ProjectIconColor } from "@t3tools/contracts";

// Spelled out rather than interpolated: Tailwind only emits classes it can see
// as complete strings in the source.
const PROJECT_ACCENT_SWATCH_CLASSES: Record<ProjectIconColor, string> = {
  gray: "bg-gray-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
  lime: "bg-lime-500",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  purple: "bg-purple-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
};

/** Tailwind background class for an accent, for solid marks like the favicon badge. */
export function projectAccentSwatchClassName(color: ProjectIconColor): string {
  return PROJECT_ACCENT_SWATCH_CLASSES[color];
}

/** CSS color for an accent, as a Tailwind v4 palette variable, for gradients and shadows. */
export function projectAccentCssColor(color: ProjectIconColor): string {
  return `var(--color-${color}-500)`;
}
