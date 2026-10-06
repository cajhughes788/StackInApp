"use client"

import { useEffect, useRef } from "react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import ReceiptCaptureField from "@/components/receipt-capture-field"
import { useReceiptCapture } from "@/hooks/use-receipt-capture"
import * as expensesService from "@/lib/domain/expenseService"
import { useToast } from "@/hooks/use-toast"

// Lets a receipt be attached to an EXISTING expense after the fact —
// regardless of whether it was created manually, via CSV/Venmo import, or
// confirmed from a Plaid bank transaction. Reuses the same capture/upload
// path as ExpenseForm and the Plaid pending-transactions panel.
//
// Optimistic close: the dialog dismisses itself the instant a photo capture
// actually starts (not once it's done), and the upload + attach-to-expense
// happen in the background — no "Save receipt" button to wait on. This
// relies on the caller (expenses-grid.tsx) always rendering this component,
// only toggling `open`, so the underlying useReceiptCapture hook (and this
// effect) keeps running after the visible modal disappears. A failure
// surfaces as a toast after the fact, since by then there's no dialog left
// to show an inline error in.
export default function AttachReceiptDialog({
  open,
  onOpenChange,
  workspaceId,
  expenseId,
  vendorLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  expenseId: string
  vendorLabel?: string | null
}) {
  const { toast } = useToast()
  const capture = useReceiptCapture(workspaceId)
  const wasUploadingRef = useRef(false)
  // Locks in which expense a capture belongs to at the moment it starts, so
  // reopening this dialog for a different expense before a prior background
  // upload finishes can't misattach the receipt to the wrong one.
  const targetExpenseIdRef = useRef(expenseId)

  function handleOpenChange(next: boolean) {
    if (!next) capture.clearAttachedReceipt()
    onOpenChange(next)
  }

  useEffect(() => {
    if (capture.receiptUploading && !wasUploadingRef.current) {
      targetExpenseIdRef.current = expenseId
      handleOpenChange(false)
    }
    wasUploadingRef.current = capture.receiptUploading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.receiptUploading, expenseId])

  useEffect(() => {
    if (!capture.attachedReceiptAsset || !workspaceId) return
    const receiptAssetId = capture.attachedReceiptAsset.id
    const targetExpenseId = targetExpenseIdRef.current
    expensesService
      .updateExpense(workspaceId, targetExpenseId, { receiptAssetId })
      .then(() => {
      })
      .catch((error) => {
        toast({
          title: "Couldn't attach receipt",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        })
      })
      .finally(() => {
        capture.clearAttachedReceipt()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.attachedReceiptAsset, workspaceId])

  // Only worth a toast once the dialog's already closed — while it's still
  // open, ReceiptCaptureField already shows this error inline, and a toast
  // on top of that would just be a redundant duplicate.
  useEffect(() => {
    if (capture.receiptError && !open) {
      toast({ title: "Couldn't attach receipt", description: capture.receiptError, variant: "destructive" })
      capture.clearAttachedReceipt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.receiptError, open])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach a receipt{vendorLabel ? ` — ${vendorLabel}` : ""}</DialogTitle>
        </DialogHeader>
        <ReceiptCaptureField capture={capture} />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
