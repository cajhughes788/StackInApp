import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { C, fontFamily, useUnit } from "../theme"
import { clamp, useIn } from "../components/motion"
import { Icon, type Glyph } from "../components/ui"

export const money = (n: number, sign = false) =>
  `${sign ? (n < 0 ? "−" : "+") : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// The foundation: a glowing profit & loss slab, tipped back a little like a
// floor the features stand on. `flash` 0–1 brightens it when money lands.
export const Slab: React.FC<{
  width?: number
  income: number
  expenses: number
  flash?: number
  tilt?: number
  children?: React.ReactNode
}> = ({ width = 900, income, expenses, flash = 0, tilt = 16, children }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const live = 0.5 + 0.5 * Math.sin(frame / 8)
  const stat = (label: string, value: string, color: string, big = false) => (
    <div style={{ flex: big ? 1.3 : 1 }}>
      <div style={{ fontSize: 22 * u, color: C.muted, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: (big ? 52 : 36) * u, fontWeight: big ? 700 : 600, color, marginTop: 4 * u, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  )
  return (
    <div style={{ perspective: 1800 * u }}>
      <div
        style={{
          width: width * u,
          borderRadius: 40 * u,
          padding: `${30 * u}px ${40 * u}px`,
          fontFamily,
          color: C.text,
          transform: `rotateX(${tilt}deg)`,
          transformOrigin: "50% 0%",
          background: "linear-gradient(170deg, rgba(40,52,50,0.95), rgba(14,20,20,0.95))",
          border: `${2 * u}px solid rgba(61,220,132,${0.25 + 0.5 * flash})`,
          boxShadow: `0 ${40 * u}px ${120 * u}px rgba(47,168,102,${0.25 + 0.35 * flash}), 0 ${10 * u}px ${40 * u}px rgba(0,0,0,0.6), inset 0 ${2 * u}px 0 rgba(255,255,255,0.12)`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 * u }}>
          <span style={{ fontSize: 26 * u, fontWeight: 600 }}>Profit &amp; Loss · This month</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 * u, fontSize: 22 * u, color: C.greenBright }}>
            <span style={{ width: 12 * u, height: 12 * u, borderRadius: "50%", background: C.greenBright, opacity: 0.4 + 0.6 * live, boxShadow: `0 0 ${12 * u}px ${C.greenBright}` }} />
            Live
          </span>
        </div>
        <div style={{ display: "flex", gap: 30 * u, alignItems: "flex-end" }}>
          {stat("Income", money(income), C.text)}
          {stat("Expenses", money(expenses), C.muted)}
          {stat("Profit", money(income - expenses), C.greenBright, true)}
        </div>
        {children}
      </div>
    </div>
  )
}

// A feature block that drops onto the foundation and lands with a bounce.
export const Block: React.FC<{ icon: Glyph; label: string; detail: string; delay: number; width?: number; lit?: number }> = ({
  icon,
  label,
  detail,
  delay,
  width = 205,
  lit = 0,
}) => {
  const u = useUnit()
  const p = useIn(delay, 12, 140)
  return (
    <div
      style={{
        width: width * u,
        height: 210 * u,
        borderRadius: 32 * u,
        padding: 22 * u,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily,
        color: C.text,
        opacity: Math.min(1, p * 1.5),
        transform: `translateY(${(1 - p) * -260 * u}px)`,
        background: `linear-gradient(160deg, rgba(255,255,255,${0.1 + 0.08 * lit}), rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.25))`,
        border: `${1.5 * u}px solid rgba(${lit > 0 ? "61,220,132" : "255,255,255"},${0.16 + 0.5 * lit})`,
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5), 0 0 ${60 * u * lit}px rgba(61,220,132,${0.5 * lit}), inset 0 ${1.5 * u}px 0 rgba(255,255,255,0.18)`,
      }}
    >
      <div
        style={{
          width: 64 * u,
          height: 64 * u,
          borderRadius: 20 * u,
          background: lit > 0 ? `rgba(47,168,102,${0.25 + 0.4 * lit})` : "rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={36 * u} color={C.text} />
      </div>
      <div>
        <div style={{ fontSize: 30 * u, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20 * u, color: C.muted, marginTop: 4 * u, whiteSpace: "nowrap" }}>{detail}</div>
      </div>
    </div>
  )
}

// A vertical connector with a bright pulse that runs down it at `at`.
export const PulseLine: React.FC<{ height: number; at: number; show: number }> = ({ height, at, show }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const run = interpolate(frame, [at, at + 14], [0, 1], clamp)
  const after = interpolate(frame, [at + 14, at + 40], [1, 0.35], clamp)
  return (
    <div style={{ position: "relative", width: 4 * u, height: height * u, opacity: show }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 2 * u, background: `rgba(61,220,132,${frame >= at ? 0.25 + 0.5 * after : 0.15})` }} />
      {run > 0 && run < 1 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: `${run * 100}%`,
            width: 18 * u,
            height: 18 * u,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: "#fff",
            boxShadow: `0 0 ${20 * u}px ${C.greenBright}, 0 0 ${50 * u}px ${C.greenBright}`,
          }}
        />
      ) : null}
    </div>
  )
}

// "+$10.00 Income" rising off the foundation where money lands.
export const Floater: React.FC<{ text: string; at: number; negative?: boolean }> = ({ text, at, negative }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const p = interpolate(frame, [at, at + 30], [0, 1], clamp)
  if (p === 0) return null
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        transform: `translate(-50%, ${-p * 70 * u}px)`,
        opacity: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3,
        fontFamily,
        fontSize: 26 * u,
        fontWeight: 700,
        whiteSpace: "nowrap",
        color: negative ? C.muted : C.greenBright,
        textShadow: negative ? "none" : `0 0 ${16 * u}px rgba(61,220,132,0.8)`,
      }}
    >
      {text}
    </div>
  )
}

// Linear interpolation of a running total across money-landing moments.
export function useTotal(base: number, steps: Array<{ at: number; add: number }>) {
  const frame = useCurrentFrame()
  return steps.reduce((sum, step) => sum + step.add * interpolate(frame, [step.at, step.at + 12], [0, 1], clamp), base)
}

export function useFlash(ats: number[]) {
  const frame = useCurrentFrame()
  return Math.max(0, ...ats.map((at) => interpolate(frame, [at, at + 4, at + 24], [0, 1, 0], clamp)))
}
