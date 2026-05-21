"use client"

import { useEffect, useMemo, useState } from "react"
import { MessageCircleQuestion, Bug, HelpCircle, Lightbulb } from "lucide-react"

import type { WorkspaceSummary } from "@shared/contracts/workspace"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { submitSupportReport } from "@/lib/api/supportApi"
import { ApiError } from "@/lib/api/core/errors"
import {
  collectSupportContext,
  type SupportKind,
} from "@/lib/support/supportContext"

const supportOptions: Array<{
  kind: SupportKind
  label: string
  prompt: string
  icon: typeof HelpCircle
}> = [
  {
    kind: "help",
    label: "Need help?",
    prompt: "Tell us what you were trying to do.",
    icon: HelpCircle,
  },
  {
    kind: "problem",
    label: "Report a problem",
    prompt: "Tell us what happened and what you expected instead.",
    icon: Bug,
  },
  {
    kind: "question",
    label: "Ask a question",
    prompt: "Tell us what you want to know.",
    icon: MessageCircleQuestion,
  },
  {
    kind: "feedback",
    label: "Send feedback",
    prompt: "Tell us what would make this feel better to use.",
    icon: Lightbulb,
  },
]

export default function SupportDialog({
  open,
  onOpenChange,
  route,
  workspace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  route: string
  workspace: WorkspaceSummary | null
}) {
  const [selectedKind, setSelectedKind] = useState<SupportKind>("help")
  const [message, setMessage] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState<"form" | "success">("form")
  const { toast } = useToast()

  const context = useMemo(
    () => collectSupportContext({ route, workspace }),
    [route, workspace]
  )

  useEffect(() => {
    if (open) {
      return
    }

    const resetPointerEvents = () => {
      if (typeof document !== "undefined") {
        document.body.style.pointerEvents = ""
      }
    }

    resetPointerEvents()
    const immediateTimer = window.setTimeout(resetPointerEvents, 0)
    const shortDelayTimer = window.setTimeout(resetPointerEvents, 100)
    const delayedTimer = window.setTimeout(resetPointerEvents, 250)
    const longDelayTimer = window.setTimeout(resetPointerEvents, 1000)

    return () => {
      window.clearTimeout(immediateTimer)
      window.clearTimeout(shortDelayTimer)
      window.clearTimeout(delayedTimer)
      window.clearTimeout(longDelayTimer)
    }
  }, [open])

  const selectedOption =
    supportOptions.find((option) => option.kind === selectedKind) ??
    supportOptions[0]

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setMessage("")
      setSelectedKind("help")
      setIsSending(false)
      setStatus("form")
    }

    onOpenChange(nextOpen)
  }

  async function sendReport() {
    const trimmedMessage = message.trim()

    if (!trimmedMessage) {
      toast({
        title: "Add a short message",
        description: "Tell us what happened before sending.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsSending(true)
      await submitSupportReport({
        kind: selectedKind,
        message: trimmedMessage,
        context,
      })
      setStatus("success")
    } catch (error) {
      toast({
        title: "Could not send",
        description:
          error instanceof ApiError && error.message
            ? error.message
            : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  function resetAndClose() {
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        {status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Message received</DialogTitle>
              <DialogDescription>Thanks. We got your report.</DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={resetAndClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Need help?</DialogTitle>
              <DialogDescription>Tell us what happened.</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {supportOptions.map((option) => {
                const Icon = option.icon

                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => setSelectedKind(option.kind)}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      selectedKind === option.kind
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="space-y-2">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={selectedOption.prompt}
                className="min-h-32"
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={resetAndClose}
                disabled={isSending}
              >
                Close
              </Button>
              <Button type="button" onClick={sendReport} disabled={isSending}>
                {isSending ? "Sending..." : "Send Report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
