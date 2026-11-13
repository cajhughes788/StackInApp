import React from "react"
import { Easing, Img, interpolate, staticFile, useVideoConfig } from "remotion"
import { useUnit } from "../theme"
import { IMAGE, PARTS, type PartId, type Pt } from "./parts"

const SRC = staticFile("palace/palace.png")

// Each piece of the castle: its outline(s), the outlines cut out of it, and
// which way it prints in (up from the bottom, or across from the left).
const PIECES: Record<PartId, { include: Pt[][] | "all"; exclude: Pt[][]; dir: "up" | "right" }> = {
  foundation: { include: "all", exclude: Object.values(PARTS), dir: "up" },
  stairs: { include: [PARTS.stairs], exclude: [], dir: "up" },
  hall: { include: [PARTS.hall], exclude: [], dir: "right" },
  booking: { include: [PARTS.booking], exclude: [], dir: "up" },
  invoices: { include: [PARTS.invoices], exclude: [], dir: "up" },
  payments: { include: [PARTS.payments], exclude: [], dir: "up" },
  receipts: { include: [PARTS.receipts], exclude: [], dir: "up" },
  keep: { include: [PARTS.keep], exclude: [], dir: "up" },
}

function bounds(include: Pt[][] | "all") {
  if (include === "all") return { x0: 0, x1: IMAGE, y0: 520, y1: 972 }
  const pts = include.flat()
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    y1: Math.max(...pts.map((p) => p[1])),
  }
}

const poly = (pts: Pt[], fill: string) => `<polygon points='${pts.map((p) => p.join(",")).join(" ")}' fill='${fill}'/>`

// An alpha mask (in image pixels, stretched to the layer) for one piece.
function maskFor(id: PartId) {
  const { include, exclude } = PIECES[id]
  const shapes = include === "all" ? `<rect width='${IMAGE}' height='${IMAGE}' fill='white'/>` : include.map((p) => poly(p, "white")).join("")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${IMAGE} ${IMAGE}'><defs><mask id='m'>${shapes}${exclude
    .map((p) => poly(p, "black"))
    .join("")}</mask></defs><rect width='${IMAGE}' height='${IMAGE}' fill='white' mask='url(#m)'/></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}
const MASKS = Object.fromEntries((Object.keys(PIECES) as PartId[]).map((id) => [id, maskFor(id)])) as Record<PartId, string>
const BOUNDS = Object.fromEntries((Object.keys(PIECES) as PartId[]).map((id) => [id, bounds(PIECES[id].include)])) as Record<
  PartId,
  ReturnType<typeof bounds>
>

export type PieceState = { progress: number; flash: number }

// --- Camera ----------------------------------------------------------------

export type Cam = { fx: number; fy: number; z: number }

// Where the castle sits on screen and how big, per frame shape.
export function useCastleLayout() {
  const { width, height } = useVideoConfig()
  const u = useUnit()
  const tall = height > width * 1.5
  return tall ? { S: 1000 * u, cx: width / 2, cy: height * 0.47 } : { S: 700 * u, cx: width / 2, cy: height * 0.43 }
}

// Screen position of an image-pixel point under the camera.
export function screenOf(x: number, y: number, cam: Cam, layout: { S: number; cx: number; cy: number }) {
  const k = (cam.z * layout.S) / IMAGE
  return { x: layout.cx + k * (x - cam.fx), y: layout.cy + k * (y - cam.fy) }
}

// Camera keyframes: [frame, focus x, focus y, zoom] in image pixels.
export function camAt(frame: number, keys: Array<[number, number, number, number]>): Cam {
  const frames = keys.map((k) => k[0])
  const ease = { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  return {
    fx: interpolate(frame, frames, keys.map((k) => k[1]), ease),
    fy: interpolate(frame, frames, keys.map((k) => k[2]), ease),
    z: interpolate(frame, frames, keys.map((k) => k[3]), ease),
  }
}

// --- The castle --------------------------------------------------------------

// The castle, built piece by piece. `plan` is the faint outline of the whole
// thing (0 hides it). `dim` and `blur` push it back behind feature windows.
export const Palace: React.FC<{
  pieces: Record<PartId, PieceState>
  cam: Cam
  plan: number
  dim?: number
  blur?: number
  opacity?: number
}> = ({ pieces, cam, plan, dim = 0, blur = 0, opacity = 1 }) => {
  const layout = useCastleLayout()
  const { S } = layout
  const s = S / IMAGE
  const k = cam.z
  return (
    <div
      style={{
        position: "absolute",
        left: layout.cx - S / 2,
        top: layout.cy - S / 2,
        width: S,
        height: S,
        transform: `translate(${-k * (cam.fx - IMAGE / 2) * s}px, ${-k * (cam.fy - IMAGE / 2) * s}px) scale(${k})`,
        filter: `brightness(${1 - dim}) blur(${blur}px)`,
        opacity,
        // The art is light on black: screen it so the black drops out over the aurora.
        mixBlendMode: "screen",
      }}
    >
      {plan > 0 ? <Img src={SRC} style={{ position: "absolute", inset: 0, width: S, height: S, opacity: plan }} /> : null}
      {(Object.keys(PIECES) as PartId[]).map((id) => {
        const { progress, flash } = pieces[id]
        if (progress <= 0) return null
        const b = BOUNDS[id]
        const dir = PIECES[id].dir
        // The print line: everything past it is built.
        const scanY = b.y1 + 6 - progress * (b.y1 - b.y0 + 12)
        const scanX = b.x0 - 6 + progress * (b.x1 - b.x0 + 12)
        const clip = dir === "up" ? `inset(${Math.max(0, scanY * s)}px 0 0 0)` : `inset(0 ${Math.max(0, (IMAGE - scanX) * s)}px 0 0)`
        const printing = progress < 1
        return (
          <div
            key={id}
            style={{
              position: "absolute",
              inset: 0,
              maskImage: MASKS[id],
              WebkitMaskImage: MASKS[id],
              maskSize: "100% 100%",
              WebkitMaskSize: "100% 100%",
              mixBlendMode: "lighten",
            }}
          >
            <div style={{ position: "absolute", inset: 0, clipPath: clip, filter: `brightness(${1 + flash * 0.9}) saturate(${1 + flash * 0.3})` }}>
              <Img src={SRC} style={{ width: S, height: S }} />
            </div>
            {printing ? (
              dir === "up" ? (
                <>
                  <div style={{ position: "absolute", left: 0, right: 0, top: scanY * s, height: 46 * s, background: "linear-gradient(rgba(170,255,210,0.45), rgba(170,255,210,0))" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: scanY * s - 2 * s, height: 4 * s, background: "#E9FFF2", boxShadow: `0 0 ${14 * s}px #3DDC84, 0 0 ${40 * s}px #3DDC84` }} />
                </>
              ) : (
                <>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: scanX * s - 46 * s, width: 46 * s, background: "linear-gradient(90deg, rgba(170,255,210,0), rgba(170,255,210,0.45))" }} />
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: scanX * s - 2 * s, width: 4 * s, background: "#E9FFF2", boxShadow: `0 0 ${14 * s}px #3DDC84, 0 0 ${40 * s}px #3DDC84` }} />
                </>
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
