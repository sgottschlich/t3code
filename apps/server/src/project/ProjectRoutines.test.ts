import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  ProjectId,
  ProviderInstanceId,
  type OrchestrationCommand,
  type ProjectRoutineInput,
} from "@t3tools/contracts";
import { layerTest, ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";
import { makeProjectRoutines, nextRoutineRun } from "./ProjectRoutines.ts";

const input: ProjectRoutineInput = {
  id: "routine-1",
  projectId: ProjectId.make("project-1"),
  name: "Review TODOs",
  prompt: "Report TODOs.",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "approval-required",
  enabled: true,
  firstRunAt: "1970-01-01T00:00:00.000Z",
  intervalMinutes: 60,
};
const startup = ServerRuntimeStartup.of({
  awaitCommandReady: Effect.void,
  markHttpListening: Effect.void,
  markRunningProviderSessionsForContinuation: Effect.succeed([]),
  clearProviderSessionContinuationMarkers: () => Effect.void,
  enqueueCommand: (effect) => effect,
});
const fixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "routine-test-" });
  const config = yield* ServerConfig.pipe(Effect.provide(layerTest(process.cwd(), root)));
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-1', 'Test', ${config.cwd}, '[]', '2026-01-01', '2026-01-01')`;
  const commands: Array<OrchestrationCommand> = [];
  const started = yield* Deferred.make<void>();
  let crashAfterCreate = false;
  const engine = OrchestrationEngineService.of({
    dispatch: (command) =>
      Effect.suspend(() => {
        commands.push(command);
        if (crashAfterCreate && command.type === "thread.create") {
          crashAfterCreate = false;
          return Effect.interrupt;
        }
        return (
          command.type === "thread.turn.start" ? Deferred.succeed(started, undefined) : Effect.void
        ).pipe(Effect.as({ sequence: commands.length }));
      }),
    readEvents: () => Stream.empty,
    readThreadEvents: () => Stream.empty,
    getThreadReplayStats: () => Effect.die("unused"),
    streamDomainEvents: Stream.empty,
    subscribeDomainEvents: Effect.succeed(Stream.empty),
    latestSequence: Effect.succeed(0),
  });
  const make = makeProjectRoutines.pipe(
    Effect.provideService(ServerConfig, config),
    Effect.provideService(OrchestrationEngineService, engine),
    Effect.provideService(ServerRuntimeStartup, startup),
  );
  return {
    sql,
    commands,
    make,
    started: Deferred.await(started),
    crash: () => {
      crashAfterCreate = true;
    },
  };
});

it.effect("starts a due one-shot from the server scheduler without a client", () =>
  Effect.gen(function* () {
    const { make, started, commands } = yield* fixture;
    const routines = yield* make;
    yield* routines.save({ ...input, intervalMinutes: null });
    yield* routines.start;
    yield* started;
    expect((yield* routines.list())[0]).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pendingRunAt: null,
    });
    expect(commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);

it.effect("does not run early and preserves pause when started manually", () =>
  Effect.gen(function* () {
    const { make, commands } = yield* fixture;
    const routines = yield* make;
    yield* routines.save({ ...input, firstRunAt: "2099-01-01T00:00:00.000Z" });
    yield* routines.tick;
    expect(commands).toHaveLength(0);
    yield* routines.save({ ...input, enabled: false });
    yield* routines.tick;
    expect(commands).toHaveLength(0);
    const result = yield* routines.run(input.id);
    expect(result.enabled).toBe(false);
    expect(commands).toHaveLength(2);
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);

it.effect("coalesces missed intervals, persists edits and skips overlapping runs", () =>
  Effect.gen(function* () {
    const { make, commands, sql } = yield* fixture;
    const routines = yield* make;
    yield* routines.save(input);
    yield* routines.tick;
    yield* routines.tick;
    expect(commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
    const current = (yield* routines.list())[0]!;
    expect(current.nextRunAt).toBe(nextRoutineRun(yield* Clock.currentTimeMillis, 60));
    yield* sql`INSERT INTO projection_turns (thread_id, state, requested_at, checkpoint_files_json) VALUES (${current.lastThreadId}, 'running', '2026-01-01', '[]')`;
    expect((yield* routines.run(input.id).pipe(Effect.result))._tag).toBe("Failure");
    expect(commands).toHaveLength(2);
    yield* routines.save({ ...input, enabled: false, prompt: "Updated" });
    const restarted = yield* make;
    expect((yield* restarted.list())[0]?.prompt).toBe("Updated");
    yield* restarted.tick;
    expect(commands).toHaveLength(2);
    yield* restarted.remove(input.id);
    expect(yield* restarted.list()).toEqual([]);
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);

it.effect("recovers a pending run with the same thread and command identities", () =>
  Effect.gen(function* () {
    const { make, commands, crash } = yield* fixture;
    const routines = yield* make;
    yield* routines.save({ ...input, intervalMinutes: null });
    crash();
    yield* routines.run(input.id).pipe(Effect.exit);
    const pending = (yield* routines.list())[0]!;
    expect(pending.pendingRunAt).not.toBeNull();
    const restarted = yield* make;
    yield* restarted.tick;
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[2]?.type).toBe("thread.turn.start");
    expect((yield* restarted.list())[0]).toMatchObject({
      lastThreadId: pending.lastThreadId,
      pendingRunAt: null,
      enabled: false,
      nextRunAt: null,
    });
    yield* restarted.tick;
    expect(commands).toHaveLength(3);
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);

it.effect("rejects invalid dates and missing projects without saving", () =>
  Effect.gen(function* () {
    const { make } = yield* fixture;
    const routines = yield* make;
    expect(
      (yield* routines.save({ ...input, firstRunAt: "invalid" }).pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      (yield* routines.save({ ...input, projectId: ProjectId.make("missing") }).pipe(Effect.result))
        ._tag,
    ).toBe("Failure");
    expect(yield* routines.list()).toEqual([]);
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer))),
);
