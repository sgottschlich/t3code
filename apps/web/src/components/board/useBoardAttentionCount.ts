import { useMemo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadShells } from "../../state/entities";
import { countBoardThreadsNeedingUser } from "./board.logic";

/** How many cards sit in the board's "Needs you" column, across every project. */
export function useBoardAttentionCount(): number {
  const threads = useThreadShells();
  const nowMinute = useNowMinute();
  return useMemo(
    () => countBoardThreadsNeedingUser(threads, { now: `${nowMinute}:00.000Z` }),
    [nowMinute, threads],
  );
}
