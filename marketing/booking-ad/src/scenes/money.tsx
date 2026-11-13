import React from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion"
import { C, useUnit } from "../theme"
import { Caption, Stage, Words, clamp, useIn } from "../components/motion"
import { Card, CheckDot, Qr, Tag } from "../components/ui"
import { RingBurst, Wordmark } from "../components/backdrop"

// 24–29 s: finish & get paid. Totals, then the QR, then paid in full with a tip.
// Haircut $40 + beard trim $15 − $10 deposit = $45 due; $8 tip.
export const GetPaid: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const card = useIn(0)
  const toQr = interpolate(frame, [54, 66], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const paid = interpolate(frame, [100, 110], [0, 1], clamp)
  const tip = useIn(114, 12, 160)
  const line = (label: string, amount: string, at: number, opts: { bold?: boolean; muted?: boolean } = {}) => {
    const p = interpolate(frame, [at, at + 10], [0, 1], clamp)
    return (
      <div
        key={label}
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: (opts.bold ? 38 : 30) * u,
          fontWeight: opts.bold ? 700 : 400,
          color: opts.muted ? C.muted : C.text,
          padding: `${12 * u}px 0`,
          borderTop: opts.bold ? `1px solid ${C.border}` : undefined,
          marginTop: opts.bold ? 10 * u : 0,
          opacity: p,
          transform: `translateY(${(1 - p) * 20 * u}px)`,
        }}
      >
        <span>{label}</span>
        <span style={{ color: opts.bold ? C.greenBright : undefined }}>{amount}</span>
      </div>
    )
  }
  return (
    <AbsoluteFill>
      <Stage>
        <div style={{ position: "relative", width: 640 * u, height: 700 * u, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Totals */}
          <div style={{ position: "absolute", opacity: card * (1 - toQr), transform: `scale(${1 - toQr * 0.15}) translateY(${(1 - card) * 60 * u}px)`, filter: `blur(${toQr * 12 * u}px)` }}>
            <Card width={620}>
              <div style={{ fontSize: 24 * u, color: C.muted, marginBottom: 12 * u }}>Finish &amp; get paid · Jordan</div>
              {line("Haircut", "$40.00", 8)}
              {line("Beard trim", "$15.00", 16)}
              {line("Already paid", "−$10.00", 24, { muted: true })}
              {line("Due today", "$45.00", 32, { bold: true })}
            </Card>
          </div>
          {/* QR → paid */}
          <div style={{ position: "absolute", opacity: toQr, transform: `scale(${0.85 + 0.15 * toQr})` }}>
            <Card width={520} style={{ textAlign: "center", padding: 34 * u }}>
              <div style={{ position: "relative", display: "inline-block", background: "#ECEBE6", borderRadius: 28 * u, padding: 24 * u }}>
                <Qr size={360 * u} reveal={interpolate(frame, [60, 84], [0, 1], clamp)} />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 28 * u,
                    background: `rgba(22,27,30,${0.92 * paid})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div style={{ opacity: paid }}>
                    <CheckDot size={180 * u} progress={paid} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 24 * u, fontSize: 38 * u, fontWeight: 700 }}>
                {frame < 102 ? "Scan to pay · $45.00" : "Paid in full"}
              </div>
              <div style={{ fontSize: 24 * u, color: C.muted, marginTop: 6 * u, minHeight: 30 * u }}>
                {frame < 102 ? "Card, Apple Pay or Google Pay" : "Booked as income for you."}
              </div>
            </Card>
          </div>
          <RingBurst start={102} size={700 * u} count={2} />
          <div
            style={{
              position: "absolute",
              top: 20 * u,
              right: -40 * u,
              opacity: tip,
              transform: `scale(${0.5 + 0.5 * tip}) rotate(${(1 - tip) * -20 + 6}deg)`,
              background: C.green,
              color: "#fff",
              fontWeight: 700,
              fontSize: 34 * u,
              borderRadius: 999,
              padding: `${14 * u}px ${30 * u}px`,
              boxShadow: `0 0 ${50 * u}px rgba(47,168,102,0.8)`,
            }}
          >
            + $8.00 tip
          </div>
        </div>
      </Stage>
      <Caption>
        <Words text="Get paid the rest **in one scan.**" delay={10} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 29–32 s: the payment lands in the books, fees and all, and profit ticks up.
export const Books: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const chart = useIn(34)
  const draw = interpolate(frame, [40, 82], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const points = [0.62, 0.58, 0.66, 0.6, 0.5, 0.54, 0.42, 0.36, 0.3, 0.18]
  const W = 560
  const H = 170
  const path = points.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * W} ${y * H}`).join(" ")
  const profit = interpolate(frame, [40, 82], [2140, 2200.57], clamp)
  return (
    <AbsoluteFill>
      <Stage>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
          <Tag label="Haircut · Jordan" amount="$55.00" color={C.green} delay={4} />
          <Tag label="Tip" amount="$8.00" color={C.teal} delay={12} />
          <Tag label="Card fees" amount="−$2.43" color={C.violet} delay={20} negative />
          <div style={{ marginTop: 14 * u, opacity: chart, transform: `translateY(${(1 - chart) * 50 * u}px)` }}>
            <Card width={640} style={{ padding: 30 * u }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 24 * u, color: C.muted }}>Profit · this month</span>
                <span style={{ fontSize: 22 * u, color: C.greenBright }}>↗ updated just now</span>
              </div>
              <div style={{ fontSize: 56 * u, fontWeight: 700, margin: `${6 * u}px 0 ${14 * u}px` }}>
                ${profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <svg width={W * u} height={H * u} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
                <defs>
                  <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={C.green} stopOpacity="0.35" />
                    <stop offset="1" stopColor={C.green} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${path} L${W} ${H} L0 ${H} Z`} fill="url(#fill)" opacity={draw} />
                <path d={path} fill="none" stroke={C.greenBright} strokeWidth={4} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
              </svg>
            </Card>
          </div>
        </div>
      </Stage>
      <Caption>
        <Words text="Already **in your books.**" delay={8} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 32–36 s: grid of glowing circles, two "no more" lines, then the logo.
export const Ending: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const gridOut = interpolate(frame, [60, 74], [1, 0], clamp)
  const logo = useIn(70, 15, 100)
  const cols = 7
  const rows = 12
  const size = 170 * u
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: gridOut, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols * 2}, ${size}px)`, gap: 10 * u }}>
          {Array.from({ length: cols * 2 * rows }).map((_, i) => {
            const c = i % (cols * 2)
            const r = Math.floor(i / (cols * 2))
            const wave = Math.sin((frame - c * 3 - r * 2) / 9)
            const mix = (c / (cols * 2) + r / rows) / 2
            return (
              <div
                key={i}
                style={{
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 35% 30%, ${mix < 0.5 ? C.greenBright : C.teal}, ${C.deep} 75%)`,
                  transform: `scale(${0.78 + wave * 0.14})`,
                  opacity: 0.55 + wave * 0.25,
                }}
              />
            )
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: gridOut }}>
        <div style={{ background: "rgba(11,15,17,0.55)", padding: `${24 * u}px ${44 * u}px`, borderRadius: 999, filter: "blur(0px)" }}>
          {frame < 32 ? (
            <Words text="No more chasing payments." delay={2} size={56} />
          ) : (
            <Words text="No more **messy books.**" delay={32} size={56} />
          )}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 40 * u }}>
        <div style={{ opacity: logo, transform: `scale(${0.8 + 0.2 * logo})`, filter: `blur(${(1 - logo) * 16 * u}px)` }}>
          <Wordmark width={380 * u} />
        </div>
        {frame >= 78 ? <Words text="Booked. Paid. **Done.**" delay={80} size={58} stagger={5} weight={400} /> : null}
        {frame >= 92 ? (
          <div style={{ opacity: interpolate(frame, [92, 104], [0, 1], clamp) }}>
            <Words text="the521app.com" delay={92} size={30} style={{ color: C.muted }} />
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
