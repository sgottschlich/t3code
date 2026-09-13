import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ApprovalRequestId, ProviderApprovalDecision } from "@t3tools/contracts";
import { CheckIcon, CornerDownLeftIcon } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { newMessageId } from "../../lib/utils";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildPlanImplementationPrompt,
  proposedPlanTitle,
} from "../../proposedPlan";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  type PendingUserInput,
} from "../../session-logic";
import { useThread } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadTurnInterruptInput } from "../ChatView.logic";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { resolveSnoozePresets } from "../Sidebar.snooze";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { cn } from "~/lib/utils";
import { BOARD_STATUS_LABELS, type BoardCard } from "./board.logic";

const PLAN_PREVIEW_LINES = 10;

function failureToast(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * The short-action surface behind a board card. Mounted only while open, so
 * the thread detail (activities, plans) is subscribed for exactly one card at
 * a time; the board itself renders from shells alone.
 */
export function BoardCardPopover(props: {
  readonly card: BoardCard;
  readonly onOpenThread: () => void;
  readonly onClose: () => void;
}) {
  const { card, onOpenThread, onClose } = props;
  const shell = card.thread;
  const threadRef = useMemo(
    () => scopeThreadRef(shell.environmentId, shell.id),
    [shell.environmentId, shell.id],
  );
  const thread = useThread(threadRef);
  const environmentId = shell.environmentId;

  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const setInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const { archiveThread, snoozeThread, unsnoozeThread, unsettleThread } = useThreadActions();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  const [respondingRequestIds, setRespondingRequestIds] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState<"send" | "stop" | "archive" | "snooze" | "plan" | null>(null);

  const pending = useMemo(
    () => derivePendingRequests(thread?.activities ?? []),
    [thread?.activities],
  );
  const approval = pending.approvals[0] ?? null;
  const userInput = pending.userInputs[0] ?? null;
  const proposedPlan = useMemo(() => {
    if (!thread || !isLatestTurnSettled(thread.latestTurn, thread.session)) return null;
    const plan = findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null);
    return hasActionableProposedPlan(plan) ? plan : null;
  }, [thread]);

  const markResponding = useCallback((requestId: string, responding: boolean) => {
    setRespondingRequestIds((existing) =>
      responding
        ? existing.includes(requestId)
          ? existing
          : [...existing, requestId]
        : existing.filter((id) => id !== requestId),
    );
  }, []);

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      markResponding(requestId, true);
      const result = await respondToApproval({
        environmentId,
        input: { threadId: shell.id, requestId, decision },
      });
      markResponding(requestId, false);
      failureToast("Failed to submit approval decision", result);
      return result;
    },
    [environmentId, markResponding, respondToApproval, shell.id],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, string | string[]>) => {
      markResponding(requestId, true);
      const result = await respondToUserInput({
        environmentId,
        input: { threadId: shell.id, requestId, answers },
      });
      markResponding(requestId, false);
      failureToast("Failed to send the answer", result);
    },
    [environmentId, markResponding, respondToUserInput, shell.id],
  );

  const onDismissUserInput = useCallback(
    async (requestId: ApprovalRequestId) => {
      markResponding(requestId, true);
      const result = await dismissUserInput({
        environmentId,
        input: { threadId: shell.id, requestId },
      });
      markResponding(requestId, false);
      failureToast("Failed to dismiss the question", result);
    },
    [dismissUserInput, environmentId, markResponding, shell.id],
  );

  const sendMessage = useCallback(
    async (text: string, options?: { readonly implementPlanId?: string }) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      setBusy(options?.implementPlanId ? "plan" : "send");
      const createdAt = new Date().toISOString();
      // Implementing a plan leaves plan mode; anything else keeps the thread's
      // own mode, model and runtime settings, exactly as the chat would.
      const interactionMode = options?.implementPlanId ? "default" : shell.interactionMode;
      if (interactionMode !== shell.interactionMode) {
        const modeResult = await setInteractionMode({
          environmentId,
          input: { threadId: shell.id, interactionMode, createdAt },
        });
        if (modeResult._tag === "Failure") {
          failureToast("Failed to leave plan mode", modeResult);
          setBusy(null);
          return;
        }
      }
      const result = await startTurn({
        environmentId,
        input: {
          threadId: shell.id,
          message: { messageId: newMessageId(), role: "user", text: trimmed, attachments: [] },
          modelSelection: shell.modelSelection,
          titleSeed: shell.title,
          runtimeMode: shell.runtimeMode,
          interactionMode,
          ...(options?.implementPlanId
            ? { sourceProposedPlan: { threadId: shell.id, planId: options.implementPlanId } }
            : {}),
          createdAt,
        },
      });
      setBusy(null);
      failureToast("Failed to send the message", result);
    },
    [
      environmentId,
      setInteractionMode,
      shell.id,
      shell.interactionMode,
      shell.modelSelection,
      shell.runtimeMode,
      shell.title,
      startTurn,
    ],
  );

  const onStop = useCallback(async () => {
    setBusy("stop");
    const result = await interruptTurn({
      environmentId,
      input: buildThreadTurnInterruptInput(shell),
    });
    setBusy(null);
    failureToast("Failed to stop the thread", result);
  }, [environmentId, interruptTurn, shell]);

  const onArchive = useCallback(async () => {
    setBusy("archive");
    const result = await archiveThread(threadRef);
    setBusy(null);
    failureToast("Failed to archive thread", result);
    if (result._tag === "Success") onClose();
  }, [archiveThread, onClose, threadRef]);

  const onSnooze = useCallback(
    async (snoozedUntil: string) => {
      setBusy("snooze");
      const result = await snoozeThread(threadRef, snoozedUntil);
      setBusy(null);
      failureToast("Failed to snooze thread", result);
    },
    [snoozeThread, threadRef],
  );

  const onUnsnooze = useCallback(async () => {
    setBusy("snooze");
    const result = await unsnoozeThread(threadRef);
    setBusy(null);
    failureToast("Failed to wake thread", result);
  }, [threadRef, unsnoozeThread]);

  const onUnsettle = useCallback(async () => {
    setBusy("snooze");
    const result = await unsettleThread(threadRef);
    setBusy(null);
    failureToast("Failed to un-settle thread", result);
  }, [threadRef, unsettleThread]);

  const status = card.status;
  const column = card.column;
  // A session failure is on the shell; a turn that errored only leaves an
  // error activity behind, which needs the detail.
  const failureText =
    shell.session?.lastError ??
    thread?.activities.findLast((activity) => activity.tone === "error")?.summary ??
    null;
  const showsReply =
    status === "failed" || status === "plan" || column === "done" || column === "parked";
  const snoozePresets = useMemo(
    () => resolveSnoozePresets(new Date(), timestampFormat),
    [timestampFormat],
  );

  return (
    <div className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 text-sm">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{shell.title}</p>
          <p className="text-xs text-muted-foreground">{BOARD_STATUS_LABELS[status]}</p>
        </div>
        <Button size="xs" variant="outline" onClick={onOpenThread}>
          Open
        </Button>
      </header>

      {thread === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden className="size-3.5" />
          Loading thread
        </div>
      ) : null}

      {approval ? (
        <section className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approval needed
          </p>
          <p className="font-medium">{approval.appName ?? approval.requestKind}</p>
          {approval.detail ? (
            <p className="line-clamp-6 whitespace-pre-wrap break-words font-mono text-xs text-foreground/85">
              {approval.detail}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            <ComposerPendingApprovalActions
              requestId={approval.requestId}
              isResponding={respondingRequestIds.includes(approval.requestId)}
              options={approval.options}
              onRespondToApproval={onRespondToApproval}
            />
          </div>
        </section>
      ) : null}

      {userInput ? (
        <BoardQuestionPrompt
          key={userInput.requestId}
          prompt={userInput}
          isResponding={respondingRequestIds.includes(userInput.requestId)}
          onRespond={onRespondToUserInput}
          onDismiss={onDismissUserInput}
        />
      ) : null}

      {status === "plan" && proposedPlan ? (
        <section className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {proposedPlanTitle(proposedPlan.planMarkdown) ?? "Proposed plan"}
          </p>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs text-foreground/85">
            {buildCollapsedProposedPlanPreviewMarkdown(proposedPlan.planMarkdown, {
              maxLines: PLAN_PREVIEW_LINES,
            })}
          </pre>
          <div>
            <Button
              size="xs"
              disabled={busy !== null}
              onClick={() =>
                void sendMessage(buildPlanImplementationPrompt(proposedPlan.planMarkdown), {
                  implementPlanId: proposedPlan.id,
                })
              }
            >
              Implement plan
            </Button>
          </div>
        </section>
      ) : null}

      {status === "failed" && failureText ? (
        <p className="line-clamp-5 whitespace-pre-wrap break-words rounded-md bg-destructive/8 p-2.5 text-xs text-destructive-foreground">
          {failureText}
        </p>
      ) : null}

      {showsReply ? (
        <BoardQuickReply disabled={busy !== null} sending={busy === "send"} onSend={sendMessage} />
      ) : null}

      <footer className="flex flex-wrap items-center gap-1">
        {column === "working" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void onStop()}
          >
            Stop
          </Button>
        ) : null}
        {status === "snoozed" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void onUnsnooze()}
          >
            Unsnooze
          </Button>
        ) : column === "done" || column === "parked" || status === "failed" ? (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" disabled={busy !== null} />}>
              Snooze
            </MenuTrigger>
            <MenuPopup align="start">
              {snoozePresets.map((preset) => (
                <MenuItem key={preset.id} onClick={() => void onSnooze(preset.snoozedUntil)}>
                  <span className="flex-1">{preset.label}</span>
                  <span className="text-xs text-muted-foreground">{preset.whenLabel}</span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
        {status === "settled" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void onUnsettle()}
          >
            Un-settle
          </Button>
        ) : null}
        {column !== "working" ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy !== null}
            onClick={() => void onArchive()}
          >
            Archive
          </Button>
        ) : null}
      </footer>
    </div>
  );
}

/** One line, Enter sends. Anything richer (attachments, model, slash commands) is the thread's job. */
function BoardQuickReply(props: {
  readonly disabled: boolean;
  readonly sending: boolean;
  readonly onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const submit = async () => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    await props.onSend(value);
    setText("");
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        size="compact"
        nativeInput
        value={text}
        placeholder="Next instruction"
        aria-label="Next instruction"
        disabled={props.disabled}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <Button
        type="submit"
        size="icon-xs"
        variant="outline"
        aria-label="Send"
        disabled={props.disabled || text.trim().length === 0}
      >
        {props.sending ? <Spinner className="size-3.5" /> : <CornerDownLeftIcon />}
      </Button>
    </form>
  );
}

/**
 * The composer's question flow (`pendingUserInput.ts`) in popover clothes:
 * one question at a time, options or a typed answer, number keys 1-9 while no
 * field has focus, and the reply goes out after the last question.
 */
function BoardQuestionPrompt(props: {
  readonly prompt: PendingUserInput;
  readonly isResponding: boolean;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    answers: Record<string, string | string[]>,
  ) => Promise<void>;
  readonly onDismiss: (requestId: ApprovalRequestId) => Promise<void>;
}) {
  const { prompt, isResponding, onRespond, onDismiss } = props;
  const [answers, setAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const question = progress.activeQuestion;

  const advance = (nextAnswers: Record<string, PendingUserInputDraftAnswer>) => {
    const next = derivePendingUserInputProgress(prompt.questions, nextAnswers, questionIndex);
    if (!next.canAdvance || isResponding) return;
    if (next.isLastQuestion) {
      const resolved = buildPendingUserInputAnswers(prompt.questions, nextAnswers);
      if (resolved) void onRespond(prompt.requestId, resolved);
      return;
    }
    setQuestionIndex(next.questionIndex + 1);
  };

  const selectOption = (optionValue: string) => {
    if (!question) return;
    const nextAnswers = {
      ...answers,
      [question.id]: togglePendingUserInputOptionSelection(
        question,
        answers[question.id],
        optionValue,
      ),
    };
    setAnswers(nextAnswers);
    if (!question.multiSelect) advance(nextAnswers);
  };

  // Number keys pick options while no field has focus, as in the composer.
  const selectOptionByDigit = useEffectEvent((digit: number) => {
    const option = question?.options[digit - 1];
    if (!option) return false;
    selectOption(option.value ?? option.label);
    return true;
  });
  useEffect(() => {
    if (!question || isResponding) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      if (selectOptionByDigit(digit)) event.preventDefault();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isResponding, question]);

  if (!question) return null;
  const allowCustomAnswer = question.allowCustomAnswer !== false;
  const customAnswerActive = progress.customAnswer.trim().length > 0;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {question.header}
        </p>
        {prompt.questions.length > 1 ? (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {progress.questionIndex + 1}/{prompt.questions.length}
          </span>
        ) : null}
      </div>
      <p className="text-foreground/90">{question.question}</p>
      {question.multiSelect ? (
        <p className="text-xs text-muted-foreground">Select one or more options.</p>
      ) : null}
      <div className="flex flex-col gap-0.5">
        {question.options.map((option, index) => {
          const optionValue = option.value ?? option.label;
          const isSelected =
            !customAnswerActive && progress.selectedOptionValues.includes(optionValue);
          return (
            <button
              key={`${question.id}:${optionValue}`}
              type="button"
              disabled={isResponding}
              onClick={() => selectOption(optionValue)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/25",
                isSelected ? "bg-muted/60 text-foreground" : "hover:bg-muted/30",
                isResponding && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="block text-[11px] text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {isSelected ? (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              ) : index < 9 ? (
                <kbd className="text-[10px] tabular-nums text-muted-foreground">{index + 1}</kbd>
              ) : null}
            </button>
          );
        })}
      </div>
      {allowCustomAnswer ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            advance(answers);
          }}
        >
          <Input
            size="compact"
            nativeInput
            value={progress.customAnswer}
            placeholder="Or type an answer"
            aria-label="Custom answer"
            disabled={isResponding}
            onChange={(event) =>
              setAnswers((existing) => ({
                ...existing,
                [question.id]: setPendingUserInputCustomAnswer(
                  existing[question.id],
                  event.currentTarget.value,
                ),
              }))
            }
          />
          <Button
            type="submit"
            size="icon-xs"
            variant="outline"
            aria-label={progress.isLastQuestion ? "Send answer" : "Next question"}
            disabled={isResponding || !progress.canAdvance}
          >
            {isResponding ? <Spinner className="size-3.5" /> : <CornerDownLeftIcon />}
          </Button>
        </form>
      ) : null}
      <div className="flex items-center gap-1">
        {progress.questionIndex > 0 ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isResponding}
            onClick={() => setQuestionIndex(progress.questionIndex - 1)}
          >
            Back
          </Button>
        ) : null}
        {question.multiSelect && !allowCustomAnswer ? (
          <Button
            size="xs"
            variant="outline"
            disabled={isResponding || !progress.canAdvance}
            onClick={() => advance(answers)}
          >
            {progress.isLastQuestion ? "Send" : "Next"}
          </Button>
        ) : null}
        {prompt.dismissible ? (
          <Button
            size="xs"
            variant="ghost-muted"
            className="ms-auto"
            disabled={isResponding}
            onClick={() => void onDismiss(prompt.requestId)}
          >
            Dismiss
          </Button>
        ) : null}
      </div>
    </section>
  );
}
