---
feature: IDEA-mr-sidebar-card
status: in-progress
review-mode: standard
---

# Tasks: Change Request card in the right sidebar

- [x] T1: Extend `ChangeRequest` contract with pipeline/thread/mergeable/draft fields + new schemas [no deps]
- [x] T2: Add `AuthSourceControlWriteScope` and wire it into the `RpcAuthorization` scope map [no deps]
- [x] T3: Add `getChangeRequestPipeline` / `listChangeRequestThreads` / `mergeChangeRequest` to the `SourceControlProvider` interface [deps: T1]
- [x] T4: Implement GitLab pipeline/threads/merge via `glab` CLI wrapper + JSON decoding [deps: T3]
- [x] T5: Implement GitHub pipeline/threads/merge via `gh` CLI wrapper [deps: T3]
- [x] T6: Add "not supported" stub errors for Azure DevOps + Bitbucket providers [deps: T3]
- [x] T7: Add `ChangeRequestStatusBroadcaster` (server-side ref-counted poller + PubSub) [deps: T4, T5]
- [x] T8: Add RPC methods (`subscribeChangeRequestStatus` stream, `mergeChangeRequest`, `listChangeRequestThreads`) + `ws.ts` handlers [deps: T7]
- [x] T9: Add `"changeRequest"` surface kind to `rightPanelStore` [deps: T1]
- [x] T10: Wire add-menu entry + tab icon/title + disabled-reason tooltip in `RightPanelTabs`, opener in `ChatView` [deps: T9]
- [x] T11: Build `ChangeRequestPanel.tsx` (pipeline status + thread list) [deps: T8, T10]
- [x] T12: Build `MergeChangeRequestDialog.tsx` (squash/delete-branch toggles, in-flight lock) [deps: T8, T11]
- [x] T13: Add branch→ChangeRequest existence check for the add-menu guard [deps: T10] — reused the existing `gitStatus.pr` field already fetched by `subscribeVcsStatus`, no new hook needed.
- [ ] T14: End-to-end QA pass: GitLab + GitHub flows (live update, merge, error paths) [deps: T4, T5, T6, T11, T12, T13] — typecheck/unit tests done (see below); live GitLab/GitHub browser verification not run (no real MR available in this sandbox).
