import React from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, staticFile, Img } from "remotion"
import { C } from "../theme"
import { clamp } from "./motion"

// Slow-moving green/teal light on near-black. `glow` 0–1 sets how strong.
export const Aurora: React.FC<{ glow?: number; streaks?: boolean }> = ({ glow = 0.7, streaks = true }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const t = frame / 30
  const blob = (x: number, y: number, r: number, color: string, alpha: number) =>
    `radial-gradient(${r}px ${r * 0.8}px at ${x}px ${y}px, ${color}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")}, transparent 70%)`
  const s = Math.max(width, height)
  const layers = [
    blob(width * (0.3 + 0.12 * Math.sin(t * 0.35)), height * (0.25 + 0.08 * Math.cos(t * 0.3)), s * 0.55, C.green, 0.55 * glow),
    blob(width * (0.75 + 0.1 * Math.cos(t * 0.27)), height * (0.6 + 0.1 * Math.sin(t * 0.33)), s * 0.5, C.teal, 0.42 * glow),
    blob(width * (0.5 + 0.15 * Math.sin(t * 0.21 + 2)), height * (0.95 + 0.05 * Math.sin(t * 0.4)), s * 0.6, C.deep, 0.7 * glow),
  ]
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill style={{ background: layers.join(","), filter: "blur(40px)" }} />
      {streaks ? (
        <AbsoluteFill
          style={{
            opacity: 0.18 * glow,
            background: `repeating-linear-gradient(90deg, rgba(61,220,132,0.0) 0px, rgba(61,220,132,0.35) ${s * 0.004}px, rgba(61,220,132,0) ${s * 0.012}px, rgba(61,220,132,0) ${s * 0.03}px)`,
            maskImage: "linear-gradient(to top, black 0%, transparent 65%)",
            WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 65%)",
            transform: `translateX(${Math.sin(t * 0.2) * s * 0.01}px)`,
          }}
        />
      ) : null}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  )
}

export const Wordmark: React.FC<{ width: number; glow?: number }> = ({ width, glow = 1 }) => (
  <Img
    src={staticFile("wordmark.svg")}
    style={{ width, filter: `drop-shadow(0 0 ${width * 0.08 * glow}px rgba(61,220,132,${0.45 * glow}))` }}
  />
)

// Rings bursting out from the center: the reference's ring transitions.
export const RingBurst: React.FC<{ start: number; size: number; count?: number }> = ({ start, size, count = 3 }) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {Array.from({ length: count }).map((_, i) => {
        const p = interpolate(frame, [start + i * 5, start + i * 5 + 40], [0, 1], clamp)
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: size * (0.2 + p * 1.6),
              height: size * (0.2 + p * 1.6),
              borderRadius: "50%",
              border: `${size * 0.006}px solid ${C.greenBright}`,
              opacity: p === 0 ? 0 : (1 - p) * 0.8,
              boxShadow: `0 0 ${size * 0.05}px rgba(61,220,132,0.6), inset 0 0 ${size * 0.05}px rgba(61,220,132,0.4)`,
            }}
          />
        )
      })}
    </AbsoluteFill>
  )
}
