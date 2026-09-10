import { useCallback, useEffect, useState, type RefObject } from "react";

import {
  MAX_QUEUED_MESSAGES,
  useMessageQueueStore,
  useThreadMessageQueue,
  type QueuedMessage,
} from "~/messageQueueStore";
import { randomUUID } from "~/lib/utils";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { canFlushQueuedMessage, shouldQueueOutgoingMessage } from "./messageQueue.logic";

export interface ComposerMessageQueueDeps {
  readonly threadKey: string | null;
  readonly isServerThread: boolean;
  /** Guards against racing the composer's own send; the queue never both. */
  readonly sendInFlightRef: RefObject<boolean>;
  readonly phase: Parameters<typeof canFlushQueuedMessage>[0]["phase"];
  readonly isSendBusy: boolean;
  readonly hasActiveTurn: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  /**
   * Dispatches one queued prompt as a turn. Resolving false means the turn did
   * not start, and the entry goes back into the queue: the caller owns undoing
   * whatever it did optimistically.
   */
  readonly dispatch: (queued: QueuedMessage) => Promise<boolean>;
}

export interface ComposerMessageQueue {
  readonly messages: readonly QueuedMessage[];
  /** Whether the next send should join the queue instead of dispatching. */
  readonly shouldQueueNextSend: boolean;
  /** Queues a prompt. False means the queue is full; the user was told. */
  readonly enqueue: (input: { text: string; images: QueuedMessage["images"] }) => boolean;
  readonly onSendNow: (queuedMessageId: string) => void;
  readonly onDiscard: (queuedMessageId: string) => void;
}

/**
 * The composer's send queue: holds prompts submitted while the agent is busy
 * and releases them one at a time as it frees up.
 *
 * A failed dispatch halts the queue for that thread rather than retrying,
 * because the requeue would immediately satisfy the flush condition again and
 * spin. Queueing, sending or discarding by hand clears the halt.
 */
export function useComposerMessageQueue(deps: ComposerMessageQueueDeps): ComposerMessageQueue {
  const { threadKey, isServerThread, sendInFlightRef, dispatch } = deps;
  const messages = useThreadMessageQueue(threadKey);
  const enqueueMessage = useMessageQueueStore((store) => store.enqueueMessage);
  const requeueMessage = useMessageQueueStore((store) => store.requeueMessage);
  const takeMessage = useMessageQueueStore((store) => store.takeMessage);
  const discardMessage = useMessageQueueStore((store) => store.discardMessage);
  const [haltedThreadKey, setHaltedThreadKey] = useState<string | null>(null);

  const shouldQueueNextSend =
    isServerThread &&
    threadKey !== null &&
    shouldQueueOutgoingMessage({
      phase: deps.phase,
      isSendBusy: deps.isSendBusy,
      hasPendingApproval: deps.hasPendingApproval,
      hasPendingUserInput: deps.hasPendingUserInput,
      queuedCount: messages.length,
    });

  const enqueue = useCallback(
    (input: { text: string; images: QueuedMessage["images"] }) => {
      if (threadKey === null) return false;
      const queued = enqueueMessage(threadKey, {
        id: randomUUID(),
        text: input.text,
        images: [...input.images],
        createdAt: new Date().toISOString(),
      });
      if (!queued) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Queue is full",
            description: `Send or remove a queued message before adding more (limit ${MAX_QUEUED_MESSAGES}).`,
          }),
        );
        return false;
      }
      setHaltedThreadKey(null);
      return true;
    },
    [enqueueMessage, threadKey],
  );

  /** Shared by the automatic flush and the per-entry send action — the latter
      deliberately works mid-turn, because sending by hand is how the user
      steers a running agent. */
  const send = useCallback(
    async (queuedMessageId: string) => {
      if (threadKey === null || !isServerThread || sendInFlightRef.current) return;
      const queued = takeMessage(threadKey, queuedMessageId);
      if (!queued) return;
      if (!(await dispatch(queued))) {
        requeueMessage(threadKey, queued);
        setHaltedThreadKey(threadKey);
      }
    },
    [dispatch, isServerThread, requeueMessage, sendInFlightRef, takeMessage, threadKey],
  );

  const headId = messages[0]?.id ?? null;
  const canFlush =
    headId !== null &&
    threadKey !== null &&
    haltedThreadKey !== threadKey &&
    canFlushQueuedMessage({
      phase: deps.phase,
      hasActiveTurn: deps.hasActiveTurn,
      isSendBusy: deps.isSendBusy,
      isSendInFlight: sendInFlightRef.current,
      hasPendingApproval: deps.hasPendingApproval,
      hasPendingUserInput: deps.hasPendingUserInput,
      hasActionableProposedPlan: deps.hasActionableProposedPlan,
    });

  useEffect(() => {
    if (!canFlush || headId === null) return;
    void send(headId);
  }, [canFlush, headId, send]);

  const onSendNow = useCallback(
    (queuedMessageId: string) => {
      setHaltedThreadKey(null);
      void send(queuedMessageId);
    },
    [send],
  );

  const onDiscard = useCallback(
    (queuedMessageId: string) => {
      if (threadKey === null) return;
      setHaltedThreadKey(null);
      discardMessage(threadKey, queuedMessageId);
    },
    [discardMessage, threadKey],
  );

  return { messages, shouldQueueNextSend, enqueue, onSendNow, onDiscard };
}
