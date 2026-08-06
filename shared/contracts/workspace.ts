// shared/contracts/workspace.ts

/**
 * Opaque workspace identifier.
 * Never assume semantics from the ID itself.
 */
export type WorkspaceId = string

/**
 * Root workspace type discriminator.
 * Domain loading and app behavior branch from this.
 */
export type WorkspaceType = "w2" | "independent"

/**
 * Workspace lifecycle status.
 * Allows soft-archival without data loss.
 */
export type WorkspaceStatus = "active" | "archived"

/**
 * Firestore representation of a workspace.
 *
 * Stored at:
 *   /workspaces/{workspaceId}
 *
 * NOTE:
 * - Workspaces do NOT live under users.
 * - Ownership and access are modeled explicitly.
 */
export interface WorkspaceDoc {
  id: WorkspaceId
  ownerId: string

  type: WorkspaceType
  name: string

  status: WorkspaceStatus

  createdAt: number
  updatedAt: number

  /**
   * Embedded settings snapshot written on every settings save.
   * Allows bootstrap to skip the separate settings subcollection read
   * when the snapshot is fresh (< 10 min). Optional — absent on
   * workspaces that have never saved settings.
   */
  settingsSnapshot?: {
    data: unknown
    version: number
    at: number // Date.now() at write time
  }
}

/**
 * Minimal workspace metadata used for:
 * - Workspace switchers
 * - Headers
 * - Navigation
 *
 * This intentionally avoids loading heavy subcollections
 * (settings, entries, paystubs).
 */
export interface WorkspaceSummary {
  id: WorkspaceId
  type: WorkspaceType
  name: string
  status: WorkspaceStatus
  createdAt: number
}

/**
 * Relationship between a user and a workspace.
 *
 * Stored at:
 *   /users/{uid}/memberships/{workspaceId}
 *
 * This enables:
 * - Multiple users per workspace
 * - Future roles (accountant, viewer, etc.)
 * - Clean security rules
 */
export interface WorkspaceMembership {
  workspaceId: WorkspaceId
  role: "owner" | "admin" | "member"

  joinedAt: number
}

/**
 * Type guards for workspace mode.
 * Useful for UI branching and feature gating.
 */
export function isW2Workspace(
  workspace: Pick<WorkspaceDoc, "type">
): boolean {
  return workspace.type === "w2"
}

export function isIndependentWorkspace(
  workspace: Pick<WorkspaceDoc, "type">
): boolean {
  return workspace.type === "independent"
}
