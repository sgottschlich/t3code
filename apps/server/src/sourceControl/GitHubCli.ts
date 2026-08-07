import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
} from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const gitHubCliFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubCliUnavailableError extends Schema.TaggedErrorClass<GitHubCliUnavailableError>()(
  "GitHubCliUnavailableError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI (`gh`) is required but not available on PATH.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliAuthenticationError extends Schema.TaggedErrorClass<GitHubCliAuthenticationError>()(
  "GitHubCliAuthenticationError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubPullRequestNotFoundError extends Schema.TaggedErrorClass<GitHubPullRequestNotFoundError>()(
  "GitHubPullRequestNotFoundError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "Pull request not found. Check the PR number or URL and try again.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliCommandError extends Schema.TaggedErrorClass<GitHubCliCommandError>()(
  "GitHubCliCommandError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI command failed.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

const gitHubCliDecodeFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubPullRequestListDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestListDecodeError>()(
  "GitHubPullRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid PR list JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listOpenPullRequests: ${this.detail}`;
  }
}

export class GitHubChangeRequestListDecodeError extends Schema.TaggedErrorClass<GitHubChangeRequestListDecodeError>()(
  "GitHubChangeRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid change request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listChangeRequests: ${this.detail}`;
  }
}

export class GitHubPullRequestDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestDecodeError>()(
  "GitHubPullRequestDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid pull request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getPullRequest: ${this.detail}`;
  }
}

export class GitHubRepositoryDecodeError extends Schema.TaggedErrorClass<GitHubRepositoryDecodeError>()(
  "GitHubRepositoryDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid repository JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getRepositoryCloneUrls: ${this.detail}`;
  }
}

export class GitHubPipelineDecodeError extends Schema.TaggedErrorClass<GitHubPipelineDecodeError>()(
  "GitHubPipelineDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid check run JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getChangeRequestPipeline: ${this.detail}`;
  }
}

export class GitHubThreadDecodeError extends Schema.TaggedErrorClass<GitHubThreadDecodeError>()(
  "GitHubThreadDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid review thread JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listChangeRequestThreads: ${this.detail}`;
  }
}

export const GitHubCliError = Schema.Union([
  GitHubCliUnavailableError,
  GitHubCliAuthenticationError,
  GitHubPullRequestNotFoundError,
  GitHubCliCommandError,
  GitHubPullRequestListDecodeError,
  GitHubChangeRequestListDecodeError,
  GitHubPullRequestDecodeError,
  GitHubRepositoryDecodeError,
  GitHubPipelineDecodeError,
  GitHubThreadDecodeError,
]);
export type GitHubCliError = typeof GitHubCliError.Type;

export const isGitHubCliError = Schema.is(GitHubCliError);

export interface GitHubPipelineJob {
  readonly name: string;
  readonly stage?: string;
  readonly status: string;
  readonly url?: string;
}

export interface GitHubPipeline {
  readonly status: string;
  readonly jobs: ReadonlyArray<GitHubPipelineJob>;
}

export interface GitHubThread {
  readonly id: string;
  readonly author: string;
  readonly bodyExcerpt: string;
  readonly resolved: boolean;
  readonly url?: string;
  readonly filePath?: string | null;
  readonly line?: number | null;
}

export interface GitHubMergeResult {
  readonly state: "open" | "closed" | "merged";
  readonly sha?: string | null;
}

export function fromVcsError(
  context: {
    readonly command: "gh";
    readonly cwd: string;
  },
  error: VcsError,
): GitHubCliError {
  if (
    error._tag === "VcsProcessSpawnError" &&
    error.cause instanceof PlatformError.PlatformError &&
    error.cause.reason._tag === "NotFound" &&
    error.cause.reason.module === "ChildProcess" &&
    error.cause.reason.method === "spawn"
  ) {
    return new GitHubCliUnavailableError({ ...context, cause: error });
  }

  if (error._tag === "VcsProcessExitError") {
    if (error.failureKind === "authentication") {
      return new GitHubCliAuthenticationError({ ...context, cause: error });
    }
    if (error.failureKind === "not-found") {
      return new GitHubPullRequestNotFoundError({ ...context, cause: error });
    }
  }

  return new GitHubCliCommandError({ ...context, cause: error });
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
  readonly isDraft?: boolean;
  readonly mergeable?: "mergeable" | "conflicting" | "unknown";
  readonly mergeCommitSha?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
      readonly allowNonZeroExit?: boolean;
    }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

    readonly listOpenPullRequests: (input: {
      readonly cwd: string;
      readonly headSelector: string;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly repository: string;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly getDefaultBranch: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string | null, GitHubCliError>;

    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly getChangeRequestPipeline: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<GitHubPipeline, GitHubCliError>;

    readonly listChangeRequestThreads: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<ReadonlyArray<GitHubThread>, GitHubCliError>;

    readonly mergeChangeRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly squash?: boolean;
      readonly deleteSourceBranch?: boolean;
    }) => Effect.Effect<GitHubMergeResult, GitHubCliError>;
  }
>()("t3/sourceControl/GitHubCli") {}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
const decodeRawGitHubRepositoryCloneUrls = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubRepositoryCloneUrlsSchema),
);

const RawGitHubCheckRunSchema = Schema.Struct({
  name: TrimmedNonEmptyString,
  workflow: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  bucket: Schema.optional(Schema.NullOr(Schema.String)),
  link: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeGitHubCheckRunList = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(RawGitHubCheckRunSchema)),
);

const RawGitHubReviewThreadCommentSchema = Schema.Struct({
  author: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.optional(Schema.NullOr(Schema.String)) }))),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
});
const RawGitHubReviewThreadSchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  isResolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  comments: Schema.optional(
    Schema.NullOr(Schema.Struct({ nodes: Schema.optional(Schema.Array(RawGitHubReviewThreadCommentSchema)) })),
  ),
});
const RawGitHubReviewThreadsResponseSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              pullRequest: Schema.optional(
                Schema.NullOr(
                  Schema.Struct({
                    reviewThreads: Schema.optional(
                      Schema.NullOr(
                        Schema.Struct({ nodes: Schema.optional(Schema.Array(RawGitHubReviewThreadSchema)) }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});
const decodeGitHubReviewThreadsResponse = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubReviewThreadsResponseSchema),
);

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { author { login } body url path line }
          }
        }
      }
    }
  }
}`;

const MAX_THREAD_BODY_EXCERPT_LENGTH = 200;

function truncateBody(body: string | null | undefined): string {
  const trimmed = body?.trim() ?? "";
  return trimmed.length > MAX_THREAD_BODY_EXCERPT_LENGTH
    ? `${trimmed.slice(0, MAX_THREAD_BODY_EXCERPT_LENGTH)}…`
    : trimmed;
}

/**
 * GitHub check runs report both a coarse `bucket` (pass/fail/pending/
 * skipping/cancel) and a finer-grained raw `state`. The raw state is
 * preferred when present since it distinguishes queued from in-progress.
 */
function normalizeGitHubCheckStatus(
  state: string | null | undefined,
  bucket: string | null | undefined,
): string {
  switch (state?.trim().toUpperCase()) {
    case "IN_PROGRESS":
      return "running";
    case "QUEUED":
    case "PENDING":
    case "WAITING":
    case "REQUESTED":
      return "pending";
    case "SUCCESS":
    case "NEUTRAL":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failed";
    case "CANCELLED":
      return "canceled";
    case "SKIPPED":
    case "STALE":
      return "skipped";
  }

  switch (bucket?.trim().toLowerCase()) {
    case "pass":
      return "success";
    case "fail":
      return "failed";
    case "pending":
      return "running";
    case "skipping":
      return "skipped";
    case "cancel":
      return "canceled";
    default:
      return "pending";
  }
}

function aggregateGitHubPipelineStatus(jobStatuses: ReadonlyArray<string>): string {
  if (jobStatuses.length === 0) {
    return "none";
  }
  if (jobStatuses.includes("failed")) {
    return "failed";
  }
  if (jobStatuses.includes("running")) {
    return "running";
  }
  if (jobStatuses.includes("pending")) {
    return "pending";
  }
  if (jobStatuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  if (jobStatuses.every((status) => status === "canceled")) {
    return "canceled";
  }
  return "success";
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCli["Service"]["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(input.allowNonZeroExit !== undefined
          ? { allowNonZeroExit: input.allowNonZeroExit }
          : {}),
      })
      .pipe(Effect.mapError((error) => fromVcsError({ command: "gh", cwd: input.cwd }, error)));

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,isDraft,mergeable,mergeCommit",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubPullRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,isDraft,mergeable,mergeCommit",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubPullRequestDecodeError({
                    command: "gh",
                    cwd: input.cwd,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeRawGitHubRepositoryCloneUrls(raw).pipe(
            Effect.mapError(
              (cause) =>
                new GitHubRepositoryDecodeError({
                  command: "gh",
                  cwd: input.cwd,
                  cause,
                }),
            ),
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    getChangeRequestPipeline: (input) =>
      execute({
        cwd: input.cwd,
        allowNonZeroExit: true,
        args: ["pr", "checks", input.reference, "--json", "name,state,bucket,link,workflow"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed<GitHubPipeline>({ status: "none", jobs: [] })
            : decodeGitHubCheckRunList(raw).pipe(
                Effect.mapError(
                  (cause) => new GitHubPipelineDecodeError({ command: "gh", cwd: input.cwd, cause }),
                ),
                Effect.map((checks): GitHubPipeline => {
                  const jobs = checks.map((check) => ({
                    name: check.name,
                    status: normalizeGitHubCheckStatus(check.state, check.bucket),
                    ...(check.workflow ? { stage: check.workflow } : {}),
                    ...(check.link ? { url: check.link } : {}),
                  }));
                  return {
                    status: aggregateGitHubPipelineStatus(jobs.map((job) => job.status)),
                    jobs,
                  };
                }),
              ),
        ),
      ),
    listChangeRequestThreads: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.reference, "--json", "number"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed(decoded.success.number)
                : Effect.fail(
                    new GitHubPullRequestDecodeError({
                      command: "gh",
                      cwd: input.cwd,
                      cause: decoded.failure,
                    }),
                  ),
            ),
          ),
        ),
        Effect.flatMap((number) =>
          execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              `query=${REVIEW_THREADS_QUERY}`,
              "-F",
              "owner={owner}",
              "-F",
              "repo={repo}",
              "-F",
              `number=${number}`,
            ],
          }),
        ),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubReviewThreadsResponse(raw).pipe(
            Effect.mapError(
              (cause) => new GitHubThreadDecodeError({ command: "gh", cwd: input.cwd, cause }),
            ),
          ),
        ),
        Effect.map((response) => {
          const nodes = response.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
          const threads: GitHubThread[] = [];
          for (const node of nodes) {
            const comment = node.comments?.nodes?.[0];
            if (!comment) {
              continue;
            }
            threads.push({
              id: node.id,
              author: comment.author?.login?.trim() || "unknown",
              bodyExcerpt: truncateBody(comment.body),
              resolved: node.isResolved === true,
              ...(comment.url ? { url: comment.url } : {}),
              ...(comment.path ? { filePath: comment.path } : {}),
              ...(typeof comment.line === "number" ? { line: comment.line } : {}),
            });
          }
          return threads;
        }),
      ),
    mergeChangeRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "merge",
          input.reference,
          input.squash ? "--squash" : "--merge",
          ...(input.deleteSourceBranch ? ["--delete-branch"] : []),
        ],
      }).pipe(
        Effect.flatMap(() =>
          execute({
            cwd: input.cwd,
            args: [
              "pr",
              "view",
              input.reference,
              "--json",
              "number,title,url,baseRefName,headRefName,state,mergedAt,mergeCommit",
            ],
          }),
        ),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed<GitHubMergeResult>({
                    state: decoded.success.state,
                    sha: decoded.success.mergeCommitSha ?? null,
                  })
                : Effect.fail(
                    new GitHubPullRequestDecodeError({
                      command: "gh",
                      cwd: input.cwd,
                      cause: decoded.failure,
                    }),
                  ),
            ),
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(GitHubCli, make);
