"use client"

import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { WorkspaceType } from "@shared/contracts/workspace"

// First-time Settings guide: an intro dialog when setup opens, and a short
// numbered hint on each card that matters most for the workspace type. Both
// show only during first-time setup (settings/page.tsx's isInitialSettingsSetup).
// The step numbers here match the hints' `step` props in W2Settings.tsx and
// IndependentSettings.tsx.
//
// Colours match the Home tour (home-tour.tsx) through the --guide-* tokens in
// globals.css: a slate card outlined in green in light mode, an off-white card
// in dark mode, so the guide never reads as one of the page's own cards.

const KEY_SECTIONS: Record<WorkspaceType, { title: string; why: string }[]> = {
  independent: [
    { title: "Monthly targets", why: "Your income goal, so Home can show your progress." },
    { title: "Income sources", why: "Turn on the apps and methods you get paid through." },
    { title: "Invoices", why: "Your business details, if you bill clients." },
  ],
  w2: [
    { title: "Pay period goal", why: "Optional: what you want to earn each pay period." },
    { title: "Hourly income", why: "Your rate, if you're paid by the hour." },
    { title: "Pay schedule", why: "How often you're paid, so totals match your paychecks." },
  ],
}

export function SettingsIntroDialog({
  open,
  onDone,
  workspaceType,
  workspaceName,
  isFirstWorkspace,
}: {
  open: boolean
  onDone: () => void
  workspaceType: WorkspaceType
  workspaceName: string
  isFirstWorkspace: boolean
}) {
  const [screen, setScreen] = useState<0 | 1>(0)
  const sections = KEY_SECTIONS[workspaceType]

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onDone() : undefined)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md space-y-5 rounded-[22px] border-2 border-[var(--guide-border)] bg-[var(--guide-bg)] text-[var(--guide-fg)] p-6">
        {screen === 0 ? (
          <>
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-2xl font-semibold">
                {isFirstWorkspace ? "Welcome to 521" : `Set up ${workspaceName}`}
              </DialogTitle>
              <DialogDescription className="text-base text-[var(--guide-muted)]">
                Two quick steps and you&rsquo;re tracking.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3">
              <GuideStep number={1} title="Set up how you earn" body="Fill in a few settings on this page." />
              <GuideStep number={2} title="Head to Home" body="We'll show you around once you save." muted />
            </ol>
          </>
        ) : (
          <>
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-2xl font-semibold">Start with these</DialogTitle>
              <DialogDescription className="text-base text-[var(--guide-muted)]">
                Look for the numbered cards. Everything else is optional and can be changed anytime.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3">
              {sections.map((section, index) => (
                <GuideStep key={section.title} number={index + 1} title={section.title} body={section.why} />
              ))}
            </ol>
          </>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex gap-1.5" aria-hidden="true">
            {[0, 1].map((dot) => (
              <span
                key={dot}
                className={cn("h-1.5 rounded-full transition-all", dot === screen ? "w-5 bg-primary" : "w-1.5 bg-[var(--guide-control)]")}
              />
            ))}
          </div>
          {screen === 0 ? (
            <Button className="rounded-full px-6" onClick={() => setScreen(1)}>
              Next
            </Button>
          ) : (
            <Button className="rounded-full px-6" onClick={onDone}>
              Let&rsquo;s go
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GuideStep({ number, title, body, muted = false }: { number: number; title: string; body: string; muted?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-[var(--guide-subtle)] p-3">
      <StepBadge number={number} muted={muted} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-[var(--guide-muted)]">{body}</p>
      </div>
    </li>
  )
}

function StepBadge({ number, muted = false }: { number: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        muted
          ? "bg-[var(--guide-control)] text-[var(--guide-fg)]"
          : "bg-primary text-primary-foreground"
      )}
    >
      {number}
    </span>
  )
}

/** Numbered hint under a key Settings card's title, shown only during first-time setup. */
export function SetupHint({ show, step, children }: { show: boolean; step: number; children: ReactNode }) {
  if (!show) return null
  return (
    <div className="mt-2 flex items-start gap-2.5 rounded-xl border-2 border-[var(--guide-border)] bg-[var(--guide-bg)] text-[var(--guide-fg)] px-3 py-2 text-sm">
      <StepBadge number={step} />
      <p className="pt-0.5">{children}</p>
    </div>
  )
}
