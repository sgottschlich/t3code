# Design: IDEA-mr-sidebar-card — Change Request card in the right sidebar

## Problem Statement
Users working in a t3code thread whose environment is checked out on a branch with an open merge/pull
request currently have no way to see that MR/PR's status, CI pipeline, or open review threads without
leaving the app — and no way to merge it from t3code at all. This forces a context switch to
GitLab/GitHub for the most common "is my change ready to merge" loop. A new right-panel card should
surface this information and let the user merge directly from the app.

## Goals & Non-Goals

**Goals:**
- New right-panel surface kind `"changeRequest"` showing MR/PR title, number, state, base→head branch,
  and a link to the provider.
- Full pipeline/CI status: all stages/jobs with individual status, always visible, updating live while
  the tab is open (no manual refresh needed).
- Open (unresolved) review threads shown as a readable list (author, snippet, link to the provider
  discussion); resolved threads collapsed/hidden by default.
- "Merge" button: confirmation dialog with squash-commits and delete-source-branch toggles, executes the
  merge via the provider CLI.
- GitLab and GitHub support in v1 (both already have CLI-wrapper infrastructure: `glab`, `gh`).
- Live updates via a server-side streaming RPC + poller (not client-side polling per tab).

**Non-Goals:**
- Azure DevOps / Bitbucket pipeline/thread/merge support (same interface, stubbed as "not supported" for
  now — later extension).
- Creating or replying to review threads from this card (read-only display; the existing
  `PullRequestThreadDialog` / `sourceControlActions.ts` machinery already covers thread creation from a
  code selection — different feature, different data path).
- Merge trains / merge queues.
- Mobile app parity — `apps/mobile` has no right-panel/surface concept; a mobile version needs its own
  design later.
- Hard-blocking the merge button on a red/running pipeline (see Open Questions — this was not the option
  picked at the design gate; current assumption is warn-only).

## Acceptance Criteria
- [ ] Given a thread whose environment is a git repo with an open GitLab or GitHub MR/PR for the current
      branch, when the user opens "Change Request" from the right-panel add-menu, then a new
      `changeRequest` surface tab opens showing title, number, state, base→head branch, and a link to the
      provider.
- [ ] Given the change request has an associated pipeline/CI run, when the card is open, then the full
      list of stages/jobs with individual statuses is shown and updates live without manual refresh while
      the tab stays open.
- [ ] Given the change request has unresolved review threads, when the card is open, then each unresolved
      thread is listed with author, snippet, and a link to jump to the provider's discussion; resolved
      threads are collapsed/hidden by default but can be revealed.
- [ ] Given the user clicks "Merge", when they confirm in the dialog (with optional squash /
      delete-source-branch toggles), then the merge is executed via the provider CLI and the card reflects
      the new "merged" state.
- [ ] Given the change request cannot be merged (already merged/closed, or the provider reports
      conflicts), when the user views the card, then the Merge button is disabled with an explanatory
      tooltip instead of failing silently on click.
- [ ] Given no change request exists for the current branch, when the user tries to add the "Change
      Request" surface, then the add-menu entry is disabled with a reason tooltip (mirrors the existing
      `diff`/`browser` disabled-reason pattern in `RightPanelTabs`).
- [ ] Given the provider CLI call for merge fails (auth, network, provider-side rejection), when this
      happens, then the error is surfaced in the dialog with the raw provider error message, and the merge
      is NOT silently retried.
- [ ] ⚠️ CORRECTED (self-check) — Given the streaming pipeline/status subscription errors or disconnects,
      when this happens, then the panel shows a "stale data" indicator instead of silently freezing on the
      last-known state.

## Solution Overview
Follow the repo's existing provider-agnostic architecture instead of a GitLab-specific one-off:

1. **Contracts** (`packages/contracts/src/sourceControl.ts`): extend `ChangeRequest` with optional
   `isDraft`, `mergeable` (`"mergeable" | "conflicting" | "unknown"`), and add new schemas
   `ChangeRequestPipelineJob`, `ChangeRequestPipeline`, `ChangeRequestThread`, plus merge
   input/result schemas.
2. **Server `SourceControlProvider` interface**: add `getChangeRequestPipeline`,
   `listChangeRequestThreads`, `mergeChangeRequest` — same `cwd`/`context`/`reference` shape as the
   existing `getChangeRequest`/`checkoutChangeRequest`.
3. **Provider implementations**: `GitLabSourceControlProvider` (via `glab` CLI — pipeline/jobs,
   discussions, `glab mr merge`) and `GitHubSourceControlProvider` (via `gh` CLI — `gh pr checks`,
   reviews/comments, `gh pr merge`). Azure DevOps / Bitbucket providers return a
   `SourceControlProviderError` "not supported" for the 3 new methods so the UI can disable the surface
   for those providers without changing the shared interface.
4. **Live updates**: new streaming RPC `sourceControl.subscribeChangeRequestStatus`
   (`stream: true`), server-side `ChangeRequestStatusBroadcaster` modeled on
   `apps/server/src/vcs/VcsStatusBroadcaster.ts` — ref-counted interval poller + `PubSub` per
   `(cwd, reference)`, active only while ≥1 client has the card open.
5. **Merge RPC**: `sourceControl.mergeChangeRequest` (non-streaming), payload includes
   `squash`/`deleteSourceBranch` booleans, gated by a new domain-specific `AuthSourceControlWriteScope`
   (precedent: `AuthReviewWriteScope` for diff-review actions) rather than the broad
   `AuthOrchestrationOperateScope` — merging is a higher-blast-radius action and should be independently
   revocable.
6. **Web — right panel**: add `"changeRequest"` to `RIGHT_PANEL_KINDS` / `RightPanelSurface` union in
   `rightPanelStore.ts` (singleton surface, same pattern as `"agents"`/`"plan"`); add an
   `onAddChangeRequest` opener in `ChatView.tsx` guarded on `isServerThread && isGitRepo &&
   hasChangeRequestForBranch`; add the menu entry + disabled-reason tooltip + tab icon in
   `RightPanelTabs.tsx`.
7. **Web — new panel** `ChangeRequestPanel.tsx`: subscribes to the streaming RPC for pipeline+state,
   calls `listChangeRequestThreads` once plus a light periodic poll (threads change less often than
   pipeline jobs — no need to stream them), reuses `sourceControlPresentation.ts` for provider
   icon/labels and borrows `LocalCommentAnnotation`'s visual style for the thread list. The Merge button
   opens `MergeChangeRequestDialog.tsx` (squash/delete-branch checkboxes, in-flight lock, inline provider
   error on failure).

**Alternatives considered:**
- *Client-side polling per open tab* — rejected: would spawn N `glab`/`gh` CLI processes per open tab per
  client. `VcsStatusBroadcaster` already solves exactly this problem for VCS status; extend the same
  pattern instead.
- *GitLab-only first, generalize later* — rejected per the design-gate answer (GitLab + GitHub v1): the
  `SourceControlProvider` interface is already provider-agnostic, so adding both now costs little extra
  versus retrofitting the abstraction later.
- *Reuse `PullRequestThreadDialog` / `sourceControlActions.ts` for the open-threads list* — rejected:
  that machinery creates/prepares a new thread from a code selection (write path); this card only needs a
  read-only `listChangeRequestThreads` call. Different data shape and lifecycle.

## Affected Components
| Component | Change Type | File(s) |
|---|---|---|
| ChangeRequest contract | modify | `packages/contracts/src/sourceControl.ts` |
| RPC method definitions | modify | `packages/contracts/src/rpc.ts` |
| Auth scopes | modify | `packages/contracts/src/auth.ts` |
| RPC scope mapping | modify | `apps/server/src/auth/RpcAuthorization.ts` |
| SourceControlProvider interface | modify | `apps/server/src/sourceControl/SourceControlProvider.ts` |
| GitLab provider impl | modify | `apps/server/src/sourceControl/GitLabSourceControlProvider.ts`, `GitLabCli.ts` |
| GitHub provider impl | modify | `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`, `GitHubCli.ts` |
| Azure/Bitbucket providers | modify | `apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts`, `BitbucketSourceControlProvider.ts` |
| Change-request status broadcaster | add | `apps/server/src/sourceControl/ChangeRequestStatusBroadcaster.ts` |
| WS handler wiring | modify | `apps/server/src/ws.ts` |
| Right panel store | modify | `apps/web/src/rightPanelStore.ts` |
| Right panel tabs UI | modify | `apps/web/src/components/RightPanelTabs.tsx` |
| ChatView wiring | modify | `apps/web/src/components/ChatView.tsx` |
| New panel component | add | `apps/web/src/components/changeRequest/ChangeRequestPanel.tsx` |
| New merge dialog | add | `apps/web/src/components/changeRequest/MergeChangeRequestDialog.tsx` |
| Provider presentation reuse | modify | `apps/web/src/sourceControlPresentation.ts` |

## Data Model Changes
No database/persistence schema changes — t3code does not persist MR/PR data server-side beyond in-memory
poller state. Contract-level additions only:
- `ChangeRequest`: + `isDraft?`, `mergeable?`
- new `ChangeRequestPipelineJob` `{ name, stage, status, url }`
- new `ChangeRequestPipeline` `{ status, url, jobs: ChangeRequestPipelineJob[] }`
- new `ChangeRequestThread` `{ id, author, bodyExcerpt, resolved, url, filePath?, line? }`
- new RPC payload/result schemas for `mergeChangeRequest` and `subscribeChangeRequestStatus`

## External Dependencies & Risks
- GitLab pipeline/thread JSON shape from `glab api` / `glab mr view --output json` is not yet verified —
  needs a spike at the start of the GitLab implementation task.
- GitHub equivalent via `gh pr checks --json` / `gh api repos/{owner}/{repo}/pulls/{number}/reviews` has
  the same verification need.
- The new write scope must be added to whatever default scope-bundle the desktop/web client requests at
  auth time, or the merge button 403s for already-authenticated sessions until they re-auth.
- A second long-lived per-CR poller process tree (in addition to `VcsStatusBroadcaster`) must stay within
  GitLab/GitHub CLI rate limits — use a conservative interval (proposed 15–30s), not sub-5s.
- Merge is effectively irreversible — the dialog must disable its own submit while in flight to prevent a
  double-merge / error storm from a double click.

## Open Questions
- Exact poll interval for pipeline/job status — proposed 15s default; confirm against GitLab/GitHub CLI
  rate limits during implementation (T4/T5).
- Whether the "Change Request" surface should auto-open when a thread's branch has an associated open
  MR/PR, or stay purely manual — current assumption: manual via the add-menu, consistent with all other
  optional surfaces (Browser/Terminal/Files).
- Whether the merge button should warn only (current assumption, per the picked design-gate option) or
  hard-block on a red/running pipeline — this is a safety-relevant UX decision that was not explicitly
  chosen among the offered options; confirm before implementing T12.

## Implementation Plan

### Prerequisites
- None — builds entirely on the existing `SourceControlProvider` / `RightPanelSurface` / RPC
  infrastructure already present in the repo.

- T1: Extend `ChangeRequest` contract with pipeline/thread/mergeable/draft fields + new schemas (`ChangeRequestPipeline`, `ChangeRequestPipelineJob`, `ChangeRequestThread`) [no deps] | Files: `packages/contracts/src/sourceControl.ts` | Evidence: `packages/contracts/src/sourceControl.ts:24` (`ChangeRequest` struct) | Tests: `packages/contracts/src/sourceControl.test.ts` (new — schema roundtrip) | Not included: RPC wiring, provider implementations | Rollback: revert the schema additions — no consumers exist yet, so this is a clean removal | Est: 30 min
- T2: Add `AuthSourceControlWriteScope` and wire it into the `RpcAuthorization` scope map [no deps] | Files: `packages/contracts/src/auth.ts`, `apps/server/src/auth/RpcAuthorization.ts` | Evidence: `packages/contracts/src/auth.ts:76-79` (`AuthReviewWriteScope` precedent), `apps/server/src/auth/RpcAuthorization.ts:24-79` (`RPC_REQUIRED_SCOPES`) | Tests: `apps/server/src/auth/RpcAuthorization.test.ts` (add case) | Not included: granting the new scope in the client's default scope-bundle (tracked as a risk, follow-up) | Rollback: remove the scope constant and its mapping entry | Est: 15 min
- T3: Add `getChangeRequestPipeline` / `listChangeRequestThreads` / `mergeChangeRequest` to the `SourceControlProvider` interface [deps: T1] | Files: `apps/server/src/sourceControl/SourceControlProvider.ts` | Evidence: `apps/server/src/sourceControl/SourceControlProvider.ts:82-130` (existing `Context.Service` shape) | Tests: `apps/server/src/sourceControl/SourceControlProvider.test.ts` | Not included: concrete provider implementations | Rollback: revert the interface additions | Est: 30 min
- T4: Implement GitLab pipeline/threads/merge via `glab` CLI wrapper + JSON decoding [deps: T3] | Files: `apps/server/src/sourceControl/GitLabSourceControlProvider.ts`, `GitLabCli.ts`, `gitLabMergeRequests.ts` | Evidence: `apps/server/src/sourceControl/GitLabCli.ts:254-340` (`listMergeRequests`/`getMergeRequest` pattern to extend) | Tests: `GitLabSourceControlProvider.test.ts`, `GitLabCli.test.ts` | Not included: GitHub implementation | Rollback: revert the new methods; existing `listChangeRequests`/`getChangeRequest` unaffected | Est: 90 min
- T5: Implement GitHub pipeline/threads/merge via `gh` CLI wrapper [deps: T3] | Files: `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`, `GitHubCli.ts` | Evidence: `apps/server/src/sourceControl/GitHubCli.ts` (existing `listPullRequests`/`getPullRequest` pattern) | Tests: `GitHubSourceControlProvider.test.ts`, `GitHubCli.test.ts` | Not included: GitLab implementation | Rollback: revert the new methods | Est: 90 min
- T6: Add "not supported" stub errors for the 3 new methods on Azure DevOps + Bitbucket providers [deps: T3] | Files: `apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts`, `BitbucketSourceControlProvider.ts` | Evidence: `apps/server/src/sourceControl/SourceControlProvider.ts` (`SourceControlProviderError` shape) | Tests: `AzureDevOpsSourceControlProvider.test.ts`, `BitbucketSourceControlProvider.test.ts` (assert not-supported error) | Not included: real Azure/Bitbucket pipeline/thread support | Rollback: remove the stub methods (must ship together with T3, or the interface is unimplemented) | Est: 15 min
- T7: Add `ChangeRequestStatusBroadcaster` (server-side ref-counted poller + PubSub) [deps: T4, T5] | Files: `apps/server/src/sourceControl/ChangeRequestStatusBroadcaster.ts` (new) | Evidence: `apps/server/src/vcs/VcsStatusBroadcaster.ts:195,471-551,560` (pattern to model) | Tests: `ChangeRequestStatusBroadcaster.test.ts` (new, modeled on `VcsStatusBroadcaster.test.ts`) | Not included: client-side subscription logic | Rollback: delete the new file — nothing references it yet at this point | Est: 60 min
- T8: Add RPC methods (`subscribeChangeRequestStatus` stream, `mergeChangeRequest`, `listChangeRequestThreads`) + `ws.ts` handlers [deps: T7] | Files: `packages/contracts/src/rpc.ts`, `apps/server/src/ws.ts` | Evidence: `packages/contracts/src/rpc.ts:419-441` (`Rpc.make` pattern), existing `subscribeVcsStatus` handler wiring for the streaming pattern | Tests: server WS handler test cases | Not included: web client usage | Rollback: revert the RPC + handler additions | Est: 45 min
- T9: Add `"changeRequest"` surface kind to `rightPanelStore` [deps: T1] | Files: `apps/web/src/rightPanelStore.ts` | Evidence: `apps/web/src/rightPanelStore.ts:17-25` (`RIGHT_PANEL_KINDS`), `:39-49` (union members), `:94-107` (`singletonSurface`) | Tests: `apps/web/src/rightPanelStore.test.ts` | Not included: UI rendering | Rollback: revert the 3 edits described in Evidence | Est: 20 min
- T10: Wire add-menu entry + tab icon/title + disabled-reason tooltip in `RightPanelTabs`, opener in `ChatView` [deps: T9] | Files: `apps/web/src/components/RightPanelTabs.tsx`, `apps/web/src/components/ChatView.tsx` | Evidence: `RightPanelTabs.tsx:54-58` (`SURFACE_DISABLED_REASONS`), `:199-231` (`surfaceTitle`), `:249-284` (`SurfaceIcon`); `ChatView.tsx:3132-3154` (`addDiffSurface`/`addAgentsSurface` pattern) | Tests: manual browser QA (component test if one exists for `RightPanelTabs`) | Not included: panel body content (T11) | Rollback: revert the added menu entry/icon/opener wiring | Est: 30 min
- T11: Build `ChangeRequestPanel.tsx` (subscribes to streaming pipeline status, fetches threads, renders MR header/pipeline/thread list) [deps: T8, T10] | Files: `apps/web/src/components/changeRequest/ChangeRequestPanel.tsx` (new) | Evidence: `apps/web/src/sourceControlPresentation.ts` (provider icon/label reuse), `apps/web/src/components/files/LocalCommentAnnotation.tsx` (visual style reference) | Tests: `ChangeRequestPanel.test.tsx` (new) | Not included: merge dialog (T12) | Rollback: delete the new component; remove the render wiring added in this task | Est: 90 min
- T12: Build `MergeChangeRequestDialog.tsx` (squash/delete-branch toggles, disabled state, error display, in-flight lock) [deps: T8, T11] | Files: `apps/web/src/components/changeRequest/MergeChangeRequestDialog.tsx` (new) | Evidence: existing dialog primitives under `apps/web/src/components/ui` | Tests: `MergeChangeRequestDialog.test.tsx` (new) | Not included: server-side merge RPC (covered by T8) | Rollback: delete the new component | Est: 60 min
- T13: Add a branch→ChangeRequest existence check for the add-menu "available" guard [deps: T10] | Files: `apps/web/src/components/ChatView.tsx` or a new `apps/web/src/hooks/useChangeRequestForBranch.ts` | Evidence: existing MR/PR branch-resolution call sites (`listChangeRequests` usages in `apps/web`) | Tests: hook unit test if a new hook file is created | Not included: caching/dedup strategy beyond existing query-client defaults | Rollback: revert the guard to "always available" — menu entry stays enabled regardless of CR existence (degraded UX, not broken) | Est: 30 min
- T14: End-to-end QA pass: verify GitLab + GitHub flows in a real repo — open card, live pipeline update, view threads, merge with squash+delete-branch, error path on merge failure, disabled-reason tooltip when no CR exists [deps: T4, T5, T6, T11, T12, T13] | Files: none (manual + existing test suites) | Evidence: n/a (functional verification) | Tests: run full `apps/server` + `apps/web` suites; manual browser QA | Not included: automated Playwright e2e suite (flag as follow-up if desired) | Rollback: n/a (verification only) | Est: 60 min
