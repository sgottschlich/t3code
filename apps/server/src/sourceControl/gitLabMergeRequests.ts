import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

export interface NormalizedGitLabMergeRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
  readonly isDraft?: boolean;
  readonly mergeable?: "mergeable" | "conflicting" | "unknown";
  readonly mergeCommitSha?: string | null;
}

const GitLabProjectReferenceSchema = Schema.Struct({
  path_with_namespace: Schema.optional(Schema.String),
  pathWithNamespace: Schema.optional(Schema.String),
  namespace: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        path: Schema.optional(Schema.String),
        full_path: Schema.optional(Schema.String),
        fullPath: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const GitLabMergeRequestSchema = Schema.Struct({
  iid: PositiveInt,
  title: TrimmedNonEmptyString,
  web_url: TrimmedNonEmptyString,
  source_branch: TrimmedNonEmptyString,
  target_branch: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  source_project_id: Schema.optional(Schema.NullOr(Schema.Number)),
  target_project_id: Schema.optional(Schema.NullOr(Schema.Number)),
  source_project: Schema.optional(Schema.NullOr(GitLabProjectReferenceSchema)),
  target_project: Schema.optional(Schema.NullOr(GitLabProjectReferenceSchema)),
  draft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  work_in_progress: Schema.optional(Schema.NullOr(Schema.Boolean)),
  has_conflicts: Schema.optional(Schema.NullOr(Schema.Boolean)),
  merge_status: Schema.optional(Schema.NullOr(Schema.String)),
  detailed_merge_status: Schema.optional(Schema.NullOr(Schema.String)),
  merge_commit_sha: Schema.optional(Schema.NullOr(Schema.String)),
  sha: Schema.optional(Schema.NullOr(Schema.String)),
});

export function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitLabMergeRequestState(
  state: string | null | undefined,
): "open" | "closed" | "merged" {
  const normalized = state?.trim().toLowerCase();
  if (normalized === "merged") {
    return "merged";
  }
  if (normalized === "closed") {
    return "closed";
  }
  return "open";
}

function projectPathWithNamespace(
  project: Schema.Schema.Type<typeof GitLabProjectReferenceSchema> | null | undefined,
): string | null {
  const explicit =
    trimOptionalString(project?.path_with_namespace) ??
    trimOptionalString(project?.pathWithNamespace);
  if (explicit) {
    return explicit;
  }

  const namespacePath =
    trimOptionalString(project?.namespace?.full_path) ??
    trimOptionalString(project?.namespace?.fullPath) ??
    trimOptionalString(project?.namespace?.path);
  return namespacePath;
}

function ownerLoginFromPathWithNamespace(pathWithNamespace: string | null): string | null {
  const [owner] = pathWithNamespace?.split("/") ?? [];
  return trimOptionalString(owner);
}

function normalizeGitLabMergeable(
  raw: Schema.Schema.Type<typeof GitLabMergeRequestSchema>,
): "mergeable" | "conflicting" | "unknown" {
  if (raw.has_conflicts === true) {
    return "conflicting";
  }
  const detailed = raw.detailed_merge_status?.trim().toLowerCase();
  if (detailed === "mergeable") {
    return "mergeable";
  }
  if (detailed === "conflict") {
    return "conflicting";
  }
  const legacy = raw.merge_status?.trim().toLowerCase();
  if (legacy === "can_be_merged") {
    return "mergeable";
  }
  if (legacy === "cannot_be_merged" || legacy === "cannot_be_merged_recheck") {
    return "conflicting";
  }
  return "unknown";
}

function normalizeGitLabMergeRequestRecord(
  raw: Schema.Schema.Type<typeof GitLabMergeRequestSchema>,
): NormalizedGitLabMergeRequestRecord {
  const sourceProjectPath = projectPathWithNamespace(raw.source_project);
  const targetProjectPath = projectPathWithNamespace(raw.target_project);
  const isCrossRepository =
    typeof raw.source_project_id === "number" && typeof raw.target_project_id === "number"
      ? raw.source_project_id !== raw.target_project_id
      : sourceProjectPath !== null && targetProjectPath !== null
        ? sourceProjectPath.toLowerCase() !== targetProjectPath.toLowerCase()
        : undefined;
  const headRepositoryOwnerLogin = ownerLoginFromPathWithNamespace(sourceProjectPath);
  const isDraft = raw.draft === true || raw.work_in_progress === true;

  return {
    number: raw.iid,
    title: raw.title,
    url: raw.web_url,
    baseRefName: raw.target_branch,
    headRefName: raw.source_branch,
    state: normalizeGitLabMergeRequestState(raw.state),
    updatedAt: raw.updated_at ?? Option.none(),
    ...(typeof isCrossRepository === "boolean" ? { isCrossRepository } : {}),
    ...(sourceProjectPath ? { headRepositoryNameWithOwner: sourceProjectPath } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
    isDraft,
    mergeable: normalizeGitLabMergeable(raw),
    mergeCommitSha: trimOptionalString(raw.merge_commit_sha),
  };
}

const decodeGitLabMergeRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeGitLabMergeRequest = decodeJsonResult(GitLabMergeRequestSchema);
const decodeGitLabMergeRequestEntry = Schema.decodeUnknownExit(GitLabMergeRequestSchema);

export const formatGitLabJsonDecodeError = formatSchemaError;

export function decodeGitLabMergeRequestListJson(
  raw: string,
): Result.Result<
  ReadonlyArray<NormalizedGitLabMergeRequestRecord>,
  Cause.Cause<Schema.SchemaError>
> {
  const result = decodeGitLabMergeRequestList(raw);
  if (Result.isSuccess(result)) {
    const mergeRequests: NormalizedGitLabMergeRequestRecord[] = [];
    for (const entry of result.success) {
      const decodedEntry = decodeGitLabMergeRequestEntry(entry);
      if (Exit.isFailure(decodedEntry)) {
        continue;
      }
      mergeRequests.push(normalizeGitLabMergeRequestRecord(decodedEntry.value));
    }
    return Result.succeed(mergeRequests);
  }
  return Result.fail(result.failure);
}

export function decodeGitLabMergeRequestJson(
  raw: string,
): Result.Result<NormalizedGitLabMergeRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitLabMergeRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeGitLabMergeRequestRecord(result.success));
  }
  return Result.fail(result.failure);
}
