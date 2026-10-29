"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import AppLoader from "@/components/app-loader"
import { useAuth } from "@/contexts/auth-context"
import { useDeepLinkStore } from "@/lib/push/deepLinkStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

export default function AppIndexPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((s) => s.state)
  // A notification tap that launched the app: DeepLinkHandler takes it
  // there, so this page mustn't also send it Home (whichever ran last won,
  // often Home). Remembered, because the handler clears it as it goes.
  const deepLinkPending = useDeepLinkStore((s) => s.pending !== null)
  const followingDeepLink = useRef(false)
  if (deepLinkPending) followingDeepLink.current = true

  useEffect(() => {
    if (authLoading) return
    if (!user || workspaceState.status !== "ready") return
    if (deepLinkPending || followingDeepLink.current) return

    router.replace("/app/home")
  }, [authLoading, user, workspaceState.status, router, deepLinkPending])

  return <AppLoader label="Loading your dashboard..." />
}
