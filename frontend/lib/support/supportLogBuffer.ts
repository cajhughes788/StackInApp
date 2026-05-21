"use client"

export type SupportLogLevel = "info" | "error"

export type SupportLogEntry = {
  ts: string
  level: SupportLogLevel
  source: string
  event: string
  payload?: Record<string, unknown>
}

const MAX_SUPPORT_LOGS = 40
const supportLogs: SupportLogEntry[] = []

export function recordSupportLog(entry: SupportLogEntry) {
  supportLogs.push(entry)

  if (supportLogs.length > MAX_SUPPORT_LOGS) {
    supportLogs.splice(0, supportLogs.length - MAX_SUPPORT_LOGS)
  }
}

export function getRecentSupportLogs(limit = 12): SupportLogEntry[] {
  return supportLogs.slice(-limit)
}
