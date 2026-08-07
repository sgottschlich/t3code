import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    changeRequestPipeline: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:git:change-request-pipeline",
      tag: WS_METHODS.subscribeChangeRequestStatus,
    }),
    changeRequestThreads: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:change-request-threads",
      tag: WS_METHODS.gitListChangeRequestThreads,
    }),
    mergeChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:merge-change-request",
      tag: WS_METHODS.gitMergeChangeRequest,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
