"use client"

import { createContext, useContext } from "react"

import type { AppBootstrapSnapshot } from "@shared/contracts/appBootstrap"
import type { WorkspaceType } from "@shared/contracts/workspace"

export type BootstrapAuthorityStatus = "idle" | "loading" | "ready" | "error"

export type BootstrapAuthority = {
  workspaceId: string
  membershipRole: AppBootstrapSnapshot["membershipRole"]
  workspaceCapabilities: AppBootstrapSnapshot["workspaceCapabilities"]
  subscription: AppBootstrapSnapshot["subscription"]
  subscriptionCapabilities: AppBootstrapSnapshot["subscriptionCapabilities"]
  isSubscriptionActive: boolean
  allowedWorkspaceTypes: WorkspaceType[]
  maxWorkspaces: number | "unlimited"
}

export type AppBootstrapContextValue = {
  status: "auth-loading" | "workspace-loading" | "ready" | "no-user" | "no-workspace"
  canRenderCachedWorkspace: boolean
  contextReady: boolean
  authorityStatus: BootstrapAuthorityStatus
  authority: BootstrapAuthority | null
  refreshAuthority: () => Promise<void>
}

const AppBootstrapContext = createContext<AppBootstrapContextValue>({
  status: "auth-loading",
  canRenderCachedWorkspace: false,
  contextReady: false,
  authorityStatus: "idle",
  authority: null,
  refreshAuthority: async () => {},
})

export function AppBootstrapProvider({
  value,
  children,
}: {
  value: AppBootstrapContextValue
  children: React.ReactNode
}) {
  return (
    <AppBootstrapContext.Provider value={value}>
      {children}
    </AppBootstrapContext.Provider>
  )
}

export function useAppBootstrapState() {
  return useContext(AppBootstrapContext)
}
