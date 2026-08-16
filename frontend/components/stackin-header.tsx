// /components/stackin-header.tsx

"use client"

import { useState, useEffect, useCallback, startTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Menu } from "lucide-react"
import SupportDialog from "@/components/support/support-dialog"
import WorkspaceSwitcher from "@/components/workspace-switcher"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useToast } from "@/hooks/use-toast"
import { prefetchRouteData } from "@/lib/prefetch/routeData"

export default function StackInHeader() {
  const router = useRouter()
  const { toast } = useToast()
  const [hidden, setHidden] = useState(false)
  const [lastScrollY, setLastScrollY] = useState(0)
  const [supportOpen, setSupportOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const navigationGuard = useNavigationGuardStore((s) => s.guard)
  const activeWorkspace =
    workspaceState.status === "ready" ? workspaceState.activeWorkspace : null
  const activeWorkspaceId =
    workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const isWorkspaceSetupMode =
    pathname === "/app/settings" && searchParams.get("setup") === "1"

  const handleScroll = useCallback(() => {
    const currentY = window.scrollY
    setHidden(currentY > lastScrollY && currentY > 60)
    setLastScrollY(currentY)
  }, [lastScrollY])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  const menuItems = [
    { label: "Home", href: "/app/home" },
    { label: "Settings", href: "/app/settings" },
    activeWorkspace?.type === "independent"
      ? { label: "Profit & Loss", href: "/app/profitloss" }
      : { label: "Earnings", href: "/app/earnings" },
    ...(activeWorkspace?.type === "independent"
      ? [
          { label: "Receipts", href: "/app/receipts" },
          {
            label: "Expense Category Guide",
            href: "/app/expense-category-guide",
          },
        ]
      : []),
    { label: "Account", href: "/app/account" },
  ]

  const visibleItems = menuItems.filter((item) => item.href !== pathname)

  const prefetchMenuItem = useCallback(
    (href: string) => {
      router.prefetch(href)
      prefetchRouteData(href, activeWorkspaceId, activeWorkspace?.type ?? null)
    },
    [activeWorkspace?.type, activeWorkspaceId, router]
  )

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const likelyDocumentRoute = visibleItems.find(
      (item) => item.href === "/app/earnings" || item.href === "/app/profitloss"
    )

    if (likelyDocumentRoute) {
      prefetchMenuItem(likelyDocumentRoute.href)
    }
  }, [menuOpen, prefetchMenuItem, visibleItems])

  const navigateWithPendingSaveGuard = useCallback(
    async (href: string) => {
      if (navigationGuard?.mode === "block") {
        const flushed = await navigationGuard.flush()
        if (!flushed) {
          toast({
            title: "Unable to leave settings",
            description:
              navigationGuard.reason ??
              "Finish resolving your settings changes before navigating away.",
            variant: "destructive",
          })
          return
        }
      }

      if (navigationGuard?.mode === "background") {
        void navigationGuard.flush()
      }

      startTransition(() => {
        router.push(href)
      })
    },
    [navigationGuard, router, toast]
  )

  return (
    <>
      <header
        className={`stackin-safe-header fixed top-0 left-0 w-full z-[var(--stackin-z-header)] transition-transform duration-300 ${
          hidden ? "-translate-y-full" : "translate-y-0"
        } border-b border-border shadow-sm`}
      >
        <div className="stackin-safe-header-status-bar" aria-hidden="true" />

        <div className="stackin-safe-header-nav flex items-center justify-between">
          {/* LEFT SIDE — Workspace Switcher */}
          <div className="flex min-w-0 items-center gap-2">
            {isWorkspaceSetupMode ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-sm font-medium text-primary shadow-sm">
                <span>{activeWorkspace?.name ?? "Workspace setup"}</span>
                <span className="text-xs text-primary/80">
                  ({activeWorkspace?.type === "w2" ? "W-2" : "Independent"})
                </span>
              </div>
            ) : (
              <WorkspaceSwitcher />
            )}
          </div>

          {/* RIGHT SIDE — Menu */}
          <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="cursor-pointer rounded-md p-2 text-foreground transition hover:bg-accent focus:ring-2 focus:ring-primary/40">
                  <Menu className="h-5 w-5" />
                </div>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                className="z-[2000] mt-2 w-44 border border-border bg-card text-card-foreground shadow-lg"
              >
                {visibleItems.map((item) => (
                  <DropdownMenuItem
                    key={item.href}
                    className="cursor-pointer hover:bg-accent"
                    onFocus={() => prefetchMenuItem(item.href)}
                    onPointerEnter={() => prefetchMenuItem(item.href)}
                    onClick={() => void navigateWithPendingSaveGuard(item.href)}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => setSupportOpen(true)}
                >
                  Need Help?
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </header>

      <div className="stackin-safe-header-spacer" />

      <SupportDialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        route={pathname}
        workspace={activeWorkspace}
      />
    </>
  )
}
