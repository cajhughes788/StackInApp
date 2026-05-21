"use client"

import { createContext, useContext } from "react"

export type AppBootstrapContextValue = {
  status: "auth-loading" | "workspace-loading" | "ready" | "no-user" | "no-workspace"
  canRenderCachedWorkspace: boolean
  contextReady: boolean
}

const AppBootstrapContext = createContext<AppBootstrapContextValue>({
  status: "auth-loading",
  canRenderCachedWorkspace: false,
  contextReady: false,
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
