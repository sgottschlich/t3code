import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";

import {
  BOARD_DONE_MAX_AGE_MS,
  buildBoardColumns,
  countBoardThreadsNeedingUser,
  formatBoardSinceLabel,
  resolveBoardCardSince,
  resolveBoardCardStatus,
} from "./board.logic";

const NOW = "2026-09-13T12:00:00.000Z";
const environmentId = EnvironmentId.make("environment-local");

function minutesBefore(minutes: number): string {
  return new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
}

function makeShell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: minutesBefore(600),
    updatedAt: minutesBefore(30),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

function completedTurn(minutesAgo: number): NonNullable<EnvironmentThreadShell["latestTurn"]> {
  return {
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: minutesBefore(minutesAgo + 5),
    startedAt: minutesBefore(minutesAgo + 4),
    completedAt: minutesBefore(minutesAgo),
    assistantMessageId: null,
  };
}

function session(
  status: "starting" | "running" | "stopped" | "error",
  overrides: Partial<NonNullable<EnvironmentThreadShell["session"]>> = {},
): EnvironmentThreadShell["session"] {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "codex",
    runtimeMode: "approval-required",
    activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
    lastError: status === "error" ? "boom" : null,
    updatedAt: minutesBefore(10),
    ...overrides,
  };
}

describe("resolveBoardCardStatus", () => {
  it("puts requests ahead of everything else", () => {
    expect(
      resolveBoardCardStatus(
        makeShell({ hasPendingApprovals: true, session: session("running") }),
        { now: NOW },
      ),
    ).toBe("approval");
    expect(
      resolveBoardCardStatus(
        makeShell({ hasPendingUserInput: true, session: session("running") }),
        { now: NOW },
      ),
    ).toBe("input");
  });

  it("keeps a snoozed thread parked unless it raised its hand", () => {
    const snoozed = makeShell({
      snoozedAt: minutesBefore(60),
      snoozedUntil: new Date(Date.parse(NOW) + 60 * 60_000).toISOString(),
      latestTurn: completedTurn(90),
    });
    expect(resolveBoardCardStatus(snoozed, { now: NOW })).toBe("snoozed");
    // A turn that completed after the snooze wakes the thread up.
    expect(resolveBoardCardStatus({ ...snoozed, latestTurn: completedTurn(5) }, { now: NOW })).toBe(
      "done",
    );
    // A stale failure the user snoozed over stays parked.
    expect(
      resolveBoardCardStatus(
        { ...snoozed, session: session("error", { updatedAt: minutesBefore(120) }) },
        { now: NOW },
      ),
    ).toBe("snoozed");
  });

  it("reads live sessions and background work as working", () => {
    expect(resolveBoardCardStatus(makeShell({ session: session("starting") }), { now: NOW })).toBe(
      "starting",
    );
    expect(resolveBoardCardStatus(makeShell({ session: session("running") }), { now: NOW })).toBe(
      "working",
    );
    expect(
      resolveBoardCardStatus(
        makeShell({ session: session("stopped"), backgroundLiveness: "working" }),
        { now: NOW },
      ),
    ).toBe("working");
    expect(
      resolveBoardCardStatus(
        makeShell({ session: session("stopped"), backgroundLiveness: "monitoring" }),
        { now: NOW },
      ),
    ).toBe("monitoring");
  });

  it("treats a message no turn has adopted yet as queued work", () => {
    expect(
      resolveBoardCardStatus(
        makeShell({ latestUserMessageAt: minutesBefore(1), latestTurn: completedTurn(30) }),
        { now: NOW },
      ),
    ).toBe("queued");
  });

  it("surfaces failures over lingering background work", () => {
    expect(
      resolveBoardCardStatus(
        makeShell({ session: session("error"), backgroundLiveness: "working" }),
        { now: NOW },
      ),
    ).toBe("failed");
  });

  it("only offers a plan once the turn has settled", () => {
    const planThread = makeShell({
      interactionMode: "plan",
      hasActionableProposedPlan: true,
      latestTurn: completedTurn(5),
      session: session("stopped"),
    });
    expect(resolveBoardCardStatus(planThread, { now: NOW })).toBe("plan");
    expect(
      resolveBoardCardStatus({ ...planThread, session: session("running") }, { now: NOW }),
    ).toBe("working");
  });

  it("moves finished work from done to idle after a day", () => {
    expect(resolveBoardCardStatus(makeShell({ latestTurn: completedTurn(60) }), { now: NOW })).toBe(
      "done",
    );
    const justUnderADay = makeShell({
      latestTurn: completedTurn(BOARD_DONE_MAX_AGE_MS / 60_000 - 1),
    });
    expect(resolveBoardCardStatus(justUnderADay, { now: NOW })).toBe("done");
    const overADay = makeShell({
      latestTurn: completedTurn(BOARD_DONE_MAX_AGE_MS / 60_000 + 1),
    });
    expect(resolveBoardCardStatus(overADay, { now: NOW })).toBe("idle");
  });

  it("parks settled threads and threads that never ran", () => {
    expect(
      resolveBoardCardStatus(
        makeShell({ settledOverride: "settled", latestTurn: completedTurn(5) }),
        { now: NOW },
      ),
    ).toBe("settled");
    expect(resolveBoardCardStatus(makeShell(), { now: NOW })).toBe("idle");
  });
});

describe("resolveBoardCardSince", () => {
  it("anchors requests to the asking turn, not to the last projection write", () => {
    const runningTurn = { ...completedTurn(9), state: "running" as const, completedAt: null };
    const thread = makeShell({
      hasPendingUserInput: true,
      latestTurn: runningTurn,
      updatedAt: minutesBefore(1),
    });
    expect(resolveBoardCardSince(thread, "input")).toBe(runningTurn.startedAt);
    expect(
      resolveBoardCardSince({ ...thread, latestTurn: null, updatedAt: minutesBefore(7) }, "input"),
    ).toBe(minutesBefore(7));
  });

  it("uses the turn completion for done cards", () => {
    const thread = makeShell({ latestTurn: completedTurn(12), updatedAt: minutesBefore(1) });
    expect(resolveBoardCardSince(thread, "done")).toBe(minutesBefore(12));
  });
});

describe("buildBoardColumns", () => {
  it("drops archived threads and honors the project filter", () => {
    const columns = buildBoardColumns(
      [
        makeShell({ id: ThreadId.make("a"), archivedAt: minutesBefore(1) }),
        makeShell({ id: ThreadId.make("b"), projectId: ProjectId.make("project-2") }),
        makeShell({ id: ThreadId.make("c") }),
      ],
      { now: NOW, filter: { projectId: ProjectId.make("project-1") } },
    );
    expect(columns.flatMap((column) => column.cards.map((card) => card.thread.id))).toEqual(["c"]);
  });

  it("orders the longest wait first in needs-you and newest first elsewhere", () => {
    const columns = buildBoardColumns(
      [
        makeShell({
          id: ThreadId.make("waiting-recent"),
          hasPendingUserInput: true,
          updatedAt: minutesBefore(2),
        }),
        makeShell({
          id: ThreadId.make("waiting-old"),
          hasPendingUserInput: true,
          updatedAt: minutesBefore(40),
        }),
        makeShell({ id: ThreadId.make("done-old"), latestTurn: completedTurn(50) }),
        makeShell({ id: ThreadId.make("done-recent"), latestTurn: completedTurn(3) }),
      ],
      { now: NOW },
    );
    const byId = new Map(columns.map((column) => [column.id, column.cards]));
    expect(byId.get("needs-you")?.map((card) => card.thread.id)).toEqual([
      "waiting-old",
      "waiting-recent",
    ]);
    expect(byId.get("done")?.map((card) => card.thread.id)).toEqual(["done-recent", "done-old"]);
    expect(byId.get("working")).toEqual([]);
  });
});

describe("countBoardThreadsNeedingUser", () => {
  it("counts every attention state, ignoring archived threads", () => {
    const count = countBoardThreadsNeedingUser(
      [
        makeShell({ id: ThreadId.make("a"), hasPendingApprovals: true }),
        makeShell({ id: ThreadId.make("b"), session: session("error") }),
        makeShell({ id: ThreadId.make("c"), hasPendingUserInput: true, archivedAt: NOW }),
        makeShell({ id: ThreadId.make("d"), session: session("running") }),
      ],
      { now: NOW },
    );
    expect(count).toBe(2);
  });
});

describe("formatBoardSinceLabel", () => {
  it("rounds down to the coarsest unit that is still non-zero", () => {
    expect(formatBoardSinceLabel(minutesBefore(0), { now: NOW })).toBe("now");
    expect(formatBoardSinceLabel(minutesBefore(4), { now: NOW })).toBe("4m");
    expect(formatBoardSinceLabel(minutesBefore(150), { now: NOW })).toBe("2h");
    expect(formatBoardSinceLabel(minutesBefore(60 * 49), { now: NOW })).toBe("2d");
    expect(formatBoardSinceLabel("not a date", { now: NOW })).toBeNull();
    expect(formatBoardSinceLabel(null, { now: NOW })).toBeNull();
  });
});
