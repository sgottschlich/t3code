import { useAtomValue } from "@effect/atom-react";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { memo, useMemo, useState } from "react";

import { environmentPresentations } from "~/state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  toSidebarUsageRows,
  type ProviderUsageTone,
  type SidebarUsageRowView,
} from "./SidebarProviderUsage.logic";

const TONE_TEXT_STYLES: Record<ProviderUsageTone, string> = {
  default: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-destructive",
};

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Fills with what is LEFT, so the ring drains as the quota is consumed and
    always agrees with the number beside it. */
function UsageRing({ remainingPercent }: { remainingPercent: number }) {
  const filled = (Math.min(100, Math.max(0, remainingPercent)) / 100) * RING_CIRCUMFERENCE;
  return (
    <svg
      aria-hidden="true"
      className="-rotate-90 shrink-0"
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      width={RING_SIZE}
    >
      <circle
        className="opacity-25"
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        fill="none"
        r={RING_RADIUS}
        stroke="currentColor"
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        fill="none"
        r={RING_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
        strokeLinecap="round"
        strokeWidth={RING_STROKE}
      />
    </svg>
  );
}

function ProviderUsageRow({ row }: { row: SidebarUsageRowView }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={`${row.name} usage`}
            className="flex h-6 w-full cursor-default items-center gap-2 rounded-md px-2 text-xs"
          >
            <ProviderInstanceIcon
              className="size-4"
              displayName={row.name}
              driverKind={row.driver}
              iconClassName="size-3.5"
              {...(row.accentColor === undefined ? {} : { accentColor: row.accentColor })}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums">
              {row.windows.map((window) => (
                <span
                  key={window.key}
                  className={`flex items-center gap-1 ${TONE_TEXT_STYLES[window.tone]}`}
                >
                  <span className="font-normal opacity-70">{window.label}</span>
                  <UsageRing remainingPercent={window.remainingPercent} />
                  {window.percentLabel}
                </span>
              ))}
            </span>
          </div>
        }
      />
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">
          {row.windows.map((window) => (
            <span key={window.key}>{window.detail}</span>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Remaining subscription quota per provider, above the settings button.
 * Reads the same pooled model as the Limits page, so the sidebar and the
 * page can never disagree. Countdowns are deliberately absent: a ticking
 * clock in the sidebar would repaint it every minute for no decision.
 */
export const SidebarProviderUsage = memo(function SidebarProviderUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  // Anchored once per mount, like the Limits page: pace and reset ordering
  // must not drive a repaint of the sidebar.
  const [now] = useState(() => Date.now());
  const rows = useMemo(
    () => toSidebarUsageRows(collectLimitPools(collectLimitAccounts(presentations), now)),
    [now, presentations],
  );
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <ProviderUsageRow key={row.key} row={row} />
      ))}
    </div>
  );
});
