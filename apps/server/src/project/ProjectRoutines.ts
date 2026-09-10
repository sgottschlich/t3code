import {
  CommandId,
  MessageId,
  ThreadId,
  ProjectMaintenanceError,
  ProjectRoutine,
  type ProjectRoutineInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";

const isMaintenanceError = Schema.is(ProjectMaintenanceError);
const routineFileCodec = Schema.fromJsonString(Schema.Array(ProjectRoutine));
const decodeRoutines = Schema.decodeUnknownEffect(routineFileCodec);
const encodeRoutines = Schema.encodeEffect(routineFileCodec);

export function nextRoutineRun(now: number, intervalMinutes: number | null): string | null {
  return intervalMinutes === null
    ? null
    : DateTime.formatIso(DateTime.makeUnsafe(now + intervalMinutes * 60_000));
}

/** Routine configuration is independent of event projections; runs use ordinary durable commands. */
export const makeProjectRoutines = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* OrchestrationEngineService;
  const startup = yield* ServerRuntimeStartup;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  const filePath = path.join(config.stateDir, "project-routines.json");
  let routines: ReadonlyArray<ProjectRoutine> = (yield* fs.exists(filePath))
    ? yield* fs.readFileString(filePath).pipe(Effect.flatMap(decodeRoutines))
    : [];
  const persist = Effect.fn("ProjectRoutines.persist")(function* (
    next: ReadonlyArray<ProjectRoutine>,
  ) {
    const contents = yield* encodeRoutines(next);
    yield* writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
    routines = next;
  });
  const replace = (routine: ProjectRoutine) =>
    persist([...routines.filter((entry) => entry.id !== routine.id), routine]);
  const requireRoutine = (id: string) => {
    const found = routines.find((entry) => entry.id === id);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new ProjectMaintenanceError({ message: "Routine no longer exists." }));
  };
  const validateProject = Effect.fn("ProjectRoutines.validateProject")(function* (
    projectId: string,
  ) {
    const rows =
      yield* sql`SELECT project_id FROM projection_projects WHERE project_id = ${projectId} AND deleted_at IS NULL`;
    if (rows.length === 0)
      return yield* new ProjectMaintenanceError({ message: "Project no longer exists." });
  });
  const isRunning = Effect.fn("ProjectRoutines.isRunning")(function* (routine: ProjectRoutine) {
    if (!routine.lastThreadId) return false;
    const rows =
      yield* sql`SELECT row_id FROM projection_turns WHERE thread_id = ${routine.lastThreadId} AND state IN ('pending', 'requested', 'running') LIMIT 1`;
    return rows.length > 0;
  });
  const execute = Effect.fn("ProjectRoutines.execute")(function* (id: string) {
    let routine = yield* requireRoutine(id);
    if (!routine.pendingRunAt && (yield* isRunning(routine))) {
      return yield* new ProjectMaintenanceError({
        message: "The previous run is still active. Open its thread to continue or stop it.",
      });
    }
    yield* validateProject(routine.projectId);
    if (!routine.pendingRunAt) {
      const now = yield* Clock.currentTimeMillis;
      routine = {
        ...routine,
        pendingRunAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
        lastThreadId: ThreadId.make(`routine-${yield* crypto.randomUUIDv4}`),
        lastRunAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
        nextRunAt: nextRoutineRun(now, routine.intervalMinutes),
        enabled: routine.intervalMinutes === null ? false : routine.enabled,
        lastError: null,
      };
      // Commit the run identity before dispatch, so restart retries use the same receipts.
      yield* replace(routine);
    }
    const threadId = routine.lastThreadId!;
    const createdAt = routine.pendingRunAt!;
    const result = yield* Effect.gen(function* () {
      yield* startup.enqueueCommand(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`${threadId}:create`),
          threadId,
          projectId: routine.projectId,
          title: routine.name,
          modelSelection: routine.modelSelection,
          runtimeMode: routine.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );
      yield* startup.enqueueCommand(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`${threadId}:start`),
          threadId,
          message: {
            messageId: MessageId.make(`${threadId}:message`),
            role: "user",
            text: routine.prompt,
            attachments: [],
          },
          modelSelection: routine.modelSelection,
          runtimeMode: routine.runtimeMode,
          interactionMode: "default",
          createdAt,
        }),
      );
    }).pipe(Effect.result);
    const completed = {
      ...routine,
      pendingRunAt: null,
      lastError:
        result._tag === "Failure"
          ? "Could not start the run. Check the project, provider and last run thread."
          : null,
    };
    yield* replace(completed);
    return completed;
  });
  const failure = (cause: unknown) =>
    isMaintenanceError(cause)
      ? cause
      : new ProjectMaintenanceError({ message: "Could not read or save project routines." });
  const locked = <A, E>(effect: Effect.Effect<A, E>) =>
    mutex.withPermit(effect).pipe(Effect.mapError(failure));
  const tick = locked(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const routine of routines) {
        if (
          routine.pendingRunAt ||
          (routine.enabled && routine.nextRunAt !== null && Date.parse(routine.nextRunAt) <= now)
        ) {
          if (!routine.pendingRunAt && (yield* isRunning(routine))) continue;
          yield* execute(routine.id).pipe(
            Effect.catch(() =>
              Effect.gen(function* () {
                const current = yield* requireRoutine(routine.id);
                yield* replace({
                  ...current,
                  enabled: false,
                  pendingRunAt: null,
                  lastError: "Routine paused because its project or run could not be started.",
                });
              }),
            ),
          );
        }
      }
    }),
  );
  return {
    list: () => locked(Effect.sync(() => routines)),
    save: (input: ProjectRoutineInput) =>
      locked(
        Effect.gen(function* () {
          yield* validateProject(input.projectId);
          if (!Number.isFinite(Date.parse(input.firstRunAt)))
            return yield* new ProjectMaintenanceError({
              message: "Choose a valid first run date and time.",
            });
          const previous = routines.find((entry) => entry.id === input.id);
          if (!previous && routines.length >= 200)
            return yield* new ProjectMaintenanceError({
              message: "At most 200 routines can be stored.",
            });
          const scheduleChanged =
            !previous ||
            input.firstRunAt !== previous.firstRunAt ||
            input.intervalMinutes !== previous.intervalMinutes;
          const routine: ProjectRoutine = {
            ...input,
            nextRunAt: scheduleChanged
              ? input.firstRunAt
              : (previous.nextRunAt ?? (input.enabled ? input.firstRunAt : null)),
            lastThreadId: previous?.lastThreadId ?? null,
            lastRunAt: previous?.lastRunAt ?? null,
            lastError: previous?.lastError ?? null,
            pendingRunAt: previous?.pendingRunAt ?? null,
          };
          yield* replace(routine);
          return routine;
        }),
      ),
    remove: (id: string) =>
      locked(Effect.suspend(() => persist(routines.filter((entry) => entry.id !== id)))),
    run: (id: string) => locked(execute(id)),
    tick,
    start: startup.awaitCommandReady.pipe(
      Effect.andThen(
        tick.pipe(Effect.ignoreCause({ log: true }), Effect.repeat(Schedule.spaced("30 seconds"))),
      ),
      Effect.forkScoped,
    ),
  };
});
export type ProjectRoutines = Effect.Success<typeof makeProjectRoutines>;
