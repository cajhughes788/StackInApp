"use client";

import { shouldForegroundRefresh } from "./resourceSync";

export type ForegroundRefreshReason =
  | "initial"
  | "workspace-change"
  | "focus"
  | "visibility"
  | "app-active"
  | "resume";

export const WEB_FOREGROUND_REFRESH_MIN_AGE_MS = 60 * 1000;
export const NATIVE_FOREGROUND_REFRESH_MIN_AGE_MS = 20 * 1000;

export function getForegroundRefreshThresholdMs(
  reason: ForegroundRefreshReason
): number {
  switch (reason) {
    case "focus":
    case "visibility":
      return WEB_FOREGROUND_REFRESH_MIN_AGE_MS;
    case "app-active":
    case "resume":
      return NATIVE_FOREGROUND_REFRESH_MIN_AGE_MS;
    case "initial":
    case "workspace-change":
    default:
      return 0;
  }
}

export function shouldForceForegroundRefresh(
  reason: ForegroundRefreshReason
): boolean {
  return reason === "initial";
}

export function shouldRefreshForForegroundReason(
  timestamps: Array<number | null>,
  reason: ForegroundRefreshReason,
  now = Date.now()
): boolean {
  const thresholdMs = getForegroundRefreshThresholdMs(reason);
  if (thresholdMs === 0) {
    return true;
  }

  return timestamps.some((lastSuccessfulSyncAt) =>
    shouldForegroundRefresh(lastSuccessfulSyncAt, thresholdMs, now)
  );
}
