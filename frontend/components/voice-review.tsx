"use client"

// After voice fills a form, the form itself is the review: a small "Review"
// label at the top, and at the very bottom what was heard (with Undo), one
// voice button, then the form's own single save button. The voice button
// asks for what's still missing ("Say the client's email or phone") when
// something is, and is "Fix by voice" otherwise.

import type { ReactNode } from "react"
import { Mic } from "lucide-react"

import { Button } from "@/components/ui/button"

/** What a form still needs, asked as the voice button's label. */
export type VoiceAsk = {
  label: string
  // What the next recording should fill ("email", "service"), sent with the fix.
  asking: string[]
}

/** Joins "a", "b", "c" as "a, b and c". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ""
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

export function VoiceReviewLabel({ id }: { id?: string }) {
  return (
    <p id={id} className="scroll-mt-24 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Review
    </p>
  )
}

export function VoiceReviewFooter({
  heard,
  ask,
  onVoice,
  onUndo,
  disabled,
  children,
}: {
  heard: string
  ask: VoiceAsk | null
  onVoice: () => void
  onUndo: () => void
  disabled?: boolean
  // Open questions and notes, shown just above the voice button.
  children?: ReactNode
}) {
  return (
    <div className="space-y-3">
      {children}
      {heard ? (
        <div className="flex items-start gap-2 px-1">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">Heard: &ldquo;{heard}&rdquo;</p>
          <button
            type="button"
            onClick={onUndo}
            disabled={disabled}
            className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Undo
          </button>
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={onVoice}
        disabled={disabled}
        className="h-auto min-h-11 w-full whitespace-normal rounded-2xl py-2.5 text-base"
      >
        <Mic className="shrink-0" /> {ask ? ask.label : "Fix by voice"}
      </Button>
    </div>
  )
}

/** Scrolls so the review starts at the top of the screen. */
export function scrollToVoiceReview(id: string) {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80)
}
