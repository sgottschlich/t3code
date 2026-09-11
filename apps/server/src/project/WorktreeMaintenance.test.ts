import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectId } from "@t3tools/contracts";
import { layerTest, ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { makeWorktreeMaintenance, parseWorktrees } from "./WorktreeMaintenance.ts";

it("parses NUL-delimited paths without losing whitespace or detached worktrees", () => {
  expect(
    parseWorktrees(
      "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /tmp/with\nnewline\0HEAD def\0detached\0locked reason\0\0",
    ),
  ).toEqual([
    { path: "/repo", branch: "refs/heads/main", locked: false },
    { path: "/tmp/with\nnewline", branch: null, locked: true },
  ]);
});

it.effect(
  "protects archived, shared, dirty, locked and external worktrees and rechecks before deletion",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "worktree-cleanup-test-" });
      const cwd = path.join(root, "repo");
      yield* fs.makeDirectory(cwd);
      const config = yield* ServerConfig.pipe(
        Effect.provide(layerTest(cwd, path.join(root, "t3"))),
      );
      const git = yield* GitVcsDriver.make.pipe(Effect.provideService(ServerConfig, config));
      const command = (args: ReadonlyArray<string>) =>
        git.execute({ operation: "test", cwd, args });
      yield* command(["init"]);
      yield* command([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-1', 'Test', ${cwd}, '[]', '2026-01-01', '2026-01-01')`;
      const locations = new Map<string, string>();
      for (const name of [
        "unused",
        "archived",
        "dirty",
        "locked",
        "external",
        "race",
        "session",
        "detached",
      ]) {
        const location = path.join(name === "external" ? root : config.worktreesDir, name);
        locations.set(name, location);
        yield* command(
          name === "detached"
            ? ["worktree", "add", "--detach", location]
            : ["worktree", "add", "-b", name, location],
        );
      }
      const reference = (id: string, location: string) =>
        sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, worktree_path, created_at, updated_at, archived_at) VALUES (${id}, 'project-1', ${id}, '{"instanceId":"codex","model":"test"}', ${location}, '2026-01-01', '2026-01-01', '2026-01-02')`;
      yield* reference("archived", locations.get("archived")!);
      yield* reference("shared", locations.get("archived")!);
      yield* reference("session", locations.get("session")!);
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-01-03' WHERE thread_id = 'session'`;
      yield* sql`INSERT INTO provider_session_runtime (thread_id, provider_name, adapter_key, status, last_seen_at) VALUES ('session', 'codex', 'codex', 'running', '2026-01-03')`;
      yield* reference("missing", path.join(root, "missing"));
      yield* fs.writeFileString(path.join(locations.get("dirty")!, "untracked.txt"), "keep me");
      yield* command(["worktree", "lock", locations.get("locked")!]);
      const maintenance = yield* makeWorktreeMaintenance.pipe(
        Effect.provideService(ServerConfig, config),
        Effect.provideService(GitVcsDriver.GitVcsDriver, git),
      );
      const result = yield* maintenance.scan(ProjectId.make("project-1"));
      expect(result.candidates.map((candidate) => path.basename(candidate.path)).sort()).toEqual([
        "detached",
        "dirty",
        "locked",
        "race",
        "unused",
      ]);
      expect(result.missingThreads.map((thread) => thread.threadId)).toEqual(["missing"]);
      yield* reference("new-reference", locations.get("race")!);
      for (const name of [
        "race",
        "dirty",
        "locked",
        "archived",
        "external",
        "detached",
        "session",
      ]) {
        const target =
          result.candidates.find((candidate) => path.basename(candidate.path) === name)?.path ??
          locations.get(name)!;
        expect(
          (yield* maintenance.remove(ProjectId.make("project-1"), target).pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(yield* fs.exists(locations.get(name)!)).toBe(true);
      }
      yield* maintenance.remove(
        ProjectId.make("project-1"),
        result.candidates.find((candidate) => path.basename(candidate.path) === "unused")!.path,
      );
      expect(yield* fs.exists(locations.get("unused")!)).toBe(false);
      expect((yield* command(["show-ref", "--verify", "refs/heads/unused"])).stdout).toContain(
        "refs/heads/unused",
      );
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);
