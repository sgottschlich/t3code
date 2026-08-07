import type {
  ChangeRequestPipelineStatus,
  ChangeRequestThread,
  EnvironmentId,
  VcsStatusResult,
} from "@t3tools/contracts";
import { ChevronDown, ExternalLink, GitPullRequest } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";

import { MergeChangeRequestDialog } from "./MergeChangeRequestDialog";

type ChangeRequestSummary = NonNullable<VcsStatusResult["pr"]>;

interface ChangeRequestPanelProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string | null;
  changeRequest: ChangeRequestSummary | null;
}

const PIPELINE_STATUS_LABEL: Record<ChangeRequestPipelineStatus, string> = {
  none: "No pipeline",
  pending: "Pending",
  running: "Running",
  success: "Passed",
  failed: "Failed",
  canceled: "Canceled",
  skipped: "Skipped",
  manual: "Manual",
};

const PIPELINE_STATUS_BADGE: Record<ChangeRequestPipelineStatus, string> = {
  none: "bg-muted-foreground/40",
  pending: "bg-muted-foreground/60",
  running: "bg-info",
  success: "bg-success",
  failed: "bg-destructive",
  canceled: "bg-muted-foreground/60",
  skipped: "bg-muted-foreground/40",
  manual: "bg-warning",
};

function PipelineStatusBadge({ status }: { status: ChangeRequestPipelineStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("size-1.5 shrink-0 rounded-full", PIPELINE_STATUS_BADGE[status])} />
      {PIPELINE_STATUS_LABEL[status]}
    </span>
  );
}

function ThreadRow({ thread }: { thread: ChangeRequestThread }) {
  const location =
    thread.filePath && thread.line
      ? `${thread.filePath}:${thread.line}`
      : (thread.filePath ?? null);
  return (
    <a
      href={thread.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "block rounded-lg border border-border/70 bg-muted/24 p-2.5 text-left transition hover:border-border hover:bg-accent/40",
        !thread.url && "pointer-events-none",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{thread.author}</span>
        {location ? (
          <span className="shrink-0 truncate text-[.6875rem] text-muted-foreground">
            {location}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{thread.bodyExcerpt}</p>
    </a>
  );
}

export function ChangeRequestPanel(props: ChangeRequestPanelProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [showResolvedThreads, setShowResolvedThreads] = useState(false);

  const ready = props.environmentId !== null && props.cwd !== null && props.reference !== null;
  const target = ready
    ? { environmentId: props.environmentId!, cwd: props.cwd!, reference: props.reference! }
    : null;

  const pipelineQuery = useEnvironmentQuery(
    target
      ? gitEnvironment.changeRequestPipeline({
          environmentId: target.environmentId,
          input: { cwd: target.cwd, reference: target.reference },
        })
      : null,
  );
  const threadsQuery = useEnvironmentQuery(
    target
      ? gitEnvironment.changeRequestThreads({
          environmentId: target.environmentId,
          input: { cwd: target.cwd, reference: target.reference },
        })
      : null,
  );
  const gitStatusQuery = useEnvironmentQuery(
    target
      ? vcsEnvironment.status({
          environmentId: target.environmentId,
          input: { cwd: target.cwd },
        })
      : null,
  );

  const presentation = getSourceControlPresentation(gitStatusQuery.data?.sourceControlProvider);
  const ProviderIcon = presentation.Icon;
  const changeRequest = props.changeRequest;
  const pipelineStale = pipelineQuery.error !== null && pipelineQuery.data !== null;
  const threads = threadsQuery.data?.threads ?? [];
  const unresolvedThreads = threads.filter((thread) => !thread.resolved);
  const resolvedThreads = threads.filter((thread) => thread.resolved);

  if (!changeRequest || !target) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No {presentation.terminology.singular} found for the current branch.
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1" scrollFade>
      <div className="flex flex-col gap-4 p-4">
        <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={changeRequest.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
              >
                <ProviderIcon className="size-3.5 shrink-0" />
                <span className="truncate">{changeRequest.title}</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </a>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                #{changeRequest.number} · {changeRequest.headRef} → {changeRequest.baseRef}
              </p>
            </div>
            <Badge
              variant={
                changeRequest.state === "merged"
                  ? "success"
                  : changeRequest.state === "closed"
                    ? "secondary"
                    : "info"
              }
              className="shrink-0 capitalize"
            >
              {changeRequest.state}
            </Badge>
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={changeRequest.state !== "open"}
            onClick={() => setMergeDialogOpen(true)}
          >
            <GitPullRequest />
            Merge
          </Button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">Pipeline</h3>
            {pipelineStale ? (
              <span className="text-[.6875rem] text-warning-foreground">Stale — reconnecting…</span>
            ) : null}
          </div>
          {pipelineQuery.isPending && !pipelineQuery.data ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Loading pipeline...
            </div>
          ) : pipelineQuery.error && !pipelineQuery.data ? (
            <p className="text-xs text-destructive">{pipelineQuery.error}</p>
          ) : pipelineQuery.data ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/24 px-2.5 py-1.5">
                <span className="text-xs font-medium">Overall</span>
                <PipelineStatusBadge status={pipelineQuery.data.status} />
              </div>
              {pipelineQuery.data.jobs.map((job, index) => (
                <div
                  key={`${job.name}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs">{job.name}</p>
                    {job.stage ? (
                      <p className="truncate text-[.6875rem] text-muted-foreground">{job.stage}</p>
                    ) : null}
                  </div>
                  <PipelineStatusBadge status={job.status} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">
            Open threads{unresolvedThreads.length > 0 ? ` (${unresolvedThreads.length})` : ""}
          </h3>
          {threadsQuery.isPending && !threadsQuery.data ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Loading threads...
            </div>
          ) : threadsQuery.error && !threadsQuery.data ? (
            <p className="text-xs text-destructive">{threadsQuery.error}</p>
          ) : unresolvedThreads.length === 0 && resolvedThreads.length === 0 ? (
            <p className="text-xs text-muted-foreground">No review threads yet.</p>
          ) : (
            <div className="space-y-1.5">
              {unresolvedThreads.length === 0 ? (
                <p className="text-xs text-muted-foreground">No open threads.</p>
              ) : (
                unresolvedThreads.map((thread) => <ThreadRow key={thread.id} thread={thread} />)
              )}
              {resolvedThreads.length > 0 ? (
                <Collapsible open={showResolvedThreads} onOpenChange={setShowResolvedThreads}>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-[.6875rem] text-muted-foreground hover:text-foreground">
                    <ChevronDown
                      className={cn(
                        "size-3 shrink-0 transition-transform",
                        !showResolvedThreads && "-rotate-90",
                      )}
                    />
                    {resolvedThreads.length} resolved
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1.5 pt-1.5">
                      {resolvedThreads.map((thread) => (
                        <ThreadRow key={thread.id} thread={thread} />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <MergeChangeRequestDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        environmentId={target.environmentId}
        cwd={target.cwd}
        reference={target.reference}
        changeRequest={changeRequest}
        onMerged={() => {
          gitStatusQuery.refresh();
          pipelineQuery.refresh();
        }}
      />
    </ScrollArea>
  );
}
