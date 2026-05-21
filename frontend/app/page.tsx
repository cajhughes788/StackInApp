"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import AppLoader from "@/components/app-loader"
import { useAuth } from "@/contexts/auth-context"

export default function RootPage() {
  const router = useRouter()

  const { user, authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      router.replace("/login")
      return
    }

    router.replace("/app")
  }, [authLoading, user, router])

  return <AppLoader label="Loading StackIn..." />
}
