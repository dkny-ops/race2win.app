export const WEEKLY_PRIZE_CENTS_BY_RANK = [0, 500, 300, 200] as const;

export function weeklyPrizeCentsForRank(rank: number | null): number | null {
  return rank !== null && Number.isInteger(rank) && rank >= 1 && rank <= 3
    ? WEEKLY_PRIZE_CENTS_BY_RANK[rank]
    : null;
}

export function weeklyPrizeLabelForRank(rank: number | null): string {
  const cents = weeklyPrizeCentsForRank(rank);
  return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
}
