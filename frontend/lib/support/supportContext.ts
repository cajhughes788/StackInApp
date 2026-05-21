"use client"

import { Capacitor } from "@capacitor/core"

import type { WorkspaceSummary } from "@shared/contracts/workspace"
import { getRecentSupportLogs } from "@/lib/support/supportLogBuffer"

export type SupportKind =
  | "problem"
  | "question"
  | "feedback"
  | "help"

export type SupportContext = {
  route: string
  workspaceId: string | null
  workspaceType: string | null
  workspaceName: string | null
  deviceType: string
  platform: string
  buildId: string | null
  userAgent: string
  capturedAt: string
  recentLogs: ReturnType<typeof getRecentSupportLogs>
}

function detectDeviceType(): string {
  if (typeof window === "undefined") {
    return "unknown"
  }

  const width = window.innerWidth

  if (width < 640) return "phone"
  if (width < 1024) return "tablet"
  return "desktop"
}

function detectBuildId(): string | null {
  if (typeof window === "undefined") {
    return null
  }

  const nextData = (window as Window & {
    __NEXT_DATA__?: { buildId?: string }
  }).__NEXT_DATA__

  return nextData?.buildId ?? null
}

export function collectSupportContext(params: {
  route: string
  workspace: WorkspaceSummary | null
}): SupportContext {
  return {
    route: params.route,
    workspaceId: params.workspace?.id ?? null,
    workspaceType: params.workspace?.type ?? null,
    workspaceName: params.workspace?.name ?? null,
    deviceType: detectDeviceType(),
    platform: Capacitor.getPlatform(),
    buildId: detectBuildId(),
    userAgent:
      typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    capturedAt: new Date().toISOString(),
    recentLogs: getRecentSupportLogs(),
  }
}

export function buildSupportDraft(params: {
  kind: SupportKind
  message: string
  context: SupportContext
}): string {
  const titleMap: Record<SupportKind, string> = {
    help: "Need help",
    problem: "Report a problem",
    question: "Ask a question",
    feedback: "Send feedback",
  }

  const logLines =
    params.context.recentLogs.length > 0
      ? params.context.recentLogs.map((entry) =>
          JSON.stringify(entry)
        )
      : ["No recent client logs captured."]

  return [
    `${titleMap[params.kind]}`,
    "",
    "Tell us what happened:",
    params.message.trim() || "(No message entered)",
    "",
    "Context",
    `Route: ${params.context.route}`,
    `Workspace ID: ${params.context.workspaceId ?? "none"}`,
    `Workspace Type: ${params.context.workspaceType ?? "none"}`,
    `Workspace Name: ${params.context.workspaceName ?? "none"}`,
    `Device Type: ${params.context.deviceType}`,
    `Platform: ${params.context.platform}`,
    `Build ID: ${params.context.buildId ?? "unknown"}`,
    `Captured At: ${params.context.capturedAt}`,
    `User Agent: ${params.context.userAgent}`,
    "",
    "Recent Client Logs",
    ...logLines,
  ].join("\n")
}
