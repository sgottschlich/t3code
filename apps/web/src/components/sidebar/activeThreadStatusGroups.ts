import type { SidebarThreadStatus } from "../Sidebar.logic";

/**
 * Status groups the inbox is split into, in the order they appear. The order
 * is "what needs me, soonest first": the two states that block on the user,
 * then the failure that will block on them next, then work in flight, then
 * the resting pile.
 *
 * `monitoring` folds into `working` — a watch loop is live work, and a
 * separate one-row section for it would push the resting threads further
 * down for no decision the user makes differently.
 */
export const ACTIVE_STATUS_GROUPS = [
  { key: "approval", label: "Needs approval", statuses: ["approval"] },
  { key: "input", label: "Awaiting input", statuses: ["input"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "working", label: "Working", statuses: ["working", "monitoring"] },
  { key: "ready", label: "Ready", statuses: ["ready"] },
] as const satisfies ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly statuses: ReadonlyArray<SidebarThreadStatus>;
}>;

export type ActiveStatusGroupKey = (typeof ACTIVE_STATUS_GROUPS)[number]["key"];

const GROUP_KEY_BY_STATUS = new Map<SidebarThreadStatus, ActiveStatusGroupKey>(
  ACTIVE_STATUS_GROUPS.flatMap((group) =>
    group.statuses.map((status) => [status, group.key] as const),
  ),
);

export function activeStatusGroupKey(status: SidebarThreadStatus): ActiveStatusGroupKey {
  // Every SidebarThreadStatus is covered above; the fallback keeps a status
  // added upstream visible in the inbox instead of dropping its threads.
  return GROUP_KEY_BY_STATUS.get(status) ?? "ready";
}

export interface ActiveStatusGroup<TThread> {
  readonly key: ActiveStatusGroupKey;
  readonly label: string;
  readonly threads: readonly TThread[];
}

/**
 * Splits the inbox into status groups, keeping the incoming order inside each
 * group so the existing recency sort still decides who is on top. Empty
 * groups are dropped: a header with nothing under it is noise.
 */
export function groupActiveThreadsByStatus<TThread>(
  threads: readonly TThread[],
  statusOf: (thread: TThread) => SidebarThreadStatus,
): ReadonlyArray<ActiveStatusGroup<TThread>> {
  const byGroup = new Map<ActiveStatusGroupKey, TThread[]>();
  for (const thread of threads) {
    const key = activeStatusGroupKey(statusOf(thread));
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(thread);
    else byGroup.set(key, [thread]);
  }
  return ACTIVE_STATUS_GROUPS.flatMap((group) => {
    const groupThreads = byGroup.get(group.key);
    return groupThreads === undefined
      ? []
      : [{ key: group.key, label: group.label, threads: groupThreads }];
  });
}
