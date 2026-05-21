"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import AppLoader from "@/components/app-loader"
import StackInHeader from "@/components/stackin-header"
import ReceiptsLibrary from "@/components/receipts-library"
import { useAuth } from "@/contexts/auth-context"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

export default function ReceiptsPage() {
  const router = useRouter()
  const { user, authLoading } = useAuth()
  const workspaceState = useWorkspaceStore((state) => state.state)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }
    if (workspaceState.status === "ready" && activeWorkspace?.type !== "independent") {
      router.replace("/app/home")
    }
  }, [activeWorkspace?.type, authLoading, router, user, workspaceState.status])

  if (authLoading || workspaceState.status !== "ready") {
    return <AppLoader label="Loading receipts..."/>
  }

  if (!user || activeWorkspace?.type !== "independent") {
    return null
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StackInHeader />
      <main className="flex-1 px-4 pb-6 pt-4 max-w-4xl mx-auto w-full">
        <ReceiptsLibrary />
      </main>
    </div>
  )
}
