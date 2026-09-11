import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  type EnvironmentId,
  type ProjectRoutine,
  type ProjectRoutineInput,
  type WorktreeCleanupScan,
  ProjectId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import { useProjects } from "../../state/entities";
import {
  primaryServerConfigAtom,
  primaryServerProvidersAtom,
  serverEnvironment,
} from "../../state/server";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";
import { SettingsRow } from "./settingsLayout";

const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
function localDateInput(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ProjectMaintenanceButton() {
  const environmentId = usePrimaryEnvironmentId();
  const supported =
    useAtomValue(primaryServerConfigAtom)?.environment.capabilities.projectMaintenance;
  const [open, setOpen] = useState(false);
  if (!environmentId || !supported) return null;
  return (
    <>
      <SettingsRow
        title="Project routines and worktrees"
        description="Schedule project tasks and reclaim unused worktree directories."
        control={
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Routines & worktree cleanup
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Project routines & worktrees</DialogTitle>
            <DialogDescription>
              Manage the currently selected environment. Routines run while its server is running.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {open && <ProjectMaintenancePanel key={environmentId} environmentId={environmentId} />}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function ProjectMaintenancePanel({ environmentId }: { environmentId: EnvironmentId }) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const modelChoices = providers
    .filter((provider) => provider.enabled && provider.installed)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: JSON.stringify([provider.instanceId, model.slug]),
        label: `${provider.displayName ?? provider.driver} / ${model.name}`,
        selection: { instanceId: provider.instanceId, model: model.slug },
      })),
    );
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [routines, setRoutines] = useState<ReadonlyArray<ProjectRoutine>>([]);
  const [draft, setDraft] = useState<ProjectRoutineInput | null>(null);
  const [scan, setScan] = useState<WorktreeCleanupScan | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const list = useAtomCommand(serverEnvironment.listRoutines);
  const save = useAtomCommand(serverEnvironment.saveRoutine);
  const remove = useAtomCommand(serverEnvironment.deleteRoutine);
  const run = useAtomCommand(serverEnvironment.runRoutine);
  const scanWorktrees = useAtomCommand(serverEnvironment.scanWorktrees);
  const cleanup = useAtomCommand(serverEnvironment.cleanupWorktree);
  const refresh = useCallback(async () => {
    const result = await list({ environmentId, input: {} });
    if (result._tag === "Success") setRoutines(result.value);
  }, [environmentId, list]);
  useEffect(() => {
    let active = true;
    void list({ environmentId, input: {} }).then((result) => {
      if (active && result._tag === "Success") setRoutines(result.value);
    });
    return () => {
      active = false;
    };
  }, [environmentId, list]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    if (!projectId) return;
    setScan(null);
    setSelected(new Set());
    const result = await scanWorktrees({
      environmentId,
      input: { projectId: ProjectId.make(projectId) },
    });
    if (result._tag === "Success") setScan(result.value);
  };
  const visibleRoutines = routines.filter((routine) => routine.projectId === projectId);
  return (
    <div className="space-y-6">
      <label className="grid gap-2 text-sm">
        Project
        <select
          className={fieldClass}
          value={projectId}
          disabled={busy}
          onChange={(event) => {
            setProjectId(event.target.value);
            setDraft(null);
            setScan(null);
            setSelected(new Set());
          }}
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <section className="space-y-3" aria-label="Routines">
        <div className="flex items-center gap-2">
          <h3 className="mr-auto font-medium">Routines</h3>
          <Button variant="ghost" disabled={busy} onClick={() => void action(refresh)}>
            Refresh
          </Button>
          <Button
            disabled={busy || !projectId || !modelChoices[0]}
            onClick={() => {
              const model = modelChoices[0];
              if (!model || !projectId) return;
              setDraft({
                id: randomUUID(),
                projectId: ProjectId.make(projectId),
                name: "",
                prompt: "",
                modelSelection: model.selection,
                runtimeMode: "approval-required",
                enabled: true,
                firstRunAt: new Date(Date.now() + 3_600_000).toISOString(),
                intervalMinutes: 1440,
              });
            }}
          >
            New routine
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Each run creates a thread in the project’s current checkout. Missed intervals are combined
          into one run. A routine waits while its previous run is active.
        </p>
        {visibleRoutines.length === 0 && (
          <p className="text-sm text-muted-foreground">No routines for this project.</p>
        )}
        {visibleRoutines.map((routine) => (
          <div key={routine.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="mr-auto text-sm">{routine.name}</strong>
              <span className="text-xs text-muted-foreground">
                {routine.enabled ? "Enabled" : "Paused"}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(routine)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await save({ environmentId, input: { ...routine, enabled: !routine.enabled } });
                    await refresh();
                  })
                }
              >
                {routine.enabled ? "Pause" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await run({ environmentId, input: { id: routine.id } });
                    await refresh();
                  })
                }
              >
                Run now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await remove({ environmentId, input: { id: routine.id } });
                    await refresh();
                  })
                }
              >
                Delete routine
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {routine.enabled && routine.nextRunAt
                ? `Next: ${new Date(routine.nextRunAt).toLocaleString()}`
                : "No scheduled start"}
              {routine.lastRunAt ? ` · Last: ${new Date(routine.lastRunAt).toLocaleString()}` : ""}
            </p>
            {routine.lastThreadId && (
              <Link
                className="text-sm underline"
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: routine.lastThreadId }}
              >
                Open last run
              </Link>
            )}
            {routine.lastError && (
              <p role="status" className="text-sm text-destructive">
                {routine.lastError}
              </p>
            )}
          </div>
        ))}
        {draft && (
          <form
            className="grid gap-3 rounded-md border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const result = await save({ environmentId, input: draft });
                if (result._tag === "Success") setDraft(null);
                await refresh();
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              Name
              <Input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Prompt
              <textarea
                required
                maxLength={32000}
                rows={4}
                className={fieldClass}
                value={draft.prompt}
                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Provider / model
              <select
                required
                className={fieldClass}
                value={JSON.stringify([
                  draft.modelSelection.instanceId,
                  draft.modelSelection.model,
                ])}
                onChange={(event) => {
                  const choice = modelChoices.find((entry) => entry.key === event.target.value);
                  if (choice) setDraft({ ...draft, modelSelection: choice.selection });
                }}
              >
                {!modelChoices.some(
                  (entry) =>
                    entry.selection.instanceId === draft.modelSelection.instanceId &&
                    entry.selection.model === draft.modelSelection.model,
                ) && (
                  <option
                    value={JSON.stringify([
                      draft.modelSelection.instanceId,
                      draft.modelSelection.model,
                    ])}
                  >
                    {draft.modelSelection.instanceId} / {draft.modelSelection.model} (unavailable)
                  </option>
                )}
                {modelChoices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Permissions
              <select
                className={fieldClass}
                value={draft.runtimeMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtimeMode:
                      event.target.value === "full-access" ? "full-access" : "approval-required",
                  })
                }
              >
                <option value="approval-required">Ask for approval</option>
                <option value="full-access">Full access (unattended)</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Approval requests pause the run until you respond in its thread. Full access allows
              the agent to act without approval.
            </p>
            <label className="grid gap-1 text-sm">
              First run (your local time)
              <Input
                required
                type="datetime-local"
                value={localDateInput(draft.firstRunAt)}
                onChange={(event) => {
                  if (event.target.value)
                    setDraft({ ...draft, firstRunAt: new Date(event.target.value).toISOString() });
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.intervalMinutes !== null}
                onChange={(event) =>
                  setDraft({ ...draft, intervalMinutes: event.target.checked ? 1440 : null })
                }
              />
              Repeat
            </label>
            {draft.intervalMinutes !== null && (
              <label className="grid gap-1 text-sm">
                Every (minutes)
                <Input
                  required
                  type="number"
                  min={1}
                  max={525600}
                  value={draft.intervalMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, intervalMinutes: Number(event.target.value) })
                  }
                />
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Save routine
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
      <section className="space-y-3 border-t pt-4" aria-label="Worktree cleanup">
        <div className="flex items-center gap-2">
          <h3 className="mr-auto font-medium">Worktree cleanup</h3>
          <Button
            variant="outline"
            disabled={busy || !projectId}
            onClick={() => void action(inspect)}
          >
            Find unused worktrees
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Only managed worktrees with no active or archived thread are listed. Modified, locked or
          detached worktrees cannot be deleted here. Branches and threads are kept.
        </p>
        {scan && (
          <>
            {scan.candidates.length === 0 && <p className="text-sm">No unused worktrees found.</p>}
            {scan.candidates.map((candidate) => (
              <label
                key={candidate.path}
                className="flex items-start gap-2 rounded-md border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  disabled={
                    busy || candidate.modified || candidate.locked || candidate.branch === null
                  }
                  checked={selected.has(candidate.path)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(candidate.path);
                    else next.delete(candidate.path);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0 break-all">
                  {candidate.path}
                  <span className="block text-xs text-muted-foreground">
                    {candidate.branch ?? "Detached HEAD"}
                    {candidate.modified ? " · Uncommitted changes" : ""}
                    {candidate.locked ? " · Locked" : ""}
                  </span>
                </span>
              </label>
            ))}
            {scan.candidates.length > 0 && (
              <Button
                variant="destructive"
                disabled={busy || selected.size === 0}
                onClick={() =>
                  void action(async () => {
                    let deleted = 0;
                    for (const target of selected) {
                      const result = await cleanup({
                        environmentId,
                        input: { projectId: ProjectId.make(projectId), path: target },
                      });
                      if (result._tag === "Success") deleted++;
                    }
                    const requested = selected.size;
                    await inspect();
                    setNotice(`Deleted ${deleted} of ${requested} selected worktrees.`);
                  })
                }
              >
                Delete {selected.size} selected worktrees from disk
              </Button>
            )}
            {scan.missingThreads.length > 0 && (
              <div className="space-y-1 text-sm">
                <p>Threads whose worktree is missing (kept unchanged):</p>
                {scan.missingThreads.map((thread) => (
                  <p key={thread.threadId}>
                    <Link
                      className="underline"
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: thread.threadId }}
                    >
                      {thread.title}
                    </Link>
                    <span className="block break-all text-xs text-muted-foreground">
                      {thread.path}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
        {busy && (
          <p role="status" className="text-sm">
            Working…
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
