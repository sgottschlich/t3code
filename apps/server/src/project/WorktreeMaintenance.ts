import {
  ProjectMaintenanceError,
  ThreadId,
  type ProjectId,
  type WorktreeCleanupScan,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

const isMaintenanceError = Schema.is(ProjectMaintenanceError);

/** Git's -z format preserves spaces, newlines and non-ASCII paths. */
export function parseWorktrees(output: string) {
  return output.split("\0\0").flatMap((record) => {
    const fields = record.split("\0");
    const location = fields.find((field) => field.startsWith("worktree "));
    if (!location) return [];
    return [
      {
        path: location.slice(9),
        branch: fields.find((field) => field.startsWith("branch "))?.slice(7) ?? null,
        locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      },
    ];
  });
}

export const makeWorktreeMaintenance = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const git = yield* GitVcsDriver;
  const canonical = (value: string) =>
    fs.realPath(value).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(path.resolve(value))
            : Effect.fail(error),
      }),
    );
  const within = (root: string, value: string) => {
    const relative = path.relative(root, value);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const project = Effect.fn("WorktreeMaintenance.project")(function* (projectId: ProjectId) {
    const rows = yield* sql<{
      workspace_root: string;
    }>`SELECT workspace_root FROM projection_projects WHERE project_id = ${projectId} AND deleted_at IS NULL`;
    if (!rows[0])
      return yield* new ProjectMaintenanceError({ message: "Project no longer exists." });
    return rows[0].workspace_root;
  });
  const scan = Effect.fn("WorktreeMaintenance.scan")(function* (
    projectId: ProjectId,
    target?: string,
  ) {
    const cwd = yield* project(projectId);
    const registered = yield* git.execute({
      operation: "WorktreeMaintenance.list",
      cwd,
      args: ["worktree", "list", "--porcelain", "-z"],
    });
    if (registered.stdoutTruncated)
      return yield* new ProjectMaintenanceError({
        message: "Worktree list was truncated; cleanup is unavailable.",
      });
    const worktrees = parseWorktrees(registered.stdout);
    const references = yield* sql<{
      thread_id: string;
      title: string;
      project_id: string;
      worktree_path: string;
    }>`SELECT thread_id, title, project_id, worktree_path FROM projection_threads WHERE deleted_at IS NULL AND worktree_path IS NOT NULL`;
    const projectRoots = yield* sql<{
      workspace_root: string;
    }>`SELECT workspace_root FROM projection_projects WHERE deleted_at IS NULL`;
    const activeSessions = yield* sql<{
      worktree_path: string;
    }>`SELECT t.worktree_path FROM projection_threads t JOIN provider_session_runtime r ON r.thread_id = t.thread_id WHERE r.status IN ('starting', 'running') AND t.worktree_path IS NOT NULL`;
    const protectedPaths = new Set(
      yield* Effect.forEach(
        [
          ...new Set([
            ...references.map((row) => row.worktree_path),
            ...activeSessions.map((row) => row.worktree_path),
            ...projectRoots.map((row) => row.workspace_root),
            ...(worktrees[0] ? [worktrees[0].path] : []),
          ]),
        ],
        canonical,
        { concurrency: 8 },
      ),
    );
    const roots = yield* Effect.forEach(
      [config.worktreesDir, path.join(config.baseDir, "worktrees")],
      canonical,
    );
    const candidates: Array<WorktreeCleanupScan["candidates"][number]> = [];
    for (const worktree of worktrees) {
      if (target !== undefined && worktree.path !== target) continue;
      const real = yield* canonical(worktree.path);
      if (
        protectedPaths.has(real) ||
        !roots.some((root) => within(root, real)) ||
        !(yield* fs.exists(worktree.path))
      )
        continue;
      const status = yield* git.execute({
        operation: "WorktreeMaintenance.status",
        cwd: worktree.path,
        args: ["status", "--porcelain", "-z", "--untracked-files=normal"],
      });
      candidates.push({
        ...worktree,
        modified: status.stdout.length > 0 || status.stdoutTruncated,
      });
    }
    const missingThreads: Array<WorktreeCleanupScan["missingThreads"][number]> = [];
    for (const ref of references.filter(
      (row) => target === undefined && row.project_id === projectId,
    )) {
      if (!(yield* fs.exists(ref.worktree_path)))
        missingThreads.push({
          threadId: ThreadId.make(ref.thread_id),
          title: ref.title,
          path: ref.worktree_path,
        });
    }
    return { candidates, missingThreads } satisfies WorktreeCleanupScan;
  });
  const remove = Effect.fn("WorktreeMaintenance.remove")(function* (
    projectId: ProjectId,
    target: string,
  ) {
    // Re-read all references, including archived threads, immediately before deletion.
    const current = yield* scan(projectId, target);
    const candidate = current.candidates.find((entry) => entry.path === target);
    if (!candidate || candidate.modified || candidate.locked || candidate.branch === null)
      return yield* new ProjectMaintenanceError({
        message:
          "Worktree is in use, modified, locked, detached, or no longer eligible. Refresh the list.",
      });
    yield* git.removeWorktree({ cwd: yield* project(projectId), path: target, force: false });
  });
  const failure = (cause: unknown) =>
    isMaintenanceError(cause)
      ? cause
      : new ProjectMaintenanceError({
          message: "Could not inspect or remove the worktree. No forced deletion was performed.",
        });
  return {
    scan: (projectId: ProjectId) => scan(projectId).pipe(Effect.mapError(failure)),
    remove: (projectId: ProjectId, target: string) =>
      remove(projectId, target).pipe(Effect.mapError(failure)),
  };
});
export type WorktreeMaintenance = Effect.Success<typeof makeWorktreeMaintenance>;
