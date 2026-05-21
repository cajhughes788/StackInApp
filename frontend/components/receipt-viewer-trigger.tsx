"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Minus, Plus, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  getReceiptOriginalUrl,
  resolveReceiptMediaSource,
} from "@/lib/domain/receiptAssetsService"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

type ReceiptViewerTriggerProps = {
  workspaceId: string
  receiptAssetId: string
  asset?: Partial<ReceiptAsset> | null
  title?: string
  label?: string
  variant?: "link" | "outline" | "ghost"
  className?: string
}

type TransformState = {
  scale: number
  x: number
  y: number
}

type PointerPoint = {
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(first: PointerPoint, second: PointerPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function midpointBetween(first: PointerPoint, second: PointerPoint): PointerPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export default function ReceiptViewerTrigger({
  workspaceId,
  receiptAssetId,
  asset,
  title = "Receipt",
  label = "View receipt",
  variant = "outline",
  className,
}: ReceiptViewerTriggerProps) {
  const isNativeApp = Capacitor.isNativePlatform()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transform, setTransform] = useState<TransformState>({
    scale: 1,
    x: 0,
    y: 0,
  })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [resolvedAsset, setResolvedAsset] = useState<ReceiptAsset | Partial<ReceiptAsset> | null>(
    asset ?? null
  )
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef<Map<number, PointerPoint>>(new Map())
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch"
    startScale: number
    startX: number
    startY: number
    initialX: number
    initialY: number
    startDistance: number
    startMidpointX: number
    startMidpointY: number
  }>({
    mode: "none",
    startScale: 1,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    startDistance: 0,
    startMidpointX: 0,
    startMidpointY: 0,
  })

  const resetViewer = useCallback(() => {
    pointersRef.current.clear()
    gestureRef.current = {
      mode: "none",
      startScale: 1,
      startX: 0,
      startY: 0,
      initialX: 0,
      initialY: 0,
      startDistance: 0,
      startMidpointX: 0,
      startMidpointY: 0,
    }
    setTransform({
      scale: 1,
      x: 0,
      y: 0,
    })
  }, [])

  const clampTransform = useCallback((next: TransformState): TransformState => {
    const safeScale = clamp(next.scale, MIN_SCALE, MAX_SCALE)

    if (
      viewportSize.width <= 0 ||
      viewportSize.height <= 0 ||
      imageSize.width <= 0 ||
      imageSize.height <= 0
    ) {
      return {
        scale: safeScale,
        x: safeScale === 1 ? 0 : next.x,
        y: safeScale === 1 ? 0 : next.y,
      }
    }

    const fitScale = Math.min(
      viewportSize.width / imageSize.width,
      viewportSize.height / imageSize.height
    )
    const baseWidth = imageSize.width * fitScale
    const baseHeight = imageSize.height * fitScale
    const scaledWidth = baseWidth * safeScale
    const scaledHeight = baseHeight * safeScale
    const maxX = Math.max(0, (scaledWidth - viewportSize.width) / 2)
    const maxY = Math.max(0, (scaledHeight - viewportSize.height) / 2)

    return {
      scale: safeScale,
      x: safeScale === 1 ? 0 : clamp(next.x, -maxX, maxX),
      y: safeScale === 1 ? 0 : clamp(next.y, -maxY, maxY),
    }
  }, [imageSize.height, imageSize.width, viewportSize.height, viewportSize.width])

  useEffect(() => {
    if (!open || !viewportRef.current) {
      return
    }

    const node = viewportRef.current
    const updateSize = () => {
      setViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    updateSize()

    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [open])

  useEffect(() => {
    setTransform((current) => clampTransform(current))
  }, [clampTransform])

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      resetViewer()
    }
    if (!nextOpen || src || loading) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await resolveReceiptMediaSource(
        workspaceId,
        receiptAssetId,
        "preview",
        asset
      )
      setResolvedAsset(result.asset ?? asset ?? null)
      setSrc(result.src)
      if (!result.src) {
        const fallbackUrl = getReceiptOriginalUrl(result.asset ?? asset ?? null)
        if (fallbackUrl) {
          window.open(fallbackUrl, "_blank", "noopener,noreferrer")
          resetViewer()
          setOpen(false)
          return
        }
        setError("Receipt preview is unavailable.")
      }
    } catch (err) {
      const fallbackUrl = getReceiptOriginalUrl(resolvedAsset ?? asset ?? null)
      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer")
        resetViewer()
        setOpen(false)
        return
      }
      setError(err instanceof Error ? err.message : "Unable to load receipt preview.")
    } finally {
      setLoading(false)
    }
  }

  function adjustZoom(delta: number) {
    setTransform((current) =>
      clampTransform({
        ...current,
        scale: Number((current.scale + delta).toFixed(2)),
      })
    )
  }

  function beginPan(point: PointerPoint) {
    gestureRef.current = {
      mode: "pan",
      startScale: transform.scale,
      startX: point.x,
      startY: point.y,
      initialX: transform.x,
      initialY: transform.y,
      startDistance: 0,
      startMidpointX: 0,
      startMidpointY: 0,
    }
  }

  function beginPinch(first: PointerPoint, second: PointerPoint) {
    const midpoint = midpointBetween(first, second)
    gestureRef.current = {
      mode: "pinch",
      startScale: transform.scale,
      startX: 0,
      startY: 0,
      initialX: transform.x,
      initialY: transform.y,
      startDistance: distanceBetween(first, second),
      startMidpointX: midpoint.x,
      startMidpointY: midpoint.y,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!src) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })

    const points = Array.from(pointersRef.current.values())
    if (points.length >= 2) {
      beginPinch(points[0], points[1])
      return
    }

    if (transform.scale > 1) {
      beginPan(points[0])
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) {
      return
    }

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })

    const points = Array.from(pointersRef.current.values())
    if (points.length >= 2) {
      const first = points[0]
      const second = points[1]
      const nextDistance = distanceBetween(first, second)
      const nextMidpoint = midpointBetween(first, second)
      const scaleRatio =
        gestureRef.current.startDistance > 0
          ? nextDistance / gestureRef.current.startDistance
          : 1

      setTransform(
        clampTransform({
          scale: gestureRef.current.startScale * scaleRatio,
          x:
            gestureRef.current.initialX +
            (nextMidpoint.x - gestureRef.current.startMidpointX),
          y:
            gestureRef.current.initialY +
            (nextMidpoint.y - gestureRef.current.startMidpointY),
        })
      )
      return
    }

    if (gestureRef.current.mode !== "pan" || transform.scale <= 1) {
      return
    }

    const point = points[0]
    if (!point) {
      return
    }

    setTransform(
      clampTransform({
        scale: transform.scale,
        x: gestureRef.current.initialX + (point.x - gestureRef.current.startX),
        y: gestureRef.current.initialY + (point.y - gestureRef.current.startY),
      })
    )
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    pointersRef.current.delete(event.pointerId)
    const points = Array.from(pointersRef.current.values())

    if (points.length >= 2) {
      beginPinch(points[0], points[1])
      return
    }

    if (points.length === 1 && transform.scale > 1) {
      beginPan(points[0])
      return
    }

    gestureRef.current.mode = "none"
  }

  function handleDoubleClick() {
    if (isNativeApp) {
      return
    }

    setTransform((current) =>
      current.scale > 1
        ? {
            scale: 1,
            x: 0,
            y: 0,
          }
        : {
            scale: 2,
            x: 0,
            y: 0,
          }
    )
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => void handleOpenChange(true)}
      >
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[95vh] max-w-[calc(100vw-1rem)] border-none bg-transparent p-0 shadow-none sm:max-w-5xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Receipt image viewer.</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[95vh] flex-col items-center gap-3">
            {!isNativeApp ? (
              <div className="flex w-full items-center justify-end gap-2 px-2">
                <div className="mr-auto text-xs text-white/80">
                  Zoom {Math.round(transform.scale * 100)}%
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => adjustZoom(-0.25)}>
                  <Minus className="h-4 w-4" />
                  <span className="sr-only">Zoom out</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={resetViewer}>
                  <RotateCcw className="h-4 w-4" />
                  <span className="sr-only">Reset zoom</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => adjustZoom(0.25)}>
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Zoom in</span>
                </Button>
              </div>
            ) : null}

            <div
              ref={viewportRef}
              className="flex w-full flex-1 items-center justify-center overflow-auto"
              style={{ touchAction: "none", WebkitOverflowScrolling: "touch" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onDoubleClick={handleDoubleClick}
            >
              {loading ? (
                <p className="text-sm text-white/80">Loading receipt preview...</p>
              ) : src ? (
                <img
                  src={src}
                  alt={title}
                  draggable={false}
                  className="max-h-[calc(95vh-4.5rem)] w-auto max-w-full select-none object-contain"
                  onLoad={(event) => {
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }}
                  style={
                    {
                      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                      transformOrigin: "center center",
                    }
                  }
                />
              ) : (
                <p className="text-sm text-white/80">
                  {error ?? "Receipt preview is unavailable."}
                </p>
              )}
            </div>

            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
