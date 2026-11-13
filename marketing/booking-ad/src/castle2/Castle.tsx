import React from "react"
import { Easing, Img, interpolate, staticFile, useVideoConfig } from "remotion"
import {
  BAYS,
  BASE,
  FOUNDATION_CUTS,
  F_H,
  F_W,
  HALL,
  HALL_X,
  HOLO,
  KEEP,
  LEVELS,
  STAIRS,
  TOWER_BOOKING,
  TOWER_INVOICES,
  TOWER_PAYMENTS,
  TOWER_RECEIPTS,
  toPoints,
  type Pt,
} from "./geometry"

const HOLOGRAM = staticFile("palace/palace.png")
const FRAME = staticFile("palace/frame-final.png")
const REAL = staticFile("palace/palace-final.png")

const c01 = (v: number) => Math.max(0, Math.min(1, v))

// How far along the build is. Counts are continuous: 2.4 bays means two
// bays built and the third 40% of the way in.
export type Build = {
  frame: number // 0–5 levels
  frameOpacity: number
  bays: number // 0–64
  stairs: number // 0–4
  hall: number // 0–19 sections
  booking: number // 0–4 levels
  invoices: number
  receipts: number
  payments: number // 0–1, one fast rise
  keep: number // 0–4
  real: number // 0–1, the line that turns the hologram real
  flash: Partial<Record<"foundation" | "stairs" | "hall" | "booking" | "invoices" | "payments" | "receipts" | "keep" | "all", number>>
}

export const EMPTY: Build = {
  frame: 0,
  frameOpacity: 1,
  bays: 0,
  stairs: 0,
  hall: 0,
  booking: 0,
  invoices: 0,
  receipts: 0,
  payments: 0,
  keep: 0,
  real: 0,
  flash: {},
}

// --- Camera ----------------------------------------------------------------

export type Cam = { fx: number; fy: number; z: number }

export function useLayout() {
  const { width, height } = useVideoConfig()
  const tall = height > width * 1.5
  // The castle is ~745 F px wide.
  const k0 = tall ? (width * 0.93) / 745 : (height * 0.9) / 745
  return { k0, cx: width / 2, cy: height * (tall ? 0.45 : 0.44), tall }
}

export function camAt(frame: number, keys: Array<[number, number, number, number]>): Cam {
  const frames = keys.map((k) => k[0])
  const opts = { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  return {
    fx: interpolate(frame, frames, keys.map((k) => k[1]), opts),
    fy: interpolate(frame, frames, keys.map((k) => k[2]), opts),
    z: interpolate(frame, frames, keys.map((k) => k[3]), opts),
  }
}

export function screenOf(p: Pt, cam: Cam, layout: ReturnType<typeof useLayout>) {
  const k = layout.k0 * cam.z
  return { x: layout.cx + k * (p[0] - cam.fx), y: layout.cy + k * (p[1] - cam.fy) }
}

// --- Masks ------------------------------------------------------------------

const poly = (pts: Pt[], fill: string, opacity = 1) => `<polygon points='${toPoints(pts)}' fill='${fill}' fill-opacity='${opacity.toFixed(3)}'/>`
const rect = (x: number, y: number, w: number, h: number, opacity: number) =>
  `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${w.toFixed(1)}' height='${h.toFixed(1)}' fill='white' fill-opacity='${opacity.toFixed(3)}'/>`

// An alpha mask from luminance content, in F space.
function mask(content: string, defs = "") {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${F_W} ${F_H}' preserveAspectRatio='none'><defs>${defs}<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${F_W}' height='${F_H}'>${content}</mask></defs><rect width='${F_W}' height='${F_H}' fill='white' mask='url(#m)'/></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

// Horizontal bands (levels), bottom level first, clipped to a piece.
function levelsMask(piece: Pt[], levels: number[], value: number) {
  let bottom = F_H
  const bands = levels
    .map((top, i) => {
      const band = rect(0, top, F_W, bottom - top + 0.5, c01(value - i))
      bottom = top
      return band
    })
    .join("")
  return mask(`<g clip-path='url(#p)'>${bands}</g>`, `<clipPath id='p'>${poly(piece, "white")}</clipPath>`)
}

function hallMask(value: number) {
  const [x0, x1] = HALL_X
  const w = (x1 - x0) / 19
  const bands = Array.from({ length: 19 }, (_, i) => rect(x0 + i * w - (i === 0 ? 40 : 0), 0, w + (i === 0 ? 40 : 0) + (i === 18 ? 40 : 0.5), F_H, c01(value - i))).join("")
  return mask(`<g clip-path='url(#p)'>${bands}</g>`, `<clipPath id='p'>${poly(HALL, "white")}</clipPath>`)
}

function foundationMask(value: number) {
  const bays = BAYS.map((b, i) => poly(b, "white", c01(value - i))).join("")
  const cuts = FOUNDATION_CUTS.map((c) => poly(c, "black")).join("")
  return mask(`<g clip-path='url(#p)'>${bays}</g>${cuts}`, `<clipPath id='p'>${poly(BASE, "white")}</clipPath>`)
}

function riseMask(piece: Pt[], value: number) {
  const ys = piece.map((p) => p[1])
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  const y = bottom - value * (bottom - top + 4)
  return mask(`<g clip-path='url(#p)'>${rect(0, y, F_W, F_H - y, value > 0 ? 1 : 0)}</g>`, `<clipPath id='p'>${poly(piece, "white")}</clipPath>`)
}

// --- Layers -----------------------------------------------------------------

const Layer: React.FC<{ mask: string; flash?: number; src?: string; children?: React.ReactNode }> = ({ mask: m, flash = 0, src = HOLOGRAM, children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      maskImage: m,
      WebkitMaskImage: m,
      maskSize: "100% 100%",
      WebkitMaskSize: "100% 100%",
      mixBlendMode: "lighten",
      filter: flash > 0 ? `brightness(${1 + flash * 0.9}) saturate(${1 + flash * 0.4})` : undefined,
    }}
  >
    {children ?? <Img src={src} style={{ position: "absolute", left: HOLO.left, top: HOLO.top, width: HOLO.width, height: HOLO.height }} />}
  </div>
)

// The castle, in F space, under the camera. `overlay` is SVG drawn in F space
// on top of the hologram (light lines, the ledger, the cornerstone).
export const Castle: React.FC<{ build: Build; cam: Cam; overlay?: React.ReactNode; dim?: number }> = ({ build: b, cam, overlay, dim = 0 }) => {
  const layout = useLayout()
  const k = layout.k0 * cam.z
  const all = b.flash.all ?? 0
  const f = (key: keyof Build["flash"]) => Math.max(b.flash[key] ?? 0, all)
  // The line that turns it real, in F y; the hologram stays above it.
  const lineY = F_H + 30 - b.real * (F_H + 60)
  const holoClip = b.real > 0 ? `inset(0 0 ${Math.max(0, F_H - lineY)}px 0)` : undefined

  const stage: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: F_W,
    height: F_H,
    transformOrigin: "0 0",
    transform: `translate(${layout.cx - k * cam.fx}px, ${layout.cy - k * cam.fy}px) scale(${k})`,
  }

  return (
    <>
      {/* The real castle, below the line. */}
      {b.real > 0 ? (
        <div style={stage}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              maskImage: `linear-gradient(to bottom, transparent ${lineY - 26}px, black ${lineY + 2}px)`,
              WebkitMaskImage: `linear-gradient(to bottom, transparent ${lineY - 26}px, black ${lineY + 2}px)`,
            }}
          >
            {/* Feathered edges, so the sharp castle melts into the blurred world around it. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                maskImage: "linear-gradient(to bottom, transparent 0, black 70px, black 650px, transparent 720px), linear-gradient(to right, transparent 0, black 90px, black 1190px, transparent 1280px)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 70px, black 650px, transparent 720px), linear-gradient(to right, transparent 0, black 90px, black 1190px, transparent 1280px)",
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
            >
              <Img src={REAL} style={{ position: "absolute", inset: 0, width: F_W, height: F_H }} />
            </div>
          </div>
        </div>
      ) : null}

      {/* The hologram build: light on black, screened over whatever is behind. */}
      <div style={{ ...stage, mixBlendMode: "screen", clipPath: holoClip, filter: dim > 0 ? `brightness(${1 - dim})` : undefined }}>
        <div style={{ position: "absolute", inset: 0, isolation: "isolate" }}>
          {b.frame > 0 ? (
            <Layer mask={levelsMask([[0, 0], [F_W, 0], [F_W, F_H], [0, F_H]], LEVELS.frame, b.frame)}>
              <Img src={FRAME} style={{ position: "absolute", inset: 0, width: F_W, height: F_H, opacity: b.frameOpacity }} />
            </Layer>
          ) : null}
          {b.bays > 0 ? <Layer mask={foundationMask(b.bays)} flash={f("foundation")} /> : null}
          {b.stairs > 0 ? <Layer mask={levelsMask(STAIRS, LEVELS.stairs, b.stairs)} flash={f("stairs")} /> : null}
          {b.hall > 0 ? <Layer mask={hallMask(b.hall)} flash={f("hall")} /> : null}
          {b.receipts > 0 ? <Layer mask={levelsMask(TOWER_RECEIPTS, LEVELS.receipts, b.receipts)} flash={f("receipts")} /> : null}
          {b.booking > 0 ? <Layer mask={levelsMask(TOWER_BOOKING, LEVELS.booking, b.booking)} flash={f("booking")} /> : null}
          {b.invoices > 0 ? <Layer mask={levelsMask(TOWER_INVOICES, LEVELS.invoices, b.invoices)} flash={f("invoices")} /> : null}
          {b.payments > 0 ? <Layer mask={riseMask(TOWER_PAYMENTS, b.payments)} flash={f("payments")} /> : null}
          {b.keep > 0 ? <Layer mask={levelsMask(KEEP, LEVELS.keep, b.keep)} flash={f("keep")} /> : null}
        </div>
        {overlay ? (
          <svg viewBox={`0 0 ${F_W} ${F_H}`} width={F_W} height={F_H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            {overlay}
          </svg>
        ) : null}
      </div>

      {/* The bright line itself. */}
      {b.real > 0 && b.real < 1 ? (
        <div style={stage}>
          <div
            style={{
              position: "absolute",
              left: -600,
              right: -600,
              top: lineY - 1.5,
              height: 3,
              background: "#F4FFF8",
              boxShadow: "0 0 10px #3DDC84, 0 0 30px #3DDC84, 0 0 70px rgba(61,220,132,0.6)",
            }}
          />
        </div>
      ) : null}
    </>
  )
}

export { REAL }
