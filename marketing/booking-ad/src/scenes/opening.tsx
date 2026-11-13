import React from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion"
import { C } from "../theme"
import { Caption, Stage, Words, clamp, useIn } from "../components/motion"
import { Bubble, GlassIcon } from "../components/ui"
import { RingBurst, Wordmark } from "../components/backdrop"
import { useUnit } from "../theme"

// 0–7 s: the old way. Three glass apps float, then pull apart as messages pile up.
export const Opening: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const apart = interpolate(frame, [118, 150], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const icons = [
    { name: "calendar" as const, label: "Booking app", x: -300 },
    { name: "card" as const, label: "Payments app", x: 0 },
    { name: "sheet" as const, label: "Spreadsheet", x: 300 },
  ]
  const firstLine = interpolate(frame, [104, 118], [1, 0], clamp)
  return (
    <AbsoluteFill>
      <Stage>
        {icons.map((icon, i) => {
          const p = useIn(4 + i * 6, 16, 90)
          const bob = Math.sin((frame + i * 20) / 22) * 14 * u
          const rot = Math.sin((frame + i * 30) / 40) * 14
          return (
            <div
              key={icon.name}
              style={{
                position: "absolute",
                transform: `translate(${(icon.x + icon.x * apart * 0.55) * u}px, ${bob + (1 - p) * 160 * u + apart * (i - 1) * 60 * u}px) perspective(${900 * u}px) rotateY(${rot + (i - 1) * 12}deg) rotateZ(${apart * (i - 1) * 18}deg) scale(${1 - apart * 0.25})`,
                opacity: p * (1 - apart * 0.65),
                filter: `blur(${apart * 6 * u}px)`,
              }}
            >
              <GlassIcon name={icon.name} label={icon.label} size={210 * u} glow={i === 1 ? 0.25 : 0} />
            </div>
          )
        })}
        <Bubble from="Client · text" text="Can I move to 3?" delay={128} x={-200} y={-250} rot={-6} />
        <Bubble from="Client · DM" text="Did you get my Venmo?" delay={140} x={210} y={-90} rot={5} />
        <Bubble from="Client · text" text="Anything open Friday?" delay={152} x={-170} y={80} rot={-3} />
        <Bubble from="Note to self" text="Update the spreadsheet…" delay={164} x={190} y={250} rot={4} />
      </Stage>
      <Caption>
        <div style={{ opacity: firstLine, position: frame >= 118 ? "absolute" : "relative" }}>
          <Words text="Running your business is supposed to be **simple.**" delay={14} size={62} />
        </div>
        {frame >= 118 ? <Words text="Three apps. **Zero** of them talk." delay={122} size={62} /> : null}
      </Caption>
    </AbsoluteFill>
  )
}

// 7–9 s: a sweep of green light reveals the wordmark.
export const LogoReveal: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const p = useIn(10, 14, 100)
  const sweep = interpolate(frame, [0, 34], [-60, 160], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(105deg, transparent ${sweep - 30}%, rgba(61,220,132,0.35) ${sweep}%, transparent ${sweep + 30}%)`,
          filter: "blur(30px)",
        }}
      />
      <RingBurst start={10} size={700 * u} />
      <div style={{ transform: `scale(${0.7 + 0.3 * p})`, opacity: p, filter: `blur(${(1 - p) * 20 * u}px)` }}>
        <Wordmark width={420 * u} />
      </div>
      <div style={{ position: "absolute", bottom: "26%", color: C.muted }}>
        <Words text="Booking. Payments. Books. **One app.**" delay={22} size={40} stagger={2} />
      </div>
    </AbsoluteFill>
  )
}
