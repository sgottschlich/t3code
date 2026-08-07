import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ChangeRequest,
  ChangeRequestMergeResult,
  ChangeRequestPipeline,
  ChangeRequestThread,
} from "./sourceControl.ts";

const decodeChangeRequest = Schema.decodeUnknownSync(ChangeRequest);
const decodeChangeRequestPipeline = Schema.decodeUnknownSync(ChangeRequestPipeline);
const decodeChangeRequestThread = Schema.decodeUnknownSync(ChangeRequestThread);
const decodeChangeRequestMergeResult = Schema.decodeUnknownSync(ChangeRequestMergeResult);

describe("ChangeRequest", () => {
  it("decodes without the new optional fields", () => {
    const parsed = decodeChangeRequest({
      provider: "gitlab",
      number: 42,
      title: "Add sidebar card",
      url: "https://git.rooom.com/group/project/-/merge_requests/42",
      baseRefName: "main",
      headRefName: "feature/sidebar",
      state: "open",
      updatedAt: null,
    });

    expect(parsed.isDraft).toBeUndefined();
    expect(parsed.mergeable).toBeUndefined();
  });

  it("decodes isDraft and mergeable when present", () => {
    const parsed = decodeChangeRequest({
      provider: "github",
      number: 7,
      title: "WIP: sidebar card",
      url: "https://github.com/owner/repo/pull/7",
      baseRefName: "main",
      headRefName: "feature/sidebar",
      state: "open",
      updatedAt: null,
      isDraft: true,
      mergeable: "conflicting",
    });

    expect(parsed.isDraft).toBe(true);
    expect(parsed.mergeable).toBe("conflicting");
  });
});

describe("ChangeRequestPipeline", () => {
  it("decodes a pipeline with a full job list", () => {
    const parsed = decodeChangeRequestPipeline({
      status: "running",
      url: "https://git.rooom.com/group/project/-/pipelines/1",
      jobs: [
        { name: "build", stage: "build", status: "success" },
        { name: "test", stage: "test", status: "running", url: "https://example.test/jobs/2" },
      ],
    });

    expect(parsed.jobs).toHaveLength(2);
    expect(parsed.jobs[1]?.status).toBe("running");
  });

  it("decodes an empty job list", () => {
    const parsed = decodeChangeRequestPipeline({ status: "pending", jobs: [] });
    expect(parsed.jobs).toEqual([]);
  });
});

describe("ChangeRequestThread", () => {
  it("decodes a resolved thread without file position", () => {
    const parsed = decodeChangeRequestThread({
      id: "discussion-1",
      author: "reviewer",
      bodyExcerpt: "Looks good.",
      resolved: true,
    });

    expect(parsed.filePath).toBeUndefined();
    expect(parsed.line).toBeUndefined();
  });

  it("decodes an unresolved thread anchored to a diff position", () => {
    const parsed = decodeChangeRequestThread({
      id: "discussion-2",
      author: "reviewer",
      bodyExcerpt: "Please handle the null case here.",
      resolved: false,
      url: "https://git.rooom.com/group/project/-/merge_requests/42#note_1",
      filePath: "apps/server/src/foo.ts",
      line: 12,
    });

    expect(parsed.resolved).toBe(false);
    expect(parsed.filePath).toBe("apps/server/src/foo.ts");
    expect(parsed.line).toBe(12);
  });
});

describe("ChangeRequestMergeResult", () => {
  it("decodes a merged result with a sha", () => {
    const parsed = decodeChangeRequestMergeResult({
      state: "merged",
      sha: "abc123",
    });

    expect(parsed.state).toBe("merged");
    expect(parsed.sha).toBe("abc123");
  });
});
