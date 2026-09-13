import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { BoardPage } from "../components/board/BoardPage";
import type { BoardProjectFilter } from "../components/board/board.logic";

/**
 * The project scope lives only in the URL, so a link carries it and opening
 * the board fresh never hides a project the reader forgot they filtered.
 */
export interface BoardSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
}

export const Route = createFileRoute("/_chat/board")({
  validateSearch: (raw: Record<string, unknown>): BoardSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
  }),
  component: BoardRouteView,
});

function BoardRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const onFilterChange = useCallback(
    (filter: BoardProjectFilter) =>
      void navigate({
        search: {
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.environmentId ? { environmentId: filter.environmentId } : {}),
        },
        replace: true,
      }),
    [navigate],
  );
  return <BoardPage filter={search} onFilterChange={onFilterChange} />;
}
