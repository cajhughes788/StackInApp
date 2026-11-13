"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { useGuideStore } from "@/lib/stores/useGuideStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

// How long the "you can take it from the menu" line stays after Skip.
const SKIP_NOTE_MS = 5000

// "Take a quick tour?" — shown at the top of Home after first-time setup
// (useGuideStore's homeTourOffer). "Show me" starts the Home tour; "Skip"
// closes the card and says where the tour lives. Held in memory only, so it
// stays until answered and is gone once the app is closed.
export default function HomeTourOffer({ className }: { className?: string }) {
  const offer = useGuideStore((s) => s.homeTourOffer)
  const clearOffer = useGuideStore((s) => s.clearHomeTourOffer)
  const requestHomeTour = useGuideStore((s) => s.requestHomeTour)
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const [showSkipNote, setShowSkipNote] = useState(false)

  // An offer for a different workspace than the one showing is stale.
  useEffect(() => {
    if (offer && activeWorkspaceId && offer.workspaceId !== activeWorkspaceId) clearOffer()
  }, [offer, activeWorkspaceId, clearOffer])

  useEffect(() => {
    if (!showSkipNote) return
    const timer = window.setTimeout(() => setShowSkipNote(false), SKIP_NOTE_MS)
    return () => window.clearTimeout(timer)
  }, [showSkipNote])

  if (showSkipNote) {
    return (
      <p className={`px-1 text-sm text-muted-foreground ${className ?? ""}`} role="status">
        You can take it anytime from the menu → Take the tour.
      </p>
    )
  }

  if (!offer || offer.workspaceId !== activeWorkspaceId) return null

  return (
    <section
      aria-labelledby="home-tour-offer-title"
      className={`rounded-[22px] border border-card-border bg-card px-5 py-4 ${className ?? ""}`}
    >
      <h2 id="home-tour-offer-title" className="font-semibold text-foreground">
        Take a quick tour?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">A one-minute look at where everything is.</p>
      <div className="mt-4 flex gap-3">
        <Button
          className="flex-1"
          onClick={() => {
            requestHomeTour(offer.workspaceId, offer.workspaceType)
            clearOffer()
          }}
        >
          Show me
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            clearOffer()
            setShowSkipNote(true)
          }}
        >
          Skip
        </Button>
      </div>
    </section>
  )
}
