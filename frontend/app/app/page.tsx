"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import AppLoader from "@/components/app-loader"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

export default function AppIndexPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((s) => s.state)

  useEffect(() => {
    if (authLoading) return
    if (!user || workspaceState.status !== "ready") return

    router.replace("/app/home")
  }, [authLoading, user, workspaceState.status, router])

  return <AppLoader label="Loading your dashboard..." />
}
