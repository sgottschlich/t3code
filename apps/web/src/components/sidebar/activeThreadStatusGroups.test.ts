import { describe, expect, it } from "vite-plus/test";

import type { SidebarThreadStatus } from "../Sidebar.logic";
import {
  activeStatusGroupKey,
  groupActiveThreadsByStatus,
} from "./activeThreadStatusGroups";

const thread = (id: string, status: SidebarThreadStatus) => ({ id, status });
const statusOf = (input: { status: SidebarThreadStatus }) => input.status;

describe("activeStatusGroupKey", () => {
  it("folds monitoring into working", () => {
    expect(activeStatusGroupKey("monitoring")).toBe("working");
    expect(activeStatusGroupKey("working")).toBe("working");
  });

  it("keeps the blocking states apart", () => {
    expect(activeStatusGroupKey("approval")).toBe("approval");
    expect(activeStatusGroupKey("input")).toBe("input");
    expect(activeStatusGroupKey("failed")).toBe("failed");
  });
});

describe("groupActiveThreadsByStatus", () => {
  it("orders groups by urgency, not by input order", () => {
    const groups = groupActiveThreadsByStatus(
      [
        thread("a", "ready"),
        thread("b", "working"),
        thread("c", "approval"),
        thread("d", "failed"),
        thread("e", "input"),
      ],
      statusOf,
    );

    expect(groups.map((group) => group.key)).toEqual([
      "approval",
      "input",
      "failed",
      "working",
      "ready",
    ]);
  });

  it("keeps the incoming order inside a group", () => {
    const groups = groupActiveThreadsByStatus(
      [thread("first", "ready"), thread("second", "ready"), thread("third", "ready")],
      statusOf,
    );

    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["first", "second", "third"]);
  });

  it("drops empty groups", () => {
    const groups = groupActiveThreadsByStatus([thread("a", "working")], statusOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("working");
  });

  it("puts monitoring threads in the working group", () => {
    const groups = groupActiveThreadsByStatus(
      [thread("watch", "monitoring"), thread("run", "working")],
      statusOf,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["watch", "run"]);
  });

  it("loses no thread", () => {
    const input = [
      thread("a", "ready"),
      thread("b", "monitoring"),
      thread("c", "approval"),
      thread("d", "input"),
      thread("e", "failed"),
      thread("f", "working"),
    ];

    const grouped = groupActiveThreadsByStatus(input, statusOf).flatMap((group) => group.threads);

    expect(grouped).toHaveLength(input.length);
    expect(new Set(grouped.map((entry) => entry.id))).toEqual(
      new Set(input.map((entry) => entry.id)),
    );
  });

  it("has no groups for an empty inbox", () => {
    expect(groupActiveThreadsByStatus([], statusOf)).toEqual([]);
  });
});
