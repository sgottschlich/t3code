import type { LimitPool } from "@t3tools/shared/usageLimits";

export type ProviderUsageTone = "default" | "warning" | "critical";

export interface SidebarUsageWindowView {
  readonly key: string;
  /** Short window label ("5h", "1w"), derived from the pooled window's own label. */
  readonly label: string;
  /** Share still open, 0-100. The ring and the number both read this, so a
      nearly empty ring can never sit next to a large number. */
  readonly remainingPercent: number;
  readonly percentLabel: string;
  readonly tone: ProviderUsageTone;
  readonly detail: string;
}

export interface SidebarUsageRowView {
  readonly key: string;
  readonly driver: LimitPool["driver"];
  readonly name: string;
  readonly accentColor: string | undefined;
  readonly windows: ReadonlyArray<SidebarUsageWindowView>;
  /** Worst tone across the row's windows, for the collapsed state. */
  readonly tone: ProviderUsageTone;
}

const WARNING_AT_PERCENT = 75;
const CRITICAL_AT_PERCENT = 90;

export function usageToneForPercent(usedPercent: number): ProviderUsageTone {
  if (usedPercent >= CRITICAL_AT_PERCENT) return "critical";
  if (usedPercent >= WARNING_AT_PERCENT) return "warning";
  return "default";
}

const TONE_RANK: Record<ProviderUsageTone, number> = {
  default: 0,
  warning: 1,
  critical: 2,
};

export function worstUsageTone(
  tones: ReadonlyArray<ProviderUsageTone>,
): ProviderUsageTone {
  return tones.reduce<ProviderUsageTone>(
    (worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
    "default",
  );
}

/**
 * Compact the pooled window label for a sidebar row. The usage page has room
 * for "5-hour session"; a row 30 characters wide does not.
 */
export function shortWindowLabel(label: string): string {
  const compact = label.trim();
  const hours = /^(\d+)\s*-?\s*hour/i.exec(compact);
  if (hours) return `${hours[1]}h`;
  const days = /^(\d+)\s*-?\s*day/i.exec(compact);
  if (days) return days[1] === "7" ? "1w" : `${days[1]}d`;
  if (/^weekly$/i.test(compact)) return "1w";
  if (/^monthly$/i.test(compact)) return "1mo";
  // Codex labels its rolling window "Session" and gives no duration, so
  // there is nothing shorter to compute. Single words ride along whole
  // rather than becoming an ellipsis that says less than the word did.
  return compact.length <= 8 ? compact : `${compact.slice(0, 7)}…`;
}

/**
 * One row per provider, windows in the order the pool already established
 * (session before weekly before monthly). Pools without windows are dropped:
 * an empty row is a lie about a provider that reports nothing.
 */
export function toSidebarUsageRows(
  pools: ReadonlyArray<LimitPool>,
): ReadonlyArray<SidebarUsageRowView> {
  return pools.flatMap((pool) => {
    const windows = pool.windows.map((window): SidebarUsageWindowView => {
      const usedPercent = Math.round(window.usedPercent);
      const remainingPercent = Math.min(100, Math.max(0, 100 - usedPercent));
      return {
        key: `${window.kind}:${window.id}`,
        label: shortWindowLabel(window.label),
        remainingPercent,
        percentLabel: `${remainingPercent}%`,
        tone: usageToneForPercent(usedPercent),
        detail: `${window.label}: ${remainingPercent}% left`,
      };
    });
    if (windows.length === 0) return [];
    const [firstAccount] = pool.accounts;
    return [
      {
        key: String(pool.driver),
        driver: pool.driver,
        name: firstAccount?.displayName ?? String(pool.driver),
        accentColor: firstAccount?.accentColor,
        windows,
        tone: worstUsageTone(windows.map((window) => window.tone)),
      },
    ];
  });
}
