// /components/stackin-header.tsx

"use client"

import { useState, useEffect, useCallback, startTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  BookOpen,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  Compass,
  House,
  Landmark,
  LifeBuoy,
  Menu,
  Receipt,
  FileText,
  Users,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react"
import SupportDialog from "@/components/support/support-dialog"
import WorkspaceSwitcher from "@/components/workspace-switcher"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore"
import { useGuideStore } from "@/lib/stores/useGuideStore"
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
  const requestHomeTour = useGuideStore((s) => s.requestHomeTour)
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

  type MenuItem = { label: string; href: string; icon: LucideIcon }
  const moneyItems: MenuItem[] = [
    { label: "Home", href: "/app/home", icon: House },
    activeWorkspace?.type === "independent"
      ? { label: "Profit & Loss", href: "/app/profitloss", icon: ChartNoAxesColumnIncreasing }
      : { label: "Earnings", href: "/app/earnings", icon: ChartNoAxesColumnIncreasing },
    ...(activeWorkspace?.type === "independent"
      ? [
          { label: "Invoices", href: "/app/invoices", icon: FileText },
          { label: "Clients", href: "/app/clients", icon: Users },
          { label: "Booking", href: "/app/booking", icon: CalendarClock },
          { label: "Receipts", href: "/app/receipts", icon: Receipt },
        ]
      : []),
  ]
  const setupItems: MenuItem[] = [
    ...(activeWorkspace?.type === "independent"
      ? [{ label: "Bank connections", href: "/app/banks", icon: Landmark }]
      : []),
    { label: "Settings", href: "/app/settings", icon: Settings },
    { label: "Account", href: "/app/account", icon: UserRound },
  ]
  const helpItems: MenuItem[] =
    activeWorkspace?.type === "independent"
      ? [{ label: "Expense category guide", href: "/app/expense-category-guide", icon: BookOpen }]
      : []
  const menuItems = [...moneyItems, ...setupItems, ...helpItems]

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
              <div className="flex items-center gap-2 rounded-full border border-card-border bg-card px-3 py-1.5 text-sm font-medium text-foreground">
                <span>{activeWorkspace?.name ?? "Workspace setup"}</span>
                <span className="text-xs text-muted-foreground">
                  {activeWorkspace?.type === "w2" ? "W-2" : "Self-employed"}
                </span>
              </div>
            ) : (
              <WorkspaceSwitcher />
            )}
          </div>

          {/* RIGHT SIDE — Menu */}
          <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  data-tour="menu"
                  className="flex size-9 items-center justify-center rounded-full border border-card-border bg-card text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                className="z-[2000] mt-2 w-60 rounded-2xl border border-card-border bg-popover p-1.5 text-popover-foreground shadow-lg"
              >
                {([["Money", moneyItems], ["Setup", setupItems]] as const).map(([group, items], groupIndex) => (
                  <div key={group}>
                    {groupIndex > 0 ? <DropdownMenuSeparator className="my-1.5" /> : null}
                    <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{group}</DropdownMenuLabel>
                    {items.map((item) => {
                      const isCurrent = item.href === pathname
                      return (
                        <DropdownMenuItem
                          key={item.href}
                          aria-current={isCurrent ? "page" : undefined}
                          className={`cursor-pointer gap-3 rounded-xl px-2.5 py-2 text-sm ${
                            isCurrent ? "bg-primary/15 font-medium text-primary focus:bg-primary/15 focus:text-primary" : ""
                          }`}
                          onFocus={() => prefetchMenuItem(item.href)}
                          onPointerEnter={() => prefetchMenuItem(item.href)}
                          onClick={() => {
                            if (!isCurrent) void navigateWithPendingSaveGuard(item.href)
                          }}
                        >
                          <item.icon className={`size-4 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                          {item.label}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                ))}
                <DropdownMenuSeparator className="my-1.5" />
                {helpItems.map((item) => {
                  const isCurrent = item.href === pathname
                  return (
                    <DropdownMenuItem
                      key={item.href}
                      aria-current={isCurrent ? "page" : undefined}
                      className={`cursor-pointer gap-3 rounded-xl px-2.5 py-2 text-sm ${
                        isCurrent ? "bg-primary/15 font-medium text-primary focus:bg-primary/15 focus:text-primary" : ""
                      }`}
                      onFocus={() => prefetchMenuItem(item.href)}
                      onPointerEnter={() => prefetchMenuItem(item.href)}
                      onClick={() => {
                        if (!isCurrent) void navigateWithPendingSaveGuard(item.href)
                      }}
                    >
                      <item.icon className={`size-4 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                      {item.label}
                    </DropdownMenuItem>
                  )
                })}
                {activeWorkspace ? (
                  <DropdownMenuItem
                    className="cursor-pointer gap-3 rounded-xl px-2.5 py-2 text-sm"
                    onClick={() => {
                      requestHomeTour(activeWorkspace.id, activeWorkspace.type)
                      if (pathname !== "/app/home") void navigateWithPendingSaveGuard("/app/home")
                    }}
                  >
                    <Compass className="size-4 text-muted-foreground" aria-hidden="true" />
                    Take the tour
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  className="cursor-pointer gap-3 rounded-xl px-2.5 py-2 text-sm"
                  onClick={() => setSupportOpen(true)}
                >
                  <LifeBuoy className="size-4 text-muted-foreground" aria-hidden="true" />
                  Need help?
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
