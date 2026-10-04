"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type GuestRun = Readonly<{
  score: number;
  completedAt: string;
}>;

type GuestScoreStore = Readonly<{
  runs: readonly GuestRun[];
  addRun: (run: GuestRun) => void;
  clear: () => void;
}>;

const GuestScoreContext = createContext<GuestScoreStore | null>(null);

/**
 * Deliberately memory-only: no cookie, localStorage, IndexedDB, or network
 * write is used for guest scores. Reloading or closing the page clears them.
 */
export function GuestScoreProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [runs, setRuns] = useState<readonly GuestRun[]>([]);
  const addRun = useCallback((run: GuestRun) => {
    if (!Number.isSafeInteger(run.score) || run.score < 0 || !Number.isFinite(Date.parse(run.completedAt))) return;
    setRuns((current) => [...current, run]);
  }, []);
  const clear = useCallback(() => { setRuns([]); }, []);
  const value = useMemo(() => ({ runs, addRun, clear }), [addRun, clear, runs]);
  return <GuestScoreContext.Provider value={value}>{children}</GuestScoreContext.Provider>;
}

export function useGuestScores(): GuestScoreStore {
  const store = useContext(GuestScoreContext);
  if (!store) throw new Error("Guest score store is unavailable.");
  return store;
}
