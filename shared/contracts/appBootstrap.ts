import type { WorkspaceCapabilities } from "./capabilities"
import type { SubscriptionCapabilities, SubscriptionDoc } from "./subscription"
import type { WorkspaceMembership, WorkspaceSummary } from "./workspace"
import type { SettingsType } from "../schemas/settings"

export interface AppBootstrapSnapshot {
  workspace: WorkspaceSummary
  membershipRole: WorkspaceMembership["role"]
  settings: SettingsType | null
  workspaceCapabilities: WorkspaceCapabilities
  subscription: SubscriptionDoc | null
  subscriptionCapabilities: SubscriptionCapabilities | null
  isSubscriptionActive: boolean
}

export interface AppBootstrapResponse {
  ok: boolean
  snapshot: AppBootstrapSnapshot
}
