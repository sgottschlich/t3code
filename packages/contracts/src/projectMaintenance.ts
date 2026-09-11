import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export class ProjectMaintenanceError extends Schema.TaggedError<ProjectMaintenanceError>()(
  "ProjectMaintenanceError",
  { message: Schema.String },
) {}

export const ProjectRoutineInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(120))),
  prompt: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(32_000))),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  enabled: Schema.Boolean,
  firstRunAt: IsoDateTime,
  intervalMinutes: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 525600 })),
  ),
});
export type ProjectRoutineInput = typeof ProjectRoutineInput.Type;
export const ProjectRoutine = Schema.Struct({
  ...ProjectRoutineInput.fields,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastThreadId: Schema.NullOr(ThreadId),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  pendingRunAt: Schema.NullOr(IsoDateTime),
});
export type ProjectRoutine = typeof ProjectRoutine.Type;
export const WorktreeCleanupCandidate = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  modified: Schema.Boolean,
  locked: Schema.Boolean,
});
export const WorktreeCleanupScan = Schema.Struct({
  candidates: Schema.Array(WorktreeCleanupCandidate),
  missingThreads: Schema.Array(
    Schema.Struct({ threadId: ThreadId, title: Schema.String, path: Schema.String }),
  ),
});
export type WorktreeCleanupScan = typeof WorktreeCleanupScan.Type;
export const WorktreeCleanupRemoveInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
});
