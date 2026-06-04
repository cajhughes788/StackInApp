"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"

import type { AppBootstrapSnapshot } from "@shared/contracts/appBootstrap"
import {
  getSubscriptionCapabilities,
  type SubscriptionCapabilities,
  type SubscriptionDoc,
} from "@shared/contracts/subscription"
import type { WorkspaceType } from "@shared/contracts/workspace"

import { useAuth } from "@/contexts/auth-context"
import { API_ENDPOINTS, apiFetch } from "@/lib/api"

export type AccountAuthorityStatus = "idle" | "loading" | "ready" | "error"

export type AccountAuthority = {
  subscription: SubscriptionDoc | null
  subscriptionCapabilities: SubscriptionCapabilities | null
  isSubscriptionActive: boolean
  allowedWorkspaceTypes: WorkspaceType[]
  maxWorkspaces: number | "unlimited"
}

type AccountAuthorityResponse = {
  isActive?: boolean
  subscription?: SubscriptionDoc | null
  allowedWorkspaceTypes?: WorkspaceType[]
  maxWorkspaces?: number | "unlimited"
}

type AccountAuthorityContextValue = {
  status: AccountAuthorityStatus
  authority: AccountAuthority | null
  refreshAccountAuthority: (options?: { silent?: boolean }) => Promise<AccountAuthority | null>
  syncAccountAuthority: (authority: AccountAuthority | null) => void
}

export function buildAccountAuthorityFromSubscriptionResponse(
  response: AccountAuthorityResponse | null | undefined
): AccountAuthority {
  const subscription = response?.subscription ?? null
  const isSubscriptionActive = response?.isActive ?? false
  const subscriptionCapabilities =
    subscription && isSubscriptionActive
      ? getSubscriptionCapabilities(subscription)
      : null

  return {
    subscription,
    subscriptionCapabilities,
    isSubscriptionActive,
    allowedWorkspaceTypes: isSubscriptionActive
      ? Array.isArray(response?.allowedWorkspaceTypes) && response.allowedWorkspaceTypes.length > 0
        ? response.allowedWorkspaceTypes
        : subscriptionCapabilities?.allowedWorkspaceTypes ?? []
      : [],
    maxWorkspaces: isSubscriptionActive
      ? response?.maxWorkspaces ?? subscriptionCapabilities?.maxWorkspaces ?? 0
      : 0,
  }
}

export function buildAccountAuthorityFromBootstrapSnapshot(
  snapshot: Pick<
    AppBootstrapSnapshot,
    "subscription" | "subscriptionCapabilities" | "isSubscriptionActive"
  >
): AccountAuthority {
  return {
    subscription: snapshot.subscription,
    subscriptionCapabilities: snapshot.isSubscriptionActive
      ? snapshot.subscriptionCapabilities
      : null,
    isSubscriptionActive: snapshot.isSubscriptionActive,
    allowedWorkspaceTypes: snapshot.isSubscriptionActive
      ? snapshot.subscriptionCapabilities?.allowedWorkspaceTypes ?? []
      : [],
    maxWorkspaces: snapshot.isSubscriptionActive
      ? snapshot.subscriptionCapabilities?.maxWorkspaces ?? 0
      : 0,
  }
}

const AccountAuthorityContext = createContext<AccountAuthorityContextValue>({
  status: "idle",
  authority: null,
  refreshAccountAuthority: async () => null,
  syncAccountAuthority: () => {},
})

export function AccountAuthorityProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { user, authLoading } = useAuth()
  const [status, setStatus] = useState<AccountAuthorityStatus>("idle")
  const [authority, setAuthority] = useState<AccountAuthority | null>(null)
  const requestIdRef = useRef(0)

  const syncAccountAuthority = useCallback((nextAuthority: AccountAuthority | null) => {
    requestIdRef.current += 1
    setAuthority(nextAuthority)
    setStatus(nextAuthority ? "ready" : "idle")
  }, [])

  const refreshAccountAuthority = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!user) {
        syncAccountAuthority(null)
        return null
      }

      if (!options.silent || status === "idle") {
        setStatus("loading")
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      try {
        const response = await apiFetch<AccountAuthorityResponse>(API_ENDPOINTS.subscription.get)
        const nextAuthority = buildAccountAuthorityFromSubscriptionResponse(response)

        if (requestIdRef.current === requestId) {
          setAuthority(nextAuthority)
          setStatus("ready")
        }

        return nextAuthority
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setStatus("error")
        }
        throw error
      }
    },
    [status, syncAccountAuthority, user]
  )

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      syncAccountAuthority(null)
    }
  }, [authLoading, syncAccountAuthority, user])

  useEffect(() => {
    if (authLoading || !user) {
      return
    }

    if (!pathname?.startsWith("/welcome")) {
      return
    }

    if (status !== "idle" || authority !== null) {
      return
    }

    void refreshAccountAuthority()
  }, [authority, authLoading, pathname, refreshAccountAuthority, status, user])

  const value = useMemo(
    () => ({
      status,
      authority,
      refreshAccountAuthority,
      syncAccountAuthority,
    }),
    [authority, refreshAccountAuthority, status, syncAccountAuthority]
  )

  return (
    <AccountAuthorityContext.Provider value={value}>
      {children}
    </AccountAuthorityContext.Provider>
  )
}

export function useAccountAuthorityState() {
  return useContext(AccountAuthorityContext)
}
