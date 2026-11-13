import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion"
import { C, fontFamily, useUnit } from "../theme"

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

// 0 → 1 spring starting at `delay` frames.
export function useIn(delay = 0, damping = 18, stiffness = 120) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping, stiffness, mass: 0.9 } })
}

// Wraps a scene: blurs and fades in, drifts slowly toward the camera, then
// blurs out, like the reference's shallow-focus cuts.
export const Scene: React.FC<{ duration: number; children: React.ReactNode; fadeIn?: number; fadeOut?: number; drift?: boolean }> = ({
  duration,
  children,
  fadeIn = 10,
  fadeOut = 10,
  drift = true,
}) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, fadeIn, duration - fadeOut, duration], [0, 1, 1, 0], clamp)
  const blur = interpolate(frame, [0, fadeIn, duration - fadeOut, duration], [18, 0, 0, 18], clamp)
  const scale = drift ? interpolate(frame, [0, duration], [1.04, 1], { easing: Easing.out(Easing.quad) }) : 1
  return (
    <AbsoluteFill style={{ opacity, filter: `blur(${blur}px)`, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
  )
}

// One short line, words rising in one after another. Wrap a word in ** **
// to make it the green highlight.
export const Words: React.FC<{
  text: string
  delay?: number
  size?: number
  stagger?: number
  weight?: number
  style?: React.CSSProperties
}> = ({ text, delay = 0, size = 64, stagger = 3, weight = 300, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const u = useUnit()
  const tokens: Array<{ word: string; hi: boolean }> = []
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    const hi = part.startsWith("**")
    part
      .replace(/\*\*/g, "")
      .split(" ")
      .filter(Boolean)
      .forEach((word) => tokens.push({ word, hi }))
  })
  return (
    <div
      style={{
        fontFamily,
        fontSize: size * u,
        fontWeight: weight,
        color: C.text,
        letterSpacing: -0.02 * size * u,
        lineHeight: 1.15,
        textAlign: "center",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 0.26 * size * u,
        ...style,
      }}
    >
      {tokens.map((token, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: { damping: 20, stiffness: 110 } })
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              transform: `translateY(${(1 - p) * 0.45 * size * u}px)`,
              filter: `blur(${(1 - p) * 10 * u}px)`,
              color: token.hi ? C.greenBright : C.text,
              fontWeight: token.hi ? Math.max(500, weight) : weight,
              textShadow: token.hi ? `0 0 ${28 * u}px rgba(61,220,132,0.55)` : "none",
            }}
          >
            {token.word}
          </span>
        )
      })}
    </div>
  )
}

// The text band at the lower part of the frame.
export const Caption: React.FC<{ children: React.ReactNode; bottom?: number }> = ({ children, bottom = 0.16 }) => {
  const u = useUnit()
  const { width, height } = useVideoConfig()
  // Tall frames: pull the line up toward the visuals.
  const pad = (height > width * 1.5 ? bottom * 2.6 : bottom) * 1080 * u
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: pad }}>
      <div style={{ maxWidth: 920 * u, padding: `0 ${40 * u}px` }}>{children}</div>
    </AbsoluteFill>
  )
}

// Centered stage for the visuals, slightly above middle.
export const Stage: React.FC<{ children: React.ReactNode; offset?: number; tallScale?: number }> = ({
  children,
  offset = -0.06,
  tallScale = 1.28,
}) => {
  const { width, height } = useVideoConfig()
  // Tall frames have room to spare, so the visuals get bigger there; square
  // and wide ones shrink them to leave the caption clear.
  const tall = height > width * 1.5
  const boost = tall ? tallScale : 0.8
  if (!tall) offset -= 0.03
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `translateY(${offset * 100}%) scale(${boost})` }}>
      {children}
    </AbsoluteFill>
  )
}
