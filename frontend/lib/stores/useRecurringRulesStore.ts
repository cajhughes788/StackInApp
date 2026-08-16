"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { WorkspaceId } from "@shared/contracts/workspace";

import { getAuthSessionVersion, isAuthSessionCurrent } from "@/lib/authSession";
import { debugError, debugLog } from "@/lib/debugLoop";
import * as domainRecurringRules from "@/lib/storage/domainRecurringRules";
import * as recurringRuleRepository from "@/lib/domain/recurringRuleRepository";

// This store is intentionally simpler than useExpensesStore/useEntriesStore:
// recurring rules aren't period-scoped (one list per workspace) and rule
// mutations are online-only (no optimistic/tempId reconciliation needed —
// see lib/domain/recurringRulesService.ts), so the elaborate resourceSync
// hydrating/revalidating machinery those stores need doesn't apply here.

type RecurringRule = any;

type RecurringRulesEntry = {
  rules: RecurringRule[];
  status: "idle" | "loading" | "ready" | "error";
  hasHydrated: boolean;
  lastSuccessfulSyncAt: number | null;
};

type RecurringRulesStoreState = {
  byWorkspaceId: Record<WorkspaceId, RecurringRulesEntry>;
  hydrateFromCacheOnce: (workspaceId: WorkspaceId) => Promise<void>;
  refreshFromBackend: (workspaceId: WorkspaceId) => Promise<void>;
  addRule: (workspaceId: WorkspaceId, rule: RecurringRule) => void;
  replaceRule: (workspaceId: WorkspaceId, ruleId: string, rule: RecurringRule) => void;
  removeRule: (workspaceId: WorkspaceId, ruleId: string) => void;
  clear: (workspaceId?: WorkspaceId) => Promise<void>;
};

const EMPTY_RULES: RecurringRule[] = [];

const getWorkspaceEntry = (
  byWorkspaceId: Record<WorkspaceId, RecurringRulesEntry>,
  workspaceId: WorkspaceId
): RecurringRulesEntry =>
  byWorkspaceId[workspaceId] ?? {
    rules: [],
    status: "idle",
    hasHydrated: false,
    lastSuccessfulSyncAt: null,
  };

export const useRecurringRulesStore = create<RecurringRulesStoreState>((set, get) => ({
  byWorkspaceId: {},

  async hydrateFromCacheOnce(workspaceId) {
    const current = getWorkspaceEntry(get().byWorkspaceId, workspaceId);
    if (current.hasHydrated) return;

    const sessionVersion = getAuthSessionVersion();
    set((state) => ({
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: { ...getWorkspaceEntry(state.byWorkspaceId, workspaceId), status: "loading" },
      },
    }));

    try {
      const cached = await recurringRuleRepository.readCachedSnapshot(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            rules: cached.data,
            status: "ready",
            hasHydrated: true,
            lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt,
          },
        },
      }));

      void get().refreshFromBackend(workspaceId);
    } catch (err) {
      debugError("recurring-rules-store", "hydrate_from_cache_failed", {
        workspaceId,
        message: err instanceof Error ? err.message : "Unknown recurring rules hydrate error",
      });
      if (!isAuthSessionCurrent(sessionVersion)) return;
      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            ...getWorkspaceEntry(state.byWorkspaceId, workspaceId),
            status: "error",
            hasHydrated: true,
          },
        },
      }));
    }
  },

  async refreshFromBackend(workspaceId) {
    const sessionVersion = getAuthSessionVersion();
    try {
      const resolved = await recurringRuleRepository.ensureLoaded(workspaceId);
      if (!isAuthSessionCurrent(sessionVersion)) return;

      set((state) => ({
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: {
            rules: resolved.data,
            status: "ready",
            hasHydrated: true,
            lastSuccessfulSyncAt: resolved.lastSuccessfulSyncAt,
          },
        },
      }));
    } catch (err) {
      debugLog("recurring-rules-store", "refresh_from_backend_failed", {
        workspaceId,
        message: err instanceof Error ? err.message : "Unknown recurring rules refresh error",
      });
      // Leave cached data in place — offline viewing still works.
    }
  },

  addRule(workspaceId, rule) {
    set((state) => {
      const current = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const nextRules = [rule, ...current.rules.filter((r) => r.id !== rule.id)];
      void domainRecurringRules.setRecurringRulesForWorkspace(workspaceId, nextRules, {
        lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
      });
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...current, rules: nextRules, status: "ready", hasHydrated: true },
        },
      };
    });
  },

  replaceRule(workspaceId, ruleId, rule) {
    set((state) => {
      const current = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const nextRules = current.rules.map((r) => (r.id === ruleId ? rule : r));
      void domainRecurringRules.setRecurringRulesForWorkspace(workspaceId, nextRules, {
        lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
      });
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...current, rules: nextRules, status: "ready" },
        },
      };
    });
  },

  removeRule(workspaceId, ruleId) {
    set((state) => {
      const current = getWorkspaceEntry(state.byWorkspaceId, workspaceId);
      const nextRules = current.rules.filter((r) => r.id !== ruleId);
      void domainRecurringRules.setRecurringRulesForWorkspace(workspaceId, nextRules, {
        lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
      });
      return {
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...current, rules: nextRules, status: "ready" },
        },
      };
    });
  },

  async clear(workspaceId) {
    if (!workspaceId) {
      try {
        await domainRecurringRules.clearAll();
      } catch {}
      set({ byWorkspaceId: {} });
      return;
    }
    try {
      await domainRecurringRules.clearWorkspace(workspaceId);
    } catch {}
    set((state) => {
      const copy = { ...state.byWorkspaceId };
      delete copy[workspaceId];
      return { byWorkspaceId: copy };
    });
  },
}));

export function useRecurringRulesData(workspaceId: WorkspaceId | null): RecurringRule[] {
  return useRecurringRulesStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId]?.rules ?? EMPTY_RULES : EMPTY_RULES
  );
}

export function useRecurringRulesRenderState(workspaceId: WorkspaceId | null) {
  return useRecurringRulesStore(
    useShallow((state) => {
      const entry = workspaceId ? state.byWorkspaceId[workspaceId] : undefined;
      return {
        status: entry?.status ?? "idle",
        hasHydrated: entry?.hasHydrated ?? false,
      };
    })
  );
}
