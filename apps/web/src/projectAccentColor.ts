import type { ProjectIconColor } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { PROJECT_ICON_COLOR_BY_NAME } from "./components/ProjectFavicon";
import { selectProjectIcon } from "./projectIconModel";

/**
 * The slice of a project its accent color is derived from. Same shape as
 * ProjectFaviconProject minus the favicon: a project keeps its accent even
 * when a favicon image hides the icon that named the color.
 */
export type ProjectAccentSource = Pick<
  EnvironmentProject,
  "title" | "workspaceRoot" | "projectIcon"
>;

/**
 * A project's accent color: the icon override's color when the user picked a
 * lucide icon, otherwise the color of the automatically selected icon. Emoji
 * overrides carry no color, so they have no accent.
 */
export function resolveProjectAccentColor(
  project: ProjectAccentSource | null | undefined,
): ProjectIconColor | null {
  if (!project) return null;
  if (project.projectIcon?.kind === "emoji") return null;
  if (project.projectIcon?.kind === "lucide") return project.projectIcon.color;
  const automatic = selectProjectIcon(project.title, project.workspaceRoot);
  return automatic.kind === "lucide" ? PROJECT_ICON_COLOR_BY_NAME[automatic.icon] : null;
}
