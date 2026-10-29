"use client"

// lib/domain/backgroundSave.ts
// Saves that don't make the user wait, outside invoices (invoiceService.ts
// does the same for invoices). The screen shows the change at once; the
// server call runs behind it:
//
// • Calls with the same key (one per appointment, client, …) run one after
//   another, so two quick changes reach the server in order.
// • The server's answer is applied only when nothing else is queued behind
//   it — the later change's optimistic state stays on screen meanwhile.
// • A failure puts things back (onFailed) and says so in a toast, with
//   "Try again" (or another action) when one is given.

import { createElement } from "react"
import { create } from "zustand"

import { ToastAction, type ToastActionElement } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"

const useSavingStore = create<{ byKey: Record<string, number>; adjust: (key: string, by: number) => void }>((set) => ({
  byKey: {},
  adjust(key, by) {
    set((state) => {
      const next = (state.byKey[key] ?? 0) + by
      const byKey = { ...state.byKey }
      if (next > 0) byKey[key] = next
      else delete byKey[key]
      return { byKey }
    })
  },
}))

/** Whether something with this key is still on its way to the server. */
export function useSaving(key: string | null): boolean {
  return useSavingStore((state) => (key ? (state.byKey[key] ?? 0) > 0 : false))
}

export function isSaving(key: string): boolean {
  return (useSavingStore.getState().byKey[key] ?? 0) > 0
}

// The tail of each key's queue; never rejects.
const queues = new Map<string, Promise<void>>()

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Check your connection and try again."
}

export function saveInBackground<T>(options: {
  key: string
  task: () => Promise<T>
  // The server's copy, when nothing newer is queued for this key.
  onSaved?: (result: T) => void
  // Put the screen back (or reload) after a failure.
  onFailed: (error: unknown) => void
  failTitle: string
  failAction?: { label: string; run: () => void }
}): void {
  const { key } = options
  const adjust = useSavingStore.getState().adjust
  adjust(key, 1)
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(() => options.task())
  const tail: Promise<void> = run
    .then(
      (result) => {
        if ((useSavingStore.getState().byKey[key] ?? 0) <= 1) options.onSaved?.(result)
      },
      (error) => {
        options.onFailed(error)
        const action = options.failAction
        toast({
          title: options.failTitle,
          description: errorMessage(error),
          variant: "destructive",
          // Long enough to read and tap "Try again" / "Fix it".
          duration: 12_000,
          ...(action
            ? {
                action: createElement(
                  ToastAction,
                  { altText: action.label, onClick: action.run },
                  action.label
                  // shadcn types the element by the component, which createElement can't express.
                ) as unknown as ToastActionElement,
              }
            : {}),
        })
      }
    )
    .catch(() => {})
    .then(() => {
      adjust(key, -1)
      if (queues.get(key) === tail) queues.delete(key)
    })
  queues.set(key, tail)
}
