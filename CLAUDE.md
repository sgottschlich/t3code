AGENTS.md

## Project Memory

> Long-term, append-only context for this repository. Managed by the `update-memories` skill.
> Do not edit existing entries; add new ones.

### 📐 Code Style & Conventions

### 🏗️ Architecture & Boundaries

- [pattern] **Adding a new right-panel surface kind**: extend `RightPanelSurface` via a 3-step edit — add the kind to `RIGHT_PANEL_KINDS` and the union in `apps/web/src/rightPanelStore.ts`, add its case to `singletonSurface()`, then wire icon/title/disabled-reason in `RightPanelTabs.tsx` and an opener callback in `ChatView.tsx` (pattern confirmed via the `"agents"`/`"plan"` kinds; applied in the design at `docs/wip/IDEA-mr-sidebar-card/design.md`).
- [pattern] **Live per-resource status updates**: use a server-side streaming RPC + ref-counted interval poller + `PubSub` keyed per resource (reference implementation: `apps/server/src/vcs/VcsStatusBroadcaster.ts`), not client-side polling per open tab — avoids spawning one CLI/poll process per open UI surface.
- [pattern] **Auth scope for mutating RPC actions**: higher-blast-radius mutating actions (e.g. merging a change request) get their own domain-specific auth scope instead of reusing the broad `AuthOrchestrationOperateScope` — precedent: `AuthReviewWriteScope` for diff-review actions in `apps/server/src/auth/RpcAuthorization.ts`.

### 🧪 Testing & QA

### 🛠️ Tooling & CI

### 💡 Gotchas & Pitfalls
