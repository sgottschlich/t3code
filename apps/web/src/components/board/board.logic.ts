import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, hasQueuedTurnStart } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { isLatestTurnSettled } from "../../session-logic";
import { firstValidTimestampMs, resolveWorkingStartedAt } from "../Sidebar.logic";

export type BoardColumnId = "needs-you" | "working" | "done" | "parked";

/**
 * One thread state per card. The first four need the user, the next four are
 * the agent's, "done" is a finished turn the user has not moved on from, and
 * the last three are parked one way or another.
 */
export type BoardCardStatus =
  | "approval"
  | "input"
  | "plan"
  | "failed"
  | "starting"
  | "working"
  | "monitoring"
  | "queued"
  | "done"
  | "snoozed"
  | "settled"
  | "idle";

export interface BoardCard {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly status: BoardCardStatus;
  readonly column: BoardColumnId;
  /** ISO time the card entered its current state, for the "since" label. */
  readonly since: string | null;
}

export interface BoardColumn {
  readonly id: BoardColumnId;
  readonly cards: ReadonlyArray<BoardCard>;
}

export interface BoardProjectFilter {
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
}

export const BOARD_COLUMN_IDS: ReadonlyArray<BoardColumnId> = [
  "needs-you",
  "working",
  "done",
  "parked",
];

export const BOARD_COLUMN_LABELS: Record<BoardColumnId, string> = {
  "needs-you": "Needs you",
  working: "Working",
  done: "Done",
  parked: "Parked",
};

export const BOARD_STATUS_LABELS: Record<BoardCardStatus, string> = {
  approval: "Approval",
  input: "Question",
  plan: "Plan ready",
  failed: "Failed",
  starting: "Connecting",
  working: "Working",
  monitoring: "Monitoring",
  queued: "Queued",
  done: "Done",
  snoozed: "Snoozed",
  settled: "Settled",
  idle: "Idle",
};

/** A finished turn older than this reads as parked, not as something to pick up. */
export const BOARD_DONE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const COLUMN_BY_STATUS: Record<BoardCardStatus, BoardColumnId> = {
  approval: "needs-you",
  input: "needs-you",
  plan: "needs-you",
  failed: "needs-you",
  starting: "working",
  working: "working",
  monitoring: "working",
  queued: "working",
  done: "done",
  snoozed: "parked",
  settled: "parked",
  idle: "parked",
};

export function boardCardKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return `${thread.environmentId}:${thread.id}`;
}

/**
 * Mirrors the sidebar's status resolution (attention states first, then live
 * work, then the plan prompt) so a card never sits in a column its sidebar
 * pill contradicts. Snooze outranks everything that has not raised the
 * thread's hand, matching the sidebar's snoozed shelf.
 */
export function resolveBoardCardStatus(
  thread: EnvironmentThreadShell,
  options: { readonly now: string },
): BoardCardStatus {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  if (effectiveSnoozed(thread, options)) return "snoozed";
  if (thread.session?.status === "starting") return "starting";
  if (thread.session?.status === "running") return "working";
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") return "failed";
  if (thread.backgroundLiveness === "working") return "working";
  if (thread.backgroundLiveness === "monitoring") return "monitoring";
  if (hasQueuedTurnStart(thread, options)) return "queued";
  if (
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  ) {
    return "plan";
  }
  if (thread.settledOverride === "settled") return "settled";
  const completedAt = thread.latestTurn?.completedAt ?? null;
  if (completedAt !== null) {
    const completedAtMs = Date.parse(completedAt);
    const nowMs = Date.parse(options.now);
    if (
      !Number.isNaN(completedAtMs) &&
      !Number.isNaN(nowMs) &&
      nowMs - completedAtMs < BOARD_DONE_MAX_AGE_MS
    ) {
      return "done";
    }
  }
  return "idle";
}

export function resolveBoardColumn(status: BoardCardStatus): BoardColumnId {
  return COLUMN_BY_STATUS[status];
}

/**
 * When the card entered its state. A request has no timestamp on the shell,
 * and `updatedAt` is no substitute: pull request sync and settlement sweeps
 * stamp it while the agent waits, which would reset a day-old question to
 * "now" and drop it to the bottom. The start of the turn that asked is
 * earlier than the question itself, but it stays put.
 */
export function resolveBoardCardSince(
  thread: EnvironmentThreadShell,
  status: BoardCardStatus,
): string | null {
  switch (status) {
    case "approval":
    case "input":
      return firstValid(
        thread.latestTurn?.startedAt,
        thread.latestTurn?.requestedAt,
        thread.updatedAt,
      );
    case "plan":
      return thread.latestTurn?.completedAt ?? thread.updatedAt;
    case "failed":
      return firstValid(
        thread.session?.updatedAt,
        thread.latestTurn?.completedAt,
        thread.updatedAt,
      );
    case "starting":
    case "working":
    case "monitoring":
      return resolveWorkingStartedAt(thread) ?? thread.updatedAt;
    case "queued":
      return thread.latestUserMessageAt ?? thread.updatedAt;
    case "done":
      return thread.latestTurn?.completedAt ?? thread.updatedAt;
    case "snoozed":
      return thread.snoozedAt ?? thread.updatedAt;
    case "settled":
      return thread.settledAt ?? thread.updatedAt;
    case "idle":
      return firstValid(thread.latestTurn?.completedAt, thread.updatedAt);
  }
}

function firstValid(...candidates: ReadonlyArray<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (!Number.isNaN(Date.parse(candidate))) return candidate;
  }
  return null;
}

export function matchesBoardProjectFilter(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
  filter: BoardProjectFilter,
): boolean {
  if (filter.environmentId !== undefined && thread.environmentId !== filter.environmentId) {
    return false;
  }
  if (filter.projectId !== undefined && thread.projectId !== filter.projectId) {
    return false;
  }
  return true;
}

export function resolveBoardCard(
  thread: EnvironmentThreadShell,
  options: { readonly now: string },
): BoardCard {
  const status = resolveBoardCardStatus(thread, options);
  return {
    key: boardCardKey(thread),
    thread,
    status,
    column: resolveBoardColumn(status),
    since: resolveBoardCardSince(thread, status),
  };
}

/**
 * Archived threads never show. "Needs you" puts the longest wait on top, so
 * the oldest question is the first one answered; every other column reads
 * newest first.
 */
export function buildBoardColumns(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  options: { readonly now: string; readonly filter?: BoardProjectFilter },
): ReadonlyArray<BoardColumn> {
  const filter = options.filter ?? {};
  const cardsByColumn = new Map<BoardColumnId, BoardCard[]>(
    BOARD_COLUMN_IDS.map((id) => [id, []] as const),
  );
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (!matchesBoardProjectFilter(thread, filter)) continue;
    const card = resolveBoardCard(thread, options);
    cardsByColumn.get(card.column)?.push(card);
  }
  return BOARD_COLUMN_IDS.map((id) => {
    const cards = cardsByColumn.get(id) ?? [];
    const sinceMs = (card: BoardCard) => firstValidTimestampMs(card.since, card.thread.updatedAt);
    cards.sort((left, right) =>
      id === "needs-you"
        ? sinceMs(left) - sinceMs(right) || left.key.localeCompare(right.key)
        : sinceMs(right) - sinceMs(left) || left.key.localeCompare(right.key),
    );
    return { id, cards };
  });
}

/** Unfiltered on purpose: the badge says how much is waiting, not how much the filter shows. */
export function countBoardThreadsNeedingUser(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  options: { readonly now: string },
): number {
  let count = 0;
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (resolveBoardColumn(resolveBoardCardStatus(thread, options)) === "needs-you") count += 1;
  }
  return count;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "now", "4m", "3h", "2d". Coarse on purpose: the board is read at a glance. */
export function formatBoardSinceLabel(
  since: string | null,
  options: { readonly now: string },
): string | null {
  if (since === null) return null;
  const sinceMs = Date.parse(since);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(sinceMs) || Number.isNaN(nowMs)) return null;
  const elapsed = Math.max(0, nowMs - sinceMs);
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  return `${Math.floor(elapsed / DAY_MS)}d`;
}
