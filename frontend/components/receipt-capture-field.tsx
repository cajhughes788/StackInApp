"use client"

import { Camera, ImagePlus, Loader2, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReceiptCapture } from "@/hooks/use-receipt-capture"

// Every state (picker buttons, processing, attached) renders in a row of this
// same fixed height, so picking a photo never shifts the fields below.
const ROW_CLASS = "flex h-14 items-center gap-2"

export default function ReceiptCaptureField({ capture }: { capture: ReceiptCapture }) {
  const {
    attachedReceiptAsset,
    receiptUploading,
    pendingReceiptPreview,
    receiptError,
    isNativeCamera,
    receiptFileInputRef,
    handleReceiptFileChange,
    handleNativeReceiptCapture,
    clearAttachedReceipt,
  } = capture

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          Attach Receipt
          <span className="ml-1 text-xs font-normal text-muted-foreground">(Optional)</span>
        </span>
      </div>

      {attachedReceiptAsset ? (
        <div className={`${ROW_CLASS} rounded-lg border border-border bg-muted/20 px-3`}>
          {attachedReceiptAsset.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachedReceiptAsset.dataUrl}
              alt="Receipt preview"
              className="h-10 w-10 rounded object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">
              {attachedReceiptAsset.fileName}
            </span>
            {attachedReceiptAsset.uploadStatus === "uploading" ? (
              <span className="text-xs text-muted-foreground">Uploading in background...</span>
            ) : attachedReceiptAsset.uploadStatus === "failed" ? (
              <span className="text-xs text-destructive">Upload failed — remove and retake</span>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={clearAttachedReceipt}
            aria-label="Remove receipt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : receiptUploading ? (
        <div className={`${ROW_CLASS} rounded-lg border border-border bg-muted/20 px-3`}>
          {pendingReceiptPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pendingReceiptPreview.url}
              alt="Receipt preview"
              className="h-10 w-10 rounded object-cover opacity-70"
              onError={(event) => {
                // e.g. HEIC outside Safari — fall back to just the label
                event.currentTarget.style.display = "none"
              }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {pendingReceiptPreview ? (
              <span className="block truncate text-sm text-foreground">
                {pendingReceiptPreview.fileName}
              </span>
            ) : null}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing receipt...
            </span>
          </div>
        </div>
      ) : (
        <div className={ROW_CLASS}>
          <input
            ref={receiptFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReceiptFileChange}
          />
          {isNativeCamera ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleNativeReceiptCapture("camera")}
            >
              <Camera className="h-4 w-4" />
              Camera
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              isNativeCamera
                ? void handleNativeReceiptCapture("photos")
                : receiptFileInputRef.current?.click()
            }
          >
            <ImagePlus className="h-4 w-4" />
            Choose Image
          </Button>
        </div>
      )}

      {receiptError ? <p className="text-xs text-destructive">{receiptError}</p> : null}
    </div>
  )
}
