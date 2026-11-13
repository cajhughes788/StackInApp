import React from "react"
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { C, fontFamily, useUnit } from "../theme"
import { Caption, Words, clamp, useIn } from "../components/motion"
import { Aurora, Wordmark } from "../components/backdrop"
import { Chip, Icon } from "../components/ui"
import { Palace, camAt, screenOf, useCastleLayout, type PieceState } from "./Palace"
import { FEATURES } from "./flows"
import type { PartId } from "./parts"

export const CASTLE_DURATION = 1680 // 56 s

// --- Timeline (frames at 30 fps) ---------------------------------------------
const T = {
  logo: 196,
  foundation: [252, 334],
  money: 345,
  income: 482,
  stairs: [566, 628],
  expenses: 632,
  tagFall: 674, // first expense tag starts falling
  tagEvery: 7,
  tagTravel: 18,
  features: [832, 982, 1132, 1282], // booking, invoices, payments, receipts
  keep: [1446, 1506],
  finale: 1508,
  end: 1566,
}

// Feature window beats, from its start.
const W = { open: 12, flow: 14, fold: 104, land: 124, built: 162 }

// Camera: [frame, focus x, focus y, zoom], image pixels.
const CAM: Array<[number, number, number, number]> = [
  [0, 512, 560, 1.0],
  [240, 512, 640, 1.05],
  [334, 512, 720, 1.18],
  [482, 512, 720, 1.18],
  [522, 495, 770, 1.32],
  [628, 495, 770, 1.32],
  [668, 505, 585, 1.1],
  [832, 505, 585, 1.1],
  [880, 215, 470, 1.3],
  [996, 215, 470, 1.3],
  [1030, 370, 330, 1.3],
  [1146, 370, 330, 1.3],
  [1180, 655, 330, 1.3],
  [1296, 655, 330, 1.3],
  [1330, 850, 540, 1.3],
  [1446, 850, 540, 1.3],
  [1480, 512, 330, 1.15],
  [1524, 512, 500, 0.98],
  [1606, 512, 700, 0.62],
  [1680, 512, 700, 0.6],
]

// Where each feature's tower stands (its base, image pixels).
const TOWER_BASE: Record<string, [number, number]> = {
  booking: [194, 600],
  invoices: [366, 390],
  payments: [660, 400],
  receipts: [853, 680],
}

const pulse = (frame: number, ats: number[]) => Math.max(0, ...ats.map((at) => interpolate(frame, [at, at + 4, at + 24], [0, 1, 0], clamp)))
const ramp = (frame: number, [a, b]: number[]) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) })

// --- Data --------------------------------------------------------------------

const PAYMENTS = [
  { app: "Venmo", amount: "+$120.00", x: -160, y: -300, rot: -7 },
  { app: "Apple Pay", amount: "+$45.00", x: 170, y: -180, rot: 5 },
  { app: "Zelle", amount: "+$60.00", x: -130, y: -60, rot: -3 },
  { app: "Square", amount: "+$80.00", x: 175, y: 60, rot: 7 },
  { app: "Cash App", amount: "+$35.00", x: -175, y: 180, rot: -8 },
  { app: "Stripe", amount: "+$250.00", x: 140, y: 300, rot: 4 },
]

const MONEY = [
  { label: "Client payment", amount: "+$312.00", from: 0, income: true },
  { label: "Supplies", amount: "−$84.20", from: 1, income: false },
  { label: "Venmo", amount: "+$120.00", from: 0, income: true },
  { label: "Software", amount: "−$9.99", from: 1, income: false },
  { label: "Card / POS", amount: "+$45.00", from: 1, income: true },
  { label: "Rent", amount: "−$450.00", from: 0, income: false },
  { label: "Zelle", amount: "+$60.00", from: 0, income: true },
  { label: "Marketing", amount: "−$25.00", from: 1, income: false },
]

// Income: the app's categories, then how you were paid (shared/independentIncome.ts).
const INCOME = ["Services", "Tips", "Products", "Other", "Cash", "Card / POS", "Venmo", "Zelle", "Apple Cash", "Cash App", "Check"]

// Expenses: the app's 19 categories (shared/expenseCategories.ts).
const EXPENSES = [
  "Supplies", "Rent / Booth Rent", "Equipment", "Marketing & Advertising", "Software & Subscriptions", "Insurance",
  "Interest on Loan", "Travel", "Vehicle & Transportation", "Utilities", "Professional Fees", "Subcontractor Work",
  "Cleaning & Sanitation", "Education & Training", "Work Clothing", "Payment Processing Fees", "Taxes & Licenses",
  "Office Expenses", "Miscellaneous / Other",
]
const TAG_COLORS = [C.green, C.amber, C.violet, C.teal, C.rose, C.blue]

// --- Small pieces ----------------------------------------------------------------

const Pill: React.FC<{ text: string; color: string; style?: React.CSSProperties }> = ({ text, color, style }) => {
  const u = useUnit()
  return (
    <span
      style={{
        display: "inline-block",
        background: color,
        color: "#fff",
        fontFamily,
        fontSize: 22 * u,
        fontWeight: 600,
        borderRadius: 999,
        padding: `${8 * u}px ${18 * u}px`,
        whiteSpace: "nowrap",
        boxShadow: `0 0 ${20 * u}px ${color}77`,
        ...style,
      }}
    >
      {text}
    </span>
  )
}

// Rings bursting at a screen point.
const Burst: React.FC<{ x: number; y: number; at: number; size?: number }> = ({ x, y, at, size = 260 }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  if (frame < at || frame > at + 40) return null
  return (
    <>
      {[0, 6].map((d) => {
        const p = interpolate(frame, [at + d, at + d + 30], [0, 1], clamp)
        const r = size * u * (0.1 + p)
        return (
          <div
            key={d}
            style={{
              position: "absolute",
              left: x - r / 2,
              top: y - r / 2,
              width: r,
              height: r,
              borderRadius: "50%",
              border: `${3 * u}px solid ${C.greenBright}`,
              opacity: p === 0 ? 0 : (1 - p) * 0.9,
              boxShadow: `0 0 ${30 * u}px ${C.greenBright}`,
            }}
          />
        )
      })}
    </>
  )
}

// Something flying from a to b over [start, start+dur], fading in the last third.
function fly(frame: number, start: number, dur: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const p = interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
  return {
    p,
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
    opacity: frame < start ? 1 : interpolate(p, [0.65, 1], [1, 0], clamp),
  }
}

// --- The ad ----------------------------------------------------------------------

export const CastleAd: React.FC<{ plan: boolean }> = ({ plan }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const u = useUnit()
  const layout = useCastleLayout()
  const cam = camAt(frame, CAM)
  const at = (f: number, x: number, y: number) => screenOf(x, y, camAt(f, CAM), layout)
  const topY = height * 0.13

  // Money landings, for the foundation's flashes.
  const moneyLand = MONEY.map((_, i) => T.money + 30 + i * 11 + 26)
  const expenseLand = EXPENSES.map((_, i) => T.tagFall + i * T.tagEvery + T.tagTravel)

  const feature = (i: number) => T.features[i]
  const pieces: Record<PartId, PieceState> = {
    foundation: {
      progress: ramp(frame, T.foundation),
      flash: Math.max(pulse(frame, moneyLand) * 0.6, pulse(frame, [...T.features.map((f) => f + W.built), T.finale, T.finale + 18])),
    },
    stairs: { progress: ramp(frame, T.stairs), flash: pulse(frame, [T.stairs[1], T.finale + 6]) },
    hall: {
      progress: interpolate(frame, [expenseLand[0] - 4, expenseLand[expenseLand.length - 1] + 6], [0, 1], clamp),
      flash: Math.max(pulse(frame, expenseLand) * 0.35, pulse(frame, [T.finale + 10])),
    },
    booking: { progress: ramp(frame, [feature(0) + W.land - 2, feature(0) + W.built]), flash: pulse(frame, [feature(0) + W.built, T.finale + 14]) },
    invoices: { progress: ramp(frame, [feature(1) + W.land - 2, feature(1) + W.built]), flash: pulse(frame, [feature(1) + W.built, T.finale + 14]) },
    payments: { progress: ramp(frame, [feature(2) + W.land - 2, feature(2) + W.built]), flash: pulse(frame, [feature(2) + W.built, T.finale + 14]) },
    receipts: { progress: ramp(frame, [feature(3) + W.land - 2, feature(3) + W.built]), flash: pulse(frame, [feature(3) + W.built, T.finale + 14]) },
    keep: { progress: ramp(frame, T.keep), flash: pulse(frame, [T.keep[1], T.finale + 20]) },
  }

  // Push the castle back while a feature window is open.
  const behind = Math.max(
    ...T.features.map((f) => interpolate(frame, [f, f + W.open, f + W.fold, f + W.land - 6], [0, 1, 1, 0], clamp)),
  )
  const planOpacity = plan ? interpolate(frame, [236, 262], [0, 0.08], clamp) : 0
  const glow = interpolate(frame, [0, 190, 260, 1440, 1520, 1600], [0.2, 0.22, 0.45, 0.45, 0.95, 0.75], clamp)

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Aurora glow={glow} />
      <Palace pieces={pieces} cam={cam} plan={planOpacity} dim={behind * 0.55} blur={behind * 6 * u} />
      {/* Keeps captions readable over the castle. */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(6,9,10,0.85) 0%, rgba(6,9,10,0.5) 16%, rgba(6,9,10,0) 32%)" }} />

      {/* 1. Hook: every way you get paid, nowhere to put it */}
      <Sequence durationInFrames={204}>
        <Hook />
      </Sequence>

      {/* 2. Logo, then the foundation */}
      <Sequence from={T.logo} durationInFrames={90}>
        <LogoBeat />
      </Sequence>
      <Sequence from={244} durationInFrames={100}>
        <Caption>
          <Words text="521 starts with **the books.**" delay={8} size={62} stagger={4} />
        </Caption>
      </Sequence>

      {/* 3. Money flows in from the accounts */}
      <Sequence from={T.money} durationInFrames={137}>
        <AbsoluteFill>
          <div style={{ position: "absolute", top: topY - 60 * u, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 18 * u }}>
            <Chip icon="bank" label="Checking" sub="••4821" delay={0} checkAt={14} width={360} />
            <Chip icon="card" label="Card" sub="Business ••1907" delay={8} checkAt={14} width={360} />
          </div>
          <Caption>
            <Words text="Every dollar, **sorted.**" delay={24} size={62} stagger={4} />
          </Caption>
        </AbsoluteFill>
      </Sequence>
      {MONEY.map((m, i) => {
        const start = T.money + 30 + i * 11
        const from = { x: width / 2 + (m.from === 0 ? -190 : 190) * u, y: topY + 70 * u }
        const f = fly(frame, start, 26, from, at(start + 26, 380 + i * 40, 820))
        if (frame < start || f.p >= 1) return null
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: f.x,
              top: f.y,
              transform: `translate(-50%, -50%) scale(${1 - f.p * 0.4})`,
              opacity: f.opacity,
              display: "flex",
              gap: 10 * u,
              alignItems: "center",
              background: "rgba(22,27,30,0.92)",
              border: `${1.5 * u}px solid ${m.income ? C.green : "rgba(255,255,255,0.2)"}`,
              borderRadius: 999,
              padding: `${10 * u}px ${20 * u}px`,
              fontFamily,
              fontSize: 24 * u,
              fontWeight: 600,
              color: m.income ? C.greenBright : C.text,
              whiteSpace: "nowrap",
              boxShadow: m.income ? `0 0 ${24 * u}px rgba(61,220,132,0.5)` : "none",
            }}
          >
            {m.amount}
            <span style={{ color: C.muted, fontWeight: 500 }}>{m.label}</span>
          </div>
        )
      })}

      {/* 4. Income: the categories crumble into the stairs */}
      <Sequence from={T.income} durationInFrames={150}>
        <Caption>
          <Words text="Every way **you earn.**" delay={6} size={62} stagger={4} />
        </Caption>
      </Sequence>
      <IncomeCloud topY={topY} target={at(T.stairs[0] + 10, 490, 820)} />

      {/* 5. Expenses: each category becomes part of the great hall */}
      <Sequence from={T.expenses} durationInFrames={200}>
        <Caption>
          <Words text="Every cost, **in its place.**" delay={6} size={62} stagger={4} />
        </Caption>
      </Sequence>
      <ExpenseCloud topY={topY} at={at} />

      {/* 6–9. Features open, play, fold, and become towers */}
      {FEATURES.map((f, i) => {
        const start = T.features[i]
        const [bx, by] = TOWER_BASE[f.id]
        const land = at(start + W.land, bx, by)
        return (
          <React.Fragment key={f.id}>
            <Sequence from={start} durationInFrames={W.land + 2}>
              <FeatureWindow title={f.title} icon={f.icon} Flow={f.Flow} land={land} />
            </Sequence>
            <Sequence from={start + 4} durationInFrames={146}>
              <Caption bottom={0.07}>
                <Words text={f.caption} delay={4} size={60} stagger={4} />
              </Caption>
            </Sequence>
            <Burst x={land.x} y={land.y} at={start + W.land} />
          </React.Fragment>
        )
      })}

      {/* 10. The keep rises; everything connects */}
      <Sequence from={T.keep[0] + 4} durationInFrames={T.end - T.keep[0] - 4}>
        <Caption bottom={0.07}>
          <Words text="Every feature, built from **the foundation of your books.**" delay={14} size={58} stagger={4} />
        </Caption>
      </Sequence>

      {/* 11. End card */}
      <Sequence from={T.end}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  )
}

// --- Scenes --------------------------------------------------------------------

const Hook: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const tall = height > width * 1.5
  const firstOut = interpolate(frame, [100, 112], [1, 0], clamp)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: tall ? "translateY(-6%)" : "translateY(-12%) scale(0.72)" }}>
        {PAYMENTS.map((pay, i) => {
          const p = useIn(6 + i * 11, 13, 160)
          const fall = Math.max(0, frame - (128 + i * 4))
          return (
            <div
              key={pay.app}
              style={{
                position: "absolute",
                transform: `translate(${pay.x * u}px, ${pay.y * u + fall * fall * 0.9 * u}px) rotate(${pay.rot + fall * (i % 2 ? 0.6 : -0.6)}deg) scale(${0.6 + 0.4 * p})`,
                opacity: p * interpolate(fall, [0, 30], [1, 0], clamp),
                filter: `blur(${interpolate(fall, [0, 30], [0, 10], clamp) * u}px)`,
                width: 470 * u,
                display: "flex",
                alignItems: "center",
                gap: 18 * u,
                padding: `${18 * u}px ${22 * u}px`,
                borderRadius: 28 * u,
                background: "rgba(30,36,40,0.92)",
                border: `${1.5 * u}px solid rgba(255,255,255,0.14)`,
                boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.55)`,
                fontFamily,
                color: C.text,
              }}
            >
              <div
                style={{
                  width: 60 * u,
                  height: 60 * u,
                  borderRadius: 18 * u,
                  background: "rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28 * u,
                  fontWeight: 700,
                }}
              >
                {pay.app[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 24 * u, fontWeight: 600 }}>{pay.app}</div>
                <div style={{ fontSize: 20 * u, color: C.muted }}>Payment received</div>
              </div>
              <div style={{ fontSize: 30 * u, fontWeight: 700, color: C.greenBright }}>{pay.amount}</div>
            </div>
          )
        })}
      </AbsoluteFill>
      <Caption>
        <div style={{ opacity: firstOut, position: frame >= 112 ? "absolute" : "relative" }}>
          <Words text="Most apps help you **get paid…**" delay={14} size={64} stagger={4} />
        </div>
        {frame >= 108 ? <Words text="…then leave you to **sort out the books.**" delay={112} size={64} stagger={4} /> : null}
      </Caption>
    </AbsoluteFill>
  )
}

const LogoBeat: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { height } = useVideoConfig()
  const p = useIn(4, 14, 90)
  const lift = interpolate(frame, [44, 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const sweep = interpolate(frame, [0, 36], [-60, 160], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(105deg, transparent ${sweep - 30}%, rgba(61,220,132,0.28) ${sweep}%, transparent ${sweep + 30}%)`,
          filter: "blur(30px)",
          opacity: 1 - lift,
        }}
      />
      <div
        style={{
          transform: `translateY(${-lift * height * 0.3}px) scale(${(0.75 + 0.25 * p) * (1 - lift * 0.5)})`,
          opacity: p * (1 - lift),
          filter: `blur(${(1 - p) * 20 * u + lift * 8 * u}px)`,
        }}
      >
        <Wordmark width={400 * u} />
      </div>
    </AbsoluteFill>
  )
}

// Income tags gather, crack, and rain down into the stairs.
const IncomeCloud: React.FC<{ topY: number; target: { x: number; y: number } }> = ({ topY, target }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  if (frame < T.income || frame > T.stairs[1] + 10) return null
  const local = frame - T.income
  const cols = 4
  return (
    <AbsoluteFill>
      {INCOME.map((name, i) => {
        const appear = interpolate(local, [i * 2, i * 2 + 12], [0, 1], clamp)
        const crack = 50 + (i % 5) * 3
        const shake = local > crack - 10 && local < crack ? Math.sin(local * 3 + i) * 3 * u : 0
        const row = Math.floor(i / cols)
        const col = i % cols
        const inRow = Math.min(cols, INCOME.length - row * cols)
        const home = { x: width / 2 + (col - (inRow - 1) / 2) * 230 * u, y: topY + row * 62 * u }
        const color = i < 4 ? C.green : TAG_COLORS[(i % (TAG_COLORS.length - 1)) + 1]
        if (local < crack) {
          return (
            <div key={name} style={{ position: "absolute", left: home.x + shake, top: home.y, transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * appear})`, opacity: appear }}>
              <Pill text={name} color={color} />
            </div>
          )
        }
        // Three shards per tag, each falling on its own path.
        return [0, 1, 2].map((s) => {
          const f = fly(frame, T.income + crack + s * 2, 30, { x: home.x + (s - 1) * 40 * u, y: home.y }, { x: target.x + (i - 5) * 22 * u + (s - 1) * 14 * u, y: target.y })
          if (f.p >= 1) return null
          return (
            <div
              key={`${name}-${s}`}
              style={{
                position: "absolute",
                left: f.x,
                top: f.y,
                width: 44 * u,
                height: 22 * u,
                transform: `translate(-50%, -50%) rotate(${(s - 1) * 40 * f.p + i * 9}deg) scale(${1 - f.p * 0.5})`,
                borderRadius: 6 * u,
                background: color,
                opacity: f.opacity,
                boxShadow: `0 0 ${24 * u}px ${color}`,
              }}
            />
          )
        })
      })}
    </AbsoluteFill>
  )
}

// Expense tags line up, then fall one by one into the hall, left to right.
const ExpenseCloud: React.FC<{ topY: number; at: (f: number, x: number, y: number) => { x: number; y: number } }> = ({ topY, at }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  if (frame < T.expenses || frame > T.tagFall + EXPENSES.length * T.tagEvery + T.tagTravel + 4) return null
  const local = frame - T.expenses
  const cols = 4
  return (
    <AbsoluteFill>
      {EXPENSES.map((name, i) => {
        const appear = interpolate(local, [i * 1.6, i * 1.6 + 12], [0, 1], clamp)
        const row = Math.floor(i / cols)
        const col = i % cols
        const inRow = Math.min(cols, EXPENSES.length - row * cols)
        const home = { x: width / 2 + (col - (inRow - 1) / 2) * 250 * u, y: topY - 30 * u + row * 54 * u }
        const start = T.tagFall + i * T.tagEvery
        const land = start + T.tagTravel
        const targetX = 270 + (i / (EXPENSES.length - 1)) * 520
        const f = fly(frame, start, T.tagTravel, home, at(land, targetX, 600 - (i / 18) * 20))
        if (f.p >= 1) return null
        const color = TAG_COLORS[i % TAG_COLORS.length]
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: f.x,
              top: f.y,
              transform: `translate(-50%, -50%) scale(${(0.7 + 0.3 * appear) * (1 - f.p * 0.55)})`,
              opacity: appear * f.opacity,
            }}
          >
            <Pill text={name} color={color} style={{ fontSize: 19 * u }} />
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

// A feature window: opens, plays its flow, folds into a glowing cube, and drops
// onto its tower's base.
const FeatureWindow: React.FC<{ title: string; icon: React.ComponentProps<typeof Icon>["name"]; Flow: React.FC; land: { x: number; y: number } }> = ({
  title,
  icon,
  Flow,
  land,
}) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const open = useIn(0, 16, 140)
  const fold = interpolate(frame, [W.fold, W.fold + 12], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const drop = interpolate(frame, [W.fold + 8, W.land], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
  const home = { x: width / 2, y: height * 0.45 }
  const x = home.x + (land.x - home.x) * drop
  const y = home.y + (land.y - home.y) * drop
  const w = 640 * u
  const h = 720 * u
  const scale = (0.9 + 0.1 * open) * (1 - fold * 0.9)
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: x - w / 2,
          top: y - h / 2,
          width: w,
          height: h,
          transform: `scale(${scale}) rotate(${fold * 45}deg)`,
          opacity: open,
          borderRadius: (36 + fold * 40) * u,
          background: `linear-gradient(165deg, rgba(36,44,48,${0.96 - fold * 0.5}), rgba(16,20,22,${0.96 - fold * 0.5}))`,
          border: `${2 * u}px solid rgba(61,220,132,${0.35 + fold * 0.6})`,
          boxShadow: `0 ${30 * u}px ${90 * u}px rgba(0,0,0,0.6), 0 0 ${(40 + fold * 120) * u}px rgba(61,220,132,${0.25 + fold * 0.6})`,
          overflow: "hidden",
          fontFamily,
          color: C.text,
        }}
      >
        <div style={{ opacity: 1 - fold, padding: 34 * u, height: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 * u, paddingBottom: 18 * u, marginBottom: 22 * u, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 52 * u, height: 52 * u, borderRadius: 16 * u, background: "rgba(47,168,102,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={30 * u} />
            </div>
            <span style={{ fontSize: 30 * u, fontWeight: 600 }}>{title}</span>
            <span style={{ marginLeft: "auto", fontSize: 20 * u, color: C.muted }}>521</span>
          </div>
          <Sequence from={W.flow} layout="none">
            <Flow />
          </Sequence>
        </div>
        <AbsoluteFill style={{ background: `radial-gradient(circle, rgba(200,255,225,${fold * 0.9}), rgba(61,220,132,${fold * 0.6}))` }} />
      </div>
    </AbsoluteFill>
  )
}

const EndCard: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const { height, width } = useVideoConfig()
  const tall = height > width * 1.5
  const logo = useIn(10, 15, 90)
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: (tall ? 0.2 : 0.07) * height }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
        <div style={{ opacity: logo, transform: `scale(${0.85 + 0.15 * logo})`, filter: `blur(${(1 - logo) * 14 * u}px)` }}>
          <Wordmark width={(tall ? 300 : 220) * u} />
        </div>
        {frame >= 22 ? <Words text="Run the business." delay={24} size={tall ? 56 : 46} stagger={5} weight={400} /> : null}
        {frame >= 36 ? <Words text="**The books run themselves.**" delay={38} size={tall ? 56 : 46} stagger={5} style={{ marginTop: -12 * u }} /> : null}
        <div style={{ opacity: interpolate(frame, [60, 72], [0, 1], clamp), fontFamily, fontSize: 28 * u, color: C.muted }}>the521app.com</div>
      </div>
    </AbsoluteFill>
  )
}

