// shared/contracts/capabilities.ts

import type { WorkspaceType } from "./workspace"

/**
 * Capabilities available within an ACTIVE workspace.
 * These govern UI and domain behavior.
 */
export interface WorkspaceCapabilities {
  w2: {
    enabled: boolean
    canGeneratePaystubs: boolean
  }

  independent: {
    enabled: boolean
    canGeneratePnL: boolean
  }
}

/**
 * Derive capabilities for the active workspace only.
 *
 * This is a PURE function.
 */
export function deriveWorkspaceCapabilities(
  workspaceType: WorkspaceType
): WorkspaceCapabilities {
  const base: WorkspaceCapabilities = {
    w2: {
      enabled: false,
      canGeneratePaystubs: false,
    },
    independent: {
      enabled: false,
      canGeneratePnL: false,
    },
  }

  if (workspaceType === "w2") {
    base.w2.enabled = true
    base.w2.canGeneratePaystubs = true
  }

  if (workspaceType === "independent") {
    base.independent.enabled = true
    base.independent.canGeneratePnL = true
  }

  return base
}
