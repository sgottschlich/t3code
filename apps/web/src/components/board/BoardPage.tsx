import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, FolderIcon, LayersIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BoardCardPopover } from "./BoardCardPopover";
import {
  BOARD_COLUMN_LABELS,
  BOARD_STATUS_LABELS,
  buildBoardColumns,
  formatBoardSinceLabel,
  type BoardCard,
  type BoardCardStatus,
  type BoardColumnId,
  type BoardProjectFilter,
} from "./board.logic";

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderInstanceEntry> = new Map();
const ALL_PROJECTS = "all";

// The same hues the sidebar pills and the mobile widgets use for these states.
const STATUS_DOT_CLASS: Record<BoardCardStatus, string> = {
  approval: "bg-amber-500 dark:bg-amber-300/90",
  input: "bg-indigo-500 dark:bg-indigo-300/90",
  plan: "bg-violet-500 dark:bg-violet-300/90",
  failed: "bg-destructive",
  starting: "bg-sky-500 dark:bg-sky-300/80",
  working: "bg-sky-500 dark:bg-sky-300/80",
  monitoring: "bg-sky-500/70 dark:bg-sky-300/60",
  queued: "bg-sky-500/70 dark:bg-sky-300/60",
  done: "bg-emerald-500 dark:bg-emerald-300/90",
  snoozed: "bg-muted-foreground/50",
  settled: "bg-muted-foreground/50",
  idle: "bg-muted-foreground/40",
};

function projectFilterKey(filter: BoardProjectFilter): string {
  return filter.projectId === undefined
    ? ALL_PROJECTS
    : `${filter.environmentId ?? ""}:${filter.projectId}`;
}

export function BoardPage(props: {
  readonly filter: BoardProjectFilter;
  readonly onFilterChange: (filter: BoardProjectFilter) => void;
}) {
  const { filter, onFilterChange } = props;
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { environments } = useEnvironments();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  // Minute-quantized: the columns only move on the 24h boundary and the
  // "since" labels are coarse anyway, so a finer clock would just repaint.
  const nowMinute = useNowMinute();
  const now = `${nowMinute}:00.000Z`;

  // A filter naming a project this workspace no longer has falls back to
  // everything rather than to an empty board with no visible reason.
  const scopedFilter = useMemo((): BoardProjectFilter => {
    if (filter.projectId === undefined) return {};
    const match = projects.find(
      (project) =>
        project.id === filter.projectId &&
        (filter.environmentId === undefined || project.environmentId === filter.environmentId),
    );
    if (!match) return {};
    return { environmentId: match.environmentId, projectId: match.id };
  }, [filter.environmentId, filter.projectId, projects]);

  const columns = useMemo(
    () => buildBoardColumns(threads, { now, filter: scopedFilter }),
    [now, scopedFilter, threads],
  );
  const cardByKey = useMemo(
    () => new Map(columns.flatMap((column) => column.cards.map((card) => [card.key, card]))),
    [columns],
  );

  const providerEntriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(([environmentId, config]) => [environmentId, config.providers]),
      ),
    [serverConfigs],
  );
  const showEnvironmentLabels = environments.length > 1;
  const environmentLabelById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const projectLabelByKey = useMemo(
    () =>
      new Map<string, string>(
        projects.map((project) => {
          const environmentLabel = environmentLabelById.get(project.environmentId);
          const label =
            showEnvironmentLabels && environmentLabel
              ? `${project.title} · ${environmentLabel}`
              : project.title;
          return [`${project.environmentId}:${project.id}`, label] as const;
        }),
      ),
    [environmentLabelById, projects, showEnvironmentLabels],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .map((project) => ({
          key: `${project.environmentId}:${project.id}`,
          environmentId: project.environmentId,
          projectId: project.id,
          label: projectLabelByKey.get(`${project.environmentId}:${project.id}`) ?? project.title,
        }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [projectLabelByKey, projects],
  );

  // One open card at a time. The column is remembered so a card that moves
  // (an answered question starts the agent) takes its popover with it.
  const [active, setActive] = useState<{ key: string; column: BoardColumnId } | null>(null);
  const activeCard = active ? (cardByKey.get(active.key) ?? null) : null;
  const openKey = active && activeCard && activeCard.column === active.column ? active.key : null;
  // Once the card has left its column the popover is closed for good: cleared
  // during render, so a later return to that column does not pop it back open.
  if (active !== null && openKey === null) setActive(null);

  const openThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      setActive(null);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [navigate],
  );
  const closePopover = useCallback(() => setActive(null), []);

  const selectedProjectKey = projectFilterKey(scopedFilter);
  const selectedProjectLabel =
    selectedProjectKey === ALL_PROJECTS
      ? "All projects"
      : (projectLabelByKey.get(selectedProjectKey) ?? "All projects");
  const hasThreads = threads.some((thread) => thread.archivedAt === null);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Board breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Board</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {projectOptions.length > 1 ? (
            <Menu>
              <MenuTrigger
                render={<Button size="xs" variant="outline" aria-label="Filter by project" />}
              >
                {selectedProjectKey === ALL_PROJECTS ? (
                  <LayersIcon className="size-3.5" />
                ) : (
                  <FolderIcon className="size-3.5" />
                )}
                <span className="max-w-48 truncate">{selectedProjectLabel}</span>
                <ChevronDownIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" className="max-w-80">
                <MenuRadioGroup
                  value={selectedProjectKey}
                  onValueChange={(value) => {
                    const option = projectOptions.find((candidate) => candidate.key === value);
                    onFilterChange(
                      option
                        ? { environmentId: option.environmentId, projectId: option.projectId }
                        : {},
                    );
                  }}
                >
                  <MenuRadioItem value={ALL_PROJECTS}>All projects</MenuRadioItem>
                  {projectOptions.map((option) => (
                    <MenuRadioItem key={option.key} value={option.key}>
                      <span className="block truncate">{option.label}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          ) : null}
        </WorkspacePageHeader>

        {!hasThreads ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            {bootstrapped ? "No threads yet. Start one and it shows up here." : "Loading threads"}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-5">
            {columns.map((column) => (
              <section
                key={column.id}
                aria-label={BOARD_COLUMN_LABELS[column.id]}
                className="flex min-h-0 min-w-[260px] flex-1 flex-col rounded-lg bg-muted/25"
              >
                <header className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {BOARD_COLUMN_LABELS[column.id]}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {column.cards.length}
                  </span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                  {column.cards.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground/70">Nothing here.</p>
                  ) : (
                    column.cards.map((card) => (
                      <BoardCardItem
                        key={card.key}
                        card={card}
                        now={now}
                        open={openKey === card.key}
                        projectLabel={
                          projectLabelByKey.get(
                            `${card.thread.environmentId}:${card.thread.projectId}`,
                          ) ?? null
                        }
                        providerEntries={
                          providerEntriesByEnvironment.get(card.thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
                        }
                        onOpenChange={(open) =>
                          setActive(open ? { key: card.key, column: card.column } : null)
                        }
                        onOpenThread={openThread}
                        onClose={closePopover}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

const BoardCardItem = memo(function BoardCardItem(props: {
  readonly card: BoardCard;
  readonly now: string;
  readonly open: boolean;
  readonly projectLabel: string | null;
  readonly providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onClose: () => void;
}) {
  const { card, now, open, projectLabel, providerEntries, onOpenChange, onOpenThread, onClose } =
    props;
  const thread = card.thread;
  const providerInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = providerEntries.get(providerInstanceId) ?? null;
  const sinceLabel = formatBoardSinceLabel(card.since, { now });
  const openThread = useCallback(() => onOpenThread(thread), [onOpenThread, thread]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer flex-col gap-1 rounded-md border border-border/60 bg-card px-2.5 py-2 text-left outline-none transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-ring",
              open && "border-border ring-1 ring-ring/40",
              card.status === "snoozed" && "opacity-60",
            )}
          />
        }
        onDoubleClick={openThread}
        data-board-card={card.status}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {providerEntry ? (
            <ProviderInstanceIcon
              driverKind={providerEntry.driverKind}
              displayName={providerEntry.displayName}
              accentColor={providerEntry.accentColor}
              className="size-4"
              iconClassName="size-3.5"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {thread.title}
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{projectLabel ?? ""}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", STATUS_DOT_CLASS[card.status])}
            />
            {BOARD_STATUS_LABELS[card.status]}
            {sinceLabel ? <span className="tabular-nums">· {sinceLabel}</span> : null}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" sideOffset={6}>
        <BoardCardPopover card={card} onOpenThread={openThread} onClose={onClose} />
      </PopoverPopup>
    </Popover>
  );
});
