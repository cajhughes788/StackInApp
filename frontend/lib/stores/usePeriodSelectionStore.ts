"use client";

import { create } from "zustand";

import type { WorkspaceId } from "@shared/contracts/workspace";

export type SelectedPeriod = {
  periodId: string;
  start: string;
  end: string;
};

type PeriodSelectionState = {
  byWorkspaceId: Record<WorkspaceId, SelectedPeriod | null>;
  setSelectedPeriod: (workspaceId: WorkspaceId, period: SelectedPeriod | null) => void;
};

// null (the default) means "viewing the live/current period" — selecting a
// past period is opt-in per workspace and does not persist across reloads.
export const usePeriodSelectionStore = create<PeriodSelectionState>((set) => ({
  byWorkspaceId: {},
  setSelectedPeriod(workspaceId, period) {
    set((state) => ({
      byWorkspaceId: { ...state.byWorkspaceId, [workspaceId]: period },
    }));
  },
}));

export function useSelectedPeriod(workspaceId: WorkspaceId | null): SelectedPeriod | null {
  return usePeriodSelectionStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId] ?? null : null
  );
}
