import React from "react"
import { AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { C, fontFamily, useUnit } from "../theme"
import { Caption, Words, clamp } from "../components/motion"
import { Aurora } from "../components/backdrop"
import { CheckDot, Icon, Qr } from "../components/ui"
import { Castle, REAL, camAt, screenOf, useLayout, type Cam } from "./Castle"
import { CORNER, HALL_X, QUAD, SPOT, bayCenter, onQuad, type Pt } from "./geometry"
import { CAM, EXPENSES, PAYMENT_CARDS, T, buildAt, c01, expenseLand, expenseStart, pulse, steps } from "./timeline"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
const ramp = (frame: number, a: number, b: number, easing = Easing.inOut(Easing.cubic)) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing })

// A point a fraction of the way along a polyline.
function along(path: Pt[], t: number): Pt {
  const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]))
  let d = c01(t) * lens.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) return lerpPt(path[i], path[i + 1], lens[i] ? d / lens[i] : 0)
    d -= lens[i]
  }
  return path[path.length - 1]
}
const pathD = (path: Pt[]) => `M${path.map((p) => p.join(" ")).join(" L")}`

const LEFT_LINE: Pt[] = [[-320, 650], [310, 566], [600, 560]]
const RIGHT_LINE: Pt[] = [[1600, 650], [985, 566], [690, 560]]
const RISE: Pt = [645, 548]
const MATCH_LINE: Pt[] = [[-320, 650], [310, 566], [470, 330], [519, 290]]

// --- Shared bits ------------------------------------------------------------

const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const u = useUnit()
  return (
    <div
      style={{
        background: "linear-gradient(165deg, rgba(36,44,48,0.94), rgba(16,20,22,0.94))",
        border: `${1.5 * u}px solid rgba(255,255,255,0.14)`,
        borderRadius: 26 * u,
        boxShadow: `0 ${24 * u}px ${70 * u}px rgba(0,0,0,0.6)`,
        fontFamily,
        color: C.text,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

const At: React.FC<{ x: number; y: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, children, style }) => (
  <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", ...style }}>{children}</div>
)

const Pill: React.FC<{ text: string; color: string; size?: number }> = ({ text, color, size = 24 }) => {
  const u = useUnit()
  return (
    <span
      style={{
        display: "inline-block",
        background: color,
        color: "#fff",
        fontFamily,
        fontSize: size * u,
        fontWeight: 600,
        borderRadius: 999,
        padding: `${0.36 * size * u}px ${0.8 * size * u}px`,
        whiteSpace: "nowrap",
        boxShadow: `0 0 ${24 * u}px ${color}88`,
      }}
    >
      {text}
    </span>
  )
}

const Badge: React.FC<{ card: (typeof PAYMENT_CARDS)[number]; size: number }> = ({ card, size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background: card.color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily,
      fontWeight: 800,
      fontSize: size * 0.5,
      color: "#fff",
      flexShrink: 0,
    }}
  >
    {card.letter ?? (card.icon ? <Icon name={card.icon} size={size * 0.6} color="#fff" /> : null)}
  </div>
)

const Ring: React.FC<{ x: number; y: number; at: number; size?: number }> = ({ x, y, at, size = 240 }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  if (frame < at || frame > at + 36) return null
  return (
    <>
      {[0, 6].map((d) => {
        const p = interpolate(frame, [at + d, at + d + 28], [0, 1], clamp)
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

// --- F-space overlay: survey, ledger, cornerstone, light lines --------------

const Overlay: React.FC<{ frame: number; bays: number }> = ({ frame, bays }) => {
  // Survey lines on the empty plot (hook), then the ledger lays flat.
  const survey = interpolate(frame, [0, 20, T.ledgerFlat[0], T.ledgerFlat[1]], [0, 0.5, 0.5, 0], clamp)
  const flat = ramp(frame, T.ledgerFlat[0], T.ledgerFlat[1])
  const pageIn = interpolate(frame, [T.ledgerIn, T.ledgerIn + 14], [0, 1], clamp)
  const pageFill = interpolate(frame, [T.ledgerFlat[1], T.ledgerFlat[1] + 26], [0.85, 0], clamp)
  const gridOpacity = frame < T.ledgerIn ? 0 : pageIn * (frame < T.lines[0] ? 0.9 : 0.9 * (1 - c01(bays / 64)))
  const start = { TL: [455, 250] as Pt, TR: [825, 250] as Pt, BR: [825, 500] as Pt, BL: [455, 500] as Pt }
  const corners = {
    TL: lerpPt(start.TL, QUAD.B, flat),
    TR: lerpPt(start.TR, QUAD.R, flat),
    BR: lerpPt(start.BR, QUAD.F, flat),
    BL: lerpPt(start.BL, QUAD.L, flat),
  }
  const P = (s: number, t: number): Pt => lerpPt(lerpPt(corners.TL, corners.TR, s), lerpPt(corners.BL, corners.BR, s), t)
  const extraCols = ramp(frame, T.ledgerFlat[1] - 6, T.ledgerFlat[1] + 12)

  // The cornerstone drops into the front corner.
  const drop = interpolate(frame, T.corner, [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
  const stone = frame >= T.corner[0] && frame < T.real[1]
  const stoneGlow = 0.5 + 0.5 * pulse(frame, [T.corner[1]], 30)
  const [cx, cy] = [CORNER[0], CORNER[1] - (1 - drop) * 160]

  // Bank and card lines into the foundation.
  const lineDraw = ramp(frame, T.lines[0], T.lines[1])
  const lineFade = interpolate(frame, [T.fast[1], T.fast[1] + 20], [1, 0.25], clamp) * (frame < T.real[0] ? 1 : 0)
  const dots: Pt[] = []
  T.tx.forEach((s, i) => {
    if (frame >= s && frame < s + 12) dots.push(along(i % 2 ? RIGHT_LINE : LEFT_LINE, (frame - s) / 12))
  })
  for (let j = 0; j < 16; j++) {
    const s = T.fast[0] + j * 2.4
    if (frame >= s && frame < s + 10) dots.push(along(j % 2 ? RIGHT_LINE : LEFT_LINE, (frame - s) / 10))
  }

  // Booking: the deposit coin, and the crown ring filling up.
  const coinT = (frame - T.deposit[0]) / (T.deposit[1] - T.deposit[0])
  const coin = coinT > 0 && coinT < 1 ? along([SPOT.bookingTop, SPOT.bookingBase, [400, 530]], coinT) : null
  const ring = SPOT.bookingRing

  // Invoices: the matching payment comes up the bank line.
  const matchDraw = ramp(frame, T.matchLine[0], T.matchLine[0] + 8)
  const matchFade = interpolate(frame, [T.matched + 10, T.matched + 30], [1, 0], clamp)
  const matchT = (frame - (T.matchLine[0] + 6)) / (T.matchLine[1] - T.matchLine[0] - 6)

  // Keep: every tower and the foundation feed the keep.
  const feeds: Pt[][] = [
    [SPOT.bookingBase, [520, 420], SPOT.keepBase],
    [SPOT.invoicesBase, SPOT.keepBase],
    [SPOT.paymentsBase, SPOT.keepBase],
    [SPOT.receiptsBase, [760, 420], SPOT.keepBase],
    [SPOT.foundationCenter, SPOT.keepBase],
  ]
  const feedDraw = ramp(frame, T.keepLines[0], T.keepLines[0] + 18)
  const feedFade = interpolate(frame, [T.keepLevels[3], T.flare[1]], [1, 0], clamp)
  const flare = pulse(frame, [T.flare[0]], 24)

  return (
    <g>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Survey stakes and lines on the empty plot */}
      {survey > 0 ? (
        <g opacity={survey} stroke="#3DDC84" strokeWidth={0.8} fill="none">
          <polygon points={[QUAD.L, QUAD.F, QUAD.R, QUAD.B].map((p) => p.join(",")).join(" ")} strokeDasharray="6 5" />
          {[QUAD.L, QUAD.F, QUAD.R, QUAD.B].map((p, i) => (
            <line key={i} x1={p[0]} y1={p[1]} x2={p[0]} y2={p[1] - 18} strokeWidth={1.6} />
          ))}
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} x1={onQuad(t, 0)[0]} y1={onQuad(t, 0)[1]} x2={onQuad(t, 1)[0]} y2={onQuad(t, 1)[1]} strokeOpacity={0.4} />
          ))}
        </g>
      ) : null}

      {/* The ledger page, laying itself down as the floor grid */}
      {gridOpacity > 0 ? (
        <g opacity={gridOpacity}>
          <polygon points={[corners.TL, corners.TR, corners.BR, corners.BL].map((p) => p.join(",")).join(" ")} fill="rgba(14,36,28,1)" fillOpacity={pageFill} stroke="#3DDC84" strokeWidth={1.4} />
          <line x1={P(0, 0.12)[0]} y1={P(0, 0.12)[1]} x2={P(1, 0.12)[0]} y2={P(1, 0.12)[1]} stroke="#3DDC84" strokeWidth={1.2} strokeOpacity={1 - flat * 0.7} />
          {Array.from({ length: 7 }, (_, i) => (i + 1) / 8).map((t) => (
            <line key={`r${t}`} x1={P(0, t)[0]} y1={P(0, t)[1]} x2={P(1, t)[0]} y2={P(1, t)[1]} stroke="#3DDC84" strokeWidth={0.7} strokeOpacity={0.7} />
          ))}
          {[0.25, 0.5, 0.75].map((s) => (
            <line key={`c${s}`} x1={P(s, 0)[0]} y1={P(s, 0)[1]} x2={P(s, 1)[0]} y2={P(s, 1)[1]} stroke="#3DDC84" strokeWidth={0.7} strokeOpacity={0.7} />
          ))}
          {[0.125, 0.375, 0.625, 0.875].map((s) => (
            <line key={`e${s}`} x1={P(s, 0)[0]} y1={P(s, 0)[1]} x2={P(s, 1)[0]} y2={P(s, 1)[1]} stroke="#3DDC84" strokeWidth={0.7} strokeOpacity={0.7 * extraCols} />
          ))}
          {/* Numbers in the ledger's rows, gone once it's the floor */}
          {Array.from({ length: 6 }, (_, r) => {
            const t = 0.2 + r * 0.13
            return [0.05, 0.55, 0.8].map((s, k) => {
              const a = P(s, t)
              const b = P(s + (k ? 0.14 : 0.32), t)
              return <line key={`n${r}${k}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={k === 1 ? "#3DDC84" : "#DFFFEA"} strokeWidth={3} strokeLinecap="round" strokeOpacity={pageFill * 0.8} />
            })
          })}
        </g>
      ) : null}

      {/* Bank and card lines, running under the site */}
      {frame >= T.lines[0] && lineFade > 0 ? (
        <g filter="url(#glow)" opacity={lineFade}>
          {[LEFT_LINE, RIGHT_LINE].map((path, i) => (
            <path key={i} d={pathD(path)} fill="none" stroke="#3DDC84" strokeWidth={2.2} strokeDasharray="4 4" pathLength={1} style={{ strokeDasharray: `${lineDraw} 1` }} />
          ))}
          {[along(LEFT_LINE, 0.18), along(RIGHT_LINE, 0.18)].map((p, i) => (
            <g key={`src${i}`} opacity={lineDraw}>
              <circle cx={p[0]} cy={p[1]} r={9} fill="#0B1512" stroke="#3DDC84" strokeWidth={1.4} />
              <text x={p[0]} y={p[1] + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#DFFFEA" fontFamily={fontFamily}>
                {i === 0 ? "BANK" : "CARD"}
              </text>
            </g>
          ))}
          {dots.map((d, i) => (
            <circle key={i} cx={d[0]} cy={d[1]} r={4} fill="#F4FFF8" />
          ))}
        </g>
      ) : null}

      {/* The cornerstone */}
      {stone ? (
        <g transform={`translate(${cx} ${cy})`} opacity={interpolate(frame, [T.corner[0], T.corner[0] + 4, T.real[0], T.real[0] + 20], [0, 1, 1, 0], clamp)} filter="url(#glow)">
          <polygon points="0,-9 16,-1 0,7 -16,-1" fill="#1B3A2D" stroke="#7CFFB2" strokeWidth={1.2} />
          <polygon points="-16,-1 0,7 0,24 -16,16" fill="#10271E" stroke="#7CFFB2" strokeWidth={1.2} />
          <polygon points="0,7 16,-1 16,16 0,24" fill="#16352A" stroke="#7CFFB2" strokeWidth={1.2} />
          <text transform="matrix(1 -0.5 0 1 3 18)" fontSize={7.5} fontWeight={800} fill="#DFFFEA" fontFamily={fontFamily} opacity={stoneGlow}>
            521
          </text>
        </g>
      ) : null}

      {/* Booking: deposit coin, crown ring */}
      {coin ? <circle cx={coin[0]} cy={coin[1]} r={5} fill="#F4FFF8" filter="url(#glow)" /> : null}
      {frame >= T.ring && frame < T.real[0] + 20
        ? Array.from({ length: 12 }, (_, i) => {
            const on = interpolate(frame, [T.ring + i * 3, T.ring + i * 3 + 5], [0, 1], clamp)
            const a = (i / 12) * Math.PI * 2
            const front = Math.sin(a) > -0.2
            return (
              <rect
                key={i}
                x={ring.cx + ring.rx * Math.cos(a) - 2.5}
                y={ring.cy + ring.ry * Math.sin(a) - 3}
                width={5}
                height={6}
                rx={1}
                fill="#F4FFF8"
                opacity={on * (front ? 1 : 0.35) * interpolate(frame, [T.real[0], T.real[0] + 20], [1, 0], clamp)}
                filter="url(#glow)"
              />
            )
          })
        : null}

      {/* Invoices: the payment comes up the bank line to meet its invoice */}
      {frame >= T.matchLine[0] && matchFade > 0 ? (
        <g filter="url(#glow)" opacity={matchFade}>
          <path d={pathD(MATCH_LINE)} fill="none" stroke="#3DDC84" strokeWidth={2} pathLength={1} style={{ strokeDasharray: `${matchDraw} 1` }} />
          {matchT > 0 && matchT < 1 ? <circle cx={along(MATCH_LINE, matchT)[0]} cy={along(MATCH_LINE, matchT)[1]} r={5} fill="#F4FFF8" /> : null}
        </g>
      ) : null}

      {/* Keep: everything feeds it */}
      {frame >= T.keepLines[0] && feedFade > 0 ? (
        <g filter="url(#glow)" opacity={feedFade}>
          {feeds.map((path, i) => {
            const t = (frame - (T.keepLines[0] + 14 + i * 2)) / 18
            return (
              <g key={i}>
                <path d={pathD(path)} fill="none" stroke="#3DDC84" strokeWidth={1.8} pathLength={1} style={{ strokeDasharray: `${feedDraw} 1` }} />
                {t > 0 && t < 1 ? <circle cx={along(path, t)[0]} cy={along(path, t)[1]} r={4.5} fill="#F4FFF8" /> : null}
              </g>
            )
          })}
        </g>
      ) : null}
      {flare > 0 ? (
        <g>
          <circle cx={SPOT.antenna[0]} cy={SPOT.antenna[1]} r={6 + flare * 40} fill="#E9FFF2" opacity={flare * 0.35} filter="url(#glow)" />
          <circle cx={SPOT.antenna[0]} cy={SPOT.antenna[1]} r={5} fill="#FFFFFF" opacity={flare} filter="url(#glow)" />
        </g>
      ) : null}
    </g>
  )
}

// --- Scene pieces in screen space -------------------------------------------

// 1. Payments land as loose bricks on the empty plot, stack crooked, and collapse.
const HookPile: React.FC<{ cam: Cam }> = ({ cam }) => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { height } = useVideoConfig()
  const layout = useLayout()
  const plot = screenOf(SPOT.plot, cam, layout)
  const pile = [
    [-70, 0, -6], [80, -6, 5], [5, -54, -3], [-50, -104, 8], [60, -116, -10], [-5, -164, 4], [30, -212, -7],
  ]
  const wobble = frame > 100 && frame < 118 ? Math.sin(frame * 1.4) * 4 : 0
  return (
    <AbsoluteFill>
      {PAYMENT_CARDS.map((card, i) => {
        const start = 8 + i * 10
        const land = start + 16
        const fall = interpolate(frame, [start, land], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
        const brick = ramp(frame, land - 2, land + 6)
        const [ox, oy, rot] = pile[i]
        const collapse = Math.max(0, frame - (116 + i * 2))
        const x = plot.x + ox * u + (collapse ? (i % 2 ? 1 : -1) * collapse * 6 * u : 0)
        const y = lerp(-140 * u, plot.y + oy * u, fall) + (collapse ? collapse * collapse * 1.1 * u : 0)
        if (frame < start) return null
        const w = lerp(400, 190, brick) * u
        const h = lerp(84, 56, brick) * u
        return (
          <div
            key={card.app}
            style={{
              position: "absolute",
              left: x - w / 2,
              top: y - h / 2,
              width: w,
              height: h,
              transform: `rotate(${(rot + wobble * (i / 3)) * brick + (collapse ? collapse * (i % 2 ? 3 : -3) : 0)}deg)`,
              opacity: interpolate(collapse, [0, 18], [1, 0], clamp),
              filter: `blur(${interpolate(collapse, [0, 18], [0, 6], clamp) * u}px)`,
              display: "flex",
              alignItems: "center",
              gap: 12 * u,
              padding: `0 ${14 * u}px`,
              boxSizing: "border-box",
              borderRadius: lerp(22, 6, brick) * u,
              background: brick > 0.5 ? "rgba(18,44,34,0.85)" : "rgba(30,36,40,0.94)",
              border: `${1.5 * u}px solid ${brick > 0.5 ? "rgba(124,255,178,0.8)" : "rgba(255,255,255,0.14)"}`,
              boxShadow: brick > 0.5 ? `0 0 ${18 * u}px rgba(61,220,132,0.5), inset 0 0 ${12 * u}px rgba(61,220,132,0.25)` : `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.55)`,
              fontFamily,
              color: C.text,
              overflow: "hidden",
            }}
          >
            <Badge card={card} size={lerp(52, 32, brick) * u} />
            <div style={{ flex: 1, minWidth: 0, opacity: 1 - brick }}>
              <div style={{ fontSize: 24 * u, fontWeight: 600, whiteSpace: "nowrap" }}>{card.app}</div>
              <div style={{ fontSize: 18 * u, color: C.muted }}>Payment received</div>
            </div>
            <div style={{ fontSize: lerp(28, 22, brick) * u, fontWeight: 700, color: C.greenBright, whiteSpace: "nowrap" }}>{card.amount}</div>
          </div>
        )
      })}
      {/* Dust as the pile goes */}
      {frame > 118 && frame < 150
        ? Array.from({ length: 22 }, (_, i) => {
            const p = (frame - 118) / 32
            const a = (i / 22) * Math.PI - Math.PI
            const r = (60 + (i % 5) * 30) * u * p
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: plot.x + Math.cos(a) * r * 1.6,
                  top: plot.y - 60 * u + Math.sin(a) * r * 0.5 + p * 80 * u,
                  width: 6 * u,
                  height: 6 * u,
                  borderRadius: "50%",
                  background: "#7CFFB2",
                  opacity: (1 - p) * 0.7,
                  boxShadow: "0 0 8px #3DDC84",
                }}
              />
            )
          })
        : null}
      <div style={{ height }} />
    </AbsoluteFill>
  )
}

// 3. Each readable transaction rises at the foundation, gets stamped, and sets into a bay.
const Transactions: React.FC<{ cam: Cam }> = ({ cam }) => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const layout = useLayout()
  const txs = [
    { amount: "+$312.00", kind: "Income" },
    { amount: "−$84.20", kind: "Expense" },
    { amount: "+$120.00", kind: "Income" },
  ]
  return (
    <AbsoluteFill>
      {txs.map((tx, i) => {
        const s = T.tx[i]
        if (frame < s + 12 || frame > s + 28) return null
        const appear = ramp(frame, s + 12, s + 15)
        const stamp = ramp(frame, s + 16, s + 19, Easing.out(Easing.back(2)))
        const fly = ramp(frame, s + 20, s + 26, Easing.in(Easing.quad))
        const from = screenOf(RISE, cam, layout)
        const to = screenOf(bayCenter(3 * i + 1), cam, layout)
        const income = tx.kind === "Income"
        return (
          <At key={i} x={lerp(from.x, to.x, fly)} y={lerp(from.y - 70 * u, to.y, fly)} style={{ opacity: appear * (1 - fly * 0.6), transform: `translate(-50%, -50%) scale(${1 - fly * 0.7})` }}>
            <Glass style={{ display: "flex", alignItems: "center", gap: 14 * u, padding: `${12 * u}px ${18 * u}px`, borderRadius: 999 }}>
              <span style={{ fontSize: 30 * u, fontWeight: 700, color: income ? C.greenBright : C.text }}>{tx.amount}</span>
              <span style={{ transform: `scale(${stamp})`, display: "inline-block" }}>
                <Pill text={tx.kind} color={income ? C.green : "#5B646B"} size={20} />
              </span>
            </Glass>
          </At>
        )
      })}
    </AbsoluteFill>
  )
}

// 4. The monthly goal, filling as the stairs climb.
const GoalChip: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const { tall } = useLayout()
  const n = steps(frame, T.steps, 8)
  const show = interpolate(frame, [424, 440, 532, 546], [0, 1, 1, 0], clamp)
  if (show <= 0) return null
  const done = n >= 3.99
  return (
    <At x={tall ? width / 2 : width - 250 * u} y={tall ? height * 0.12 : height * 0.16} style={{ opacity: show }}>
      <Glass style={{ width: 400 * u, padding: `${20 * u}px ${24 * u}px`, border: `${1.5 * u}px solid ${done ? C.green : "rgba(255,255,255,0.14)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 22 * u, color: C.muted }}>Monthly income goal</span>
          <span style={{ fontSize: 36 * u, fontWeight: 700, color: done ? C.greenBright : C.text }}>{Math.round(n * 25)}%</span>
        </div>
        <div style={{ height: 12 * u, borderRadius: 6 * u, background: "rgba(255,255,255,0.08)", marginTop: 12 * u, overflow: "hidden" }}>
          <div style={{ width: `${n * 25}%`, height: "100%", background: `linear-gradient(90deg, ${C.green}, ${C.greenBright})`, boxShadow: `0 0 ${16 * u}px ${C.greenBright}` }} />
        </div>
      </Glass>
    </At>
  )
}

// 5. Expense categories fall into the hall's sections, left to right.
const ExpenseTags: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const layout = useLayout()
  const [x0, x1] = HALL_X
  const w = (x1 - x0) / 19
  return (
    <AbsoluteFill>
      {EXPENSES.map((name, i) => {
        const start = expenseStart(i)
        const land = expenseLand(i)
        if (frame < start - 10 || frame > land) return null
        const readable = i < 6
        const appear = ramp(frame, start - 10, start - 2)
        const fly = interpolate(frame, [start, land], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
        const sx = x0 + (i + 0.5) * w
        const target = screenOf([sx, lerp(330, 420, i / 18)], camAt(land, CAM), layout)
        const home = { x: width / 2 + (readable ? 0 : ((i % 3) - 1) * 180 * u), y: height * (layout.tall ? 0.14 : 0.12) }
        const color = [C.amber, C.violet, C.blue, C.teal, C.rose, "#5B646B"][i % 6]
        return (
          <At key={name} x={lerp(home.x, target.x, fly)} y={lerp(home.y, target.y, fly)} style={{ opacity: appear * (1 - c01((fly - 0.8) / 0.2)), transform: `translate(-50%, -50%) scale(${(0.7 + 0.3 * appear) * (1 - fly * 0.55)})` }}>
            <Pill text={name} color={color} size={readable ? 30 : 22} />
          </At>
        )
      })}
    </AbsoluteFill>
  )
}

// 5b. One receipt snaps, files itself to Supplies, and the receipts tower rises.
const ReceiptSnap: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const { tall, cx, cy } = useLayout()
  const s = T.receipt
  const appear = ramp(frame, s, s + 10)
  const flash = interpolate(frame, [s + 12, s + 14, s + 22], [0, 1, 0], clamp)
  const scan = interpolate(frame, [s + 14, s + 24], [0, 1], clamp)
  const filed = ramp(frame, s + 24, s + 28, Easing.out(Easing.back(2)))
  const fly = ramp(frame, s + 30, s + 44, Easing.in(Easing.cubic))
  if (frame < s || frame > s + 46) return null
  const home = tall ? { x: width / 2, y: height * 0.15 } : { x: cx - 330 * u, y: cy - 40 * u }
  return (
    <At x={lerp(home.x, -200 * u, fly)} y={lerp(home.y, home.y + 120 * u, fly)} style={{ opacity: appear, transform: `translate(-50%, -50%) scale(${(0.9 + 0.1 * appear) * (1 - fly * 0.6)}) rotate(${-3 + fly * -12}deg)` }}>
      <div style={{ position: "relative", width: 250 * u, background: "#ECEBE6", color: C.charcoal, borderRadius: 8 * u, padding: 20 * u, fontFamily, fontSize: 16 * u, lineHeight: 1.6, boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.6)` }}>
        <div style={{ fontWeight: 800, textAlign: "center", fontSize: 19 * u }}>PRO SUPPLY CO.</div>
        <div style={{ textAlign: "center", opacity: 0.6 }}>10/28/2026</div>
        <div style={{ borderTop: "1px dashed #999", margin: `${8 * u}px 0` }} />
        {[
          ["Color tubes x6", "54.00"],
          ["Developer", "18.50"],
          ["Foils", "11.70"],
        ].map(([a, b]) => (
          <div key={a} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{a}</span>
            <span>{b}</span>
          </div>
        ))}
        <div style={{ borderTop: "1px dashed #999", margin: `${8 * u}px 0` }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
          <span>TOTAL</span>
          <span>$84.20</span>
        </div>
        {scan > 0 && scan < 1 ? <div style={{ position: "absolute", left: -8 * u, right: -8 * u, top: `${scan * 100}%`, height: 4 * u, background: C.greenBright, boxShadow: `0 0 ${20 * u}px ${C.greenBright}` }} /> : null}
        <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash, borderRadius: 8 * u }} />
        <div style={{ position: "absolute", left: "50%", bottom: -22 * u, transform: `translateX(-50%) scale(${filed})` }}>
          <Pill text="Supplies ✓" color={C.green} size={22} />
        </div>
      </div>
    </At>
  )
}

// 6. The booking, on a phone beside the tower.
const BookingPhone: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const { tall, cx, cy } = useLayout()
  const s = T.booking
  const show = interpolate(frame, [s + 4, s + 16, T.invoices - 12, T.invoices], [0, 1, 1, 0], clamp)
  if (show <= 0) return null
  const step = frame < 776 ? 0 : frame < 804 ? 1 : frame < 832 ? 2 : 3
  const press = (at: number) => interpolate(frame, [at, at + 4, at + 9], [1, 0.93, 1], clamp)
  const pos = tall ? { x: width * 0.74, y: height * 0.24 } : { x: cx + 360 * u, y: cy }
  const row = (label: string, sub: string, on: boolean) => (
    <div key={label} style={{ background: on ? "rgba(47,168,102,0.2)" : "rgba(255,255,255,0.05)", border: `${2 * u}px solid ${on ? C.green : "transparent"}`, borderRadius: 16 * u, padding: `${12 * u}px ${14 * u}px`, marginBottom: 10 * u, transform: on ? `scale(${press(766)})` : undefined }}>
      <div style={{ fontSize: 20 * u, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15 * u, color: C.muted }}>{sub}</div>
    </div>
  )
  return (
    <At x={pos.x} y={pos.y} style={{ opacity: show, transform: `translate(-50%, -50%) translateY(${(1 - show) * 40 * u}px)` }}>
      <div style={{ width: 290 * u, height: 520 * u, borderRadius: 44 * u, padding: 10 * u, background: "linear-gradient(160deg, #3a4247, #14181b)", boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.65), 0 0 ${50 * u}px rgba(47,168,102,0.25)` }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 36 * u, background: C.charcoal, padding: `${50 * u}px ${18 * u}px ${18 * u}px`, boxSizing: "border-box", fontFamily, color: C.text }}>
          <div style={{ fontSize: 15 * u, color: C.muted }}>Jay&apos;s Cuts</div>
          {step === 0 ? (
            <>
              <div style={{ fontSize: 24 * u, fontWeight: 700, margin: `${4 * u}px 0 ${14 * u}px` }}>Book a visit</div>
              {row("Haircut", "45 min · $40", frame >= 766)}
              {row("Fade & beard", "1 hr · $55", false)}
            </>
          ) : step === 1 ? (
            <>
              <div style={{ fontSize: 24 * u, fontWeight: 700, margin: `${4 * u}px 0 ${14 * u}px` }}>Thu, Dec 4</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 * u }}>
                {["10:00", "11:30", "1:00", "2:00", "3:30", "5:00"].map((t) => {
                  const on = t === "2:00" && frame >= 794
                  return (
                    <div key={t} style={{ textAlign: "center", padding: `${12 * u}px 0`, borderRadius: 999, fontSize: 18 * u, fontWeight: 600, background: on ? C.green : "rgba(255,255,255,0.06)", transform: on ? `scale(${press(794)})` : undefined }}>
                      {t}
                    </div>
                  )
                })}
              </div>
            </>
          ) : step === 2 ? (
            <>
              <div style={{ fontSize: 24 * u, fontWeight: 700, margin: `${4 * u}px 0 ${8 * u}px` }}>Jordan Lee</div>
              <div style={{ fontSize: 16 * u, color: C.muted }}>Haircut · Thu 2pm</div>
              <div style={{ marginTop: 22 * u, background: C.green, borderRadius: 999, textAlign: "center", padding: `${16 * u}px 0`, fontWeight: 600, fontSize: 17 * u, transform: `scale(${press(822)})`, boxShadow: `0 0 ${30 * u}px rgba(47,168,102,0.5)` }}>
                Confirm &amp; pay deposit · $10
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 60 * u, gap: 14 * u }}>
              <CheckDot size={96 * u} progress={interpolate(frame, [832, 842], [0, 1], clamp)} />
              <div style={{ fontSize: 26 * u, fontWeight: 700 }}>You&apos;re booked.</div>
              <div style={{ fontSize: 16 * u, color: C.muted }}>Deposit received · $10</div>
            </div>
          )}
        </div>
      </div>
    </At>
  )
}

// 7. Invoices fly up and become the crown's fins; the last one's payment matches.
const InvoiceCards: React.FC<{ cam: Cam }> = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const layout = useLayout()
  const invoices = [
    { no: "INV-0042", who: "Jordan Lee", amt: "$250.00" },
    { no: "INV-0043", who: "Maya Ortiz", amt: "$180.00" },
    { no: "INV-0044", who: "Studio B", amt: "$600.00" },
  ]
  const matched = interpolate(frame, [T.matched, T.matched + 6, T.matched + 26, T.matched + 34], [0, 1, 1, 0], clamp)
  const base = screenOf(SPOT.invoicesBase, camAt(T.matched, CAM), layout)
  return (
    <AbsoluteFill>
      {invoices.map((inv, i) => {
        const land = T.invoiceLands[i]
        const start = land - 20
        if (frame < start - 8 || frame > land) return null
        const appear = ramp(frame, start - 8, start)
        const fly = interpolate(frame, [start, land], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
        const home = layout.tall ? { x: width * 0.7, y: height * 0.7 } : { x: layout.cx + 380 * u, y: layout.cy + 150 * u }
        const crown = screenOf(SPOT.invoicesCrown, camAt(land, CAM), layout)
        return (
          <At key={inv.no} x={lerp(home.x, crown.x, fly)} y={lerp(home.y, crown.y, fly)} style={{ opacity: appear * (1 - c01((fly - 0.85) / 0.15)), transform: `translate(-50%, -50%) scale(${1 - fly * 0.85}) rotate(${fly * -8}deg)` }}>
            <Glass style={{ width: 300 * u, padding: `${16 * u}px ${20 * u}px` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16 * u, color: C.muted }}>
                <span>{inv.no}</span>
                <span>Sent</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 * u }}>
                <span style={{ fontSize: 22 * u, fontWeight: 600 }}>{inv.who}</span>
                <span style={{ fontSize: 22 * u, fontWeight: 700 }}>{inv.amt}</span>
              </div>
            </Glass>
          </At>
        )
      })}
      {matched > 0 ? (
        <At x={base.x} y={base.y + 40 * u} style={{ opacity: matched, transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * matched})` }}>
          <Glass style={{ display: "flex", alignItems: "center", gap: 12 * u, padding: `${10 * u}px ${18 * u}px`, borderRadius: 999, border: `${1.5 * u}px solid ${C.green}` }}>
            <CheckDot size={30 * u} progress={1} />
            <span style={{ fontSize: 22 * u, fontWeight: 600 }}>Matched · Studio B $600.00</span>
          </Glass>
        </At>
      ) : null}
      <div style={{ height }} />
    </AbsoluteFill>
  )
}

// 8. The halo projects a QR; scan; the payment splits into its places.
const PaymentQr: React.FC<{ cam: Cam }> = ({ cam }) => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const layout = useLayout()
  const show = interpolate(frame, [T.qr[0], T.qr[0] + 8, T.split, T.split + 8], [0, 1, 1, 0], clamp)
  const paid = ramp(frame, T.scan, T.scan + 6)
  const halo = screenOf(SPOT.paymentsHalo, cam, layout)
  const pos = layout.tall ? { x: width * 0.72, y: height * 0.28 } : { x: layout.cx + 330 * u, y: layout.cy - 20 * u }
  const size = 230 * u
  const pieces = [
    { text: "+$45.00 Income", color: C.green, to: [560, 600] as Pt },
    { text: "+$8.00 Tip", color: C.teal, to: [690, 615] as Pt },
    { text: "−$1.84 Card fee", color: "#5B646B", to: [820, 600] as Pt },
  ]
  return (
    <AbsoluteFill>
      {show > 0 ? (
        <>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="beam" x1={halo.x} y1={halo.y} x2={pos.x} y2={pos.y} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#7CFFB2" stopOpacity={0.55} />
                <stop offset="1" stopColor="#7CFFB2" stopOpacity={0.06} />
              </linearGradient>
            </defs>
            <polygon points={`${halo.x},${halo.y} ${pos.x - size / 2},${pos.y - size / 2} ${pos.x - size / 2},${pos.y + size / 2}`} fill="url(#beam)" opacity={show} />
          </svg>
          <At x={pos.x} y={pos.y} style={{ opacity: show }}>
            <div style={{ position: "relative", background: "#ECEBE6", borderRadius: 22 * u, padding: 16 * u, boxShadow: `0 0 ${60 * u}px rgba(61,220,132,0.45)` }}>
              <Qr size={size - 32 * u} reveal={interpolate(frame, T.qr, [0, 1], clamp)} />
              <div style={{ position: "absolute", inset: 0, borderRadius: 22 * u, background: `rgba(22,27,30,${0.9 * paid})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 * u, fontFamily, color: C.text }}>
                <div style={{ opacity: paid }}>
                  <CheckDot size={90 * u} progress={paid} />
                </div>
                <div style={{ opacity: paid, fontSize: 24 * u, fontWeight: 700 }}>Paid $53.00</div>
              </div>
            </div>
          </At>
        </>
      ) : null}
      {pieces.map((p, i) => {
        const start = T.split + i * 6
        const land = start + 20
        if (frame < start || frame > land + 6) return null
        const t = interpolate(frame, [start, land], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
        const from = screenOf(SPOT.paymentsBase, cam, layout)
        const to = screenOf(p.to, cam, layout)
        return (
          <At key={p.text} x={lerp(from.x, to.x, t) + (i - 1) * 90 * u * Math.sin(t * Math.PI)} y={lerp(from.y, to.y, t)} style={{ opacity: interpolate(frame, [start, start + 4, land, land + 6], [0, 1, 1, 0], clamp), transform: `translate(-50%, -50%) scale(${1 - t * 0.4})` }}>
            <Pill text={p.text} color={p.color} size={24} />
          </At>
        )
      })}
    </AbsoluteFill>
  )
}

// 9. The world around the real castle, revealed with the same line.
const World: React.FC<{ cam: Cam }> = ({ cam }) => {
  const frame = useCurrentFrame()
  const layout = useLayout()
  const real = interpolate(frame, T.real, [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) })
  if (real <= 0) return null
  const lineF = 720 + 30 - real * 780
  const lineY = screenOf([0, lineF], cam, layout).y
  const m = `linear-gradient(to bottom, transparent ${lineY - 40}px, black ${lineY + 10}px)`
  return (
    <AbsoluteFill style={{ maskImage: m, WebkitMaskImage: m }}>
      <Img src={REAL} style={{ position: "absolute", inset: -60, width: "calc(100% + 120px)", height: "calc(100% + 120px)", objectFit: "cover", filter: "blur(26px) brightness(0.55) saturate(1.1)" }} />
    </AbsoluteFill>
  )
}

const Mist: React.FC = () => {
  const frame = useCurrentFrame()
  const show = interpolate(frame, [T.real[0] + 30, T.real[1] + 20], [0, 1], clamp)
  if (show <= 0) return null
  return (
    <AbsoluteFill style={{ opacity: show * 0.5, pointerEvents: "none" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${-30 + ((frame * (0.12 + i * 0.05) + i * 40) % 160) - 30}%`,
            top: `${58 + i * 9}%`,
            width: "90%",
            height: "18%",
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, rgba(220,230,235,0.35), rgba(220,230,235,0) 70%)",
            filter: "blur(30px)",
          }}
        />
      ))}
    </AbsoluteFill>
  )
}

// 10. The engraved cornerstone, close up.
const Cornerstone: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const show = ramp(frame, T.closeup[0], T.closeup[1])
  const engrave = ramp(frame, T.engrave[0], T.engrave[1])
  if (show <= 0) return null
  const w = Math.min(width * 0.82, 900 * u)
  const h = w * 0.46
  const wordmark = `url(${staticFile("wordmark.svg")})`
  const logoMask: React.CSSProperties = { maskImage: wordmark, WebkitMaskImage: wordmark, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }
  const grain = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.42  0 0 0 0 0.37  0 0 0 0.5 0'/></filter><rect width='400' height='200' filter='url(#n)'/></svg>")}")`
  return (
    <AbsoluteFill style={{ opacity: show }}>
      <Img src={REAL} style={{ position: "absolute", inset: -80, width: "calc(100% + 160px)", height: "calc(100% + 160px)", objectFit: "cover", objectPosition: "45% 85%", filter: "blur(22px) brightness(0.4)", transform: `scale(${1.6 + frame * 0.0006})` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ perspective: 1600 * u }}>
          <div
            style={{
              position: "relative",
              width: w,
              height: h,
              transform: `rotateY(-14deg) rotateX(4deg) scale(${1.04 - show * 0.04 + (frame - T.closeup[0]) * 0.0004})`,
              background: `${grain}, linear-gradient(170deg, #EDE8DC 0%, #D9D2C2 55%, #BDB4A2 100%)`,
              backgroundSize: "400px 200px, 100% 100%",
              borderRadius: 4 * u,
              boxShadow: `0 ${40 * u}px ${90 * u}px rgba(0,0,0,0.7), inset 0 ${-30 * u}px ${60 * u}px rgba(0,0,0,0.18)`,
              overflow: "hidden",
            }}
          >
            {/* Warm uplight grazing the face */}
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 120%, rgba(255,196,120,0.55), rgba(255,196,120,0) 65%)", mixBlendMode: "soft-light" }} />
            {/* Emerald line on the top edge */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4 * u, background: C.greenBright, boxShadow: `0 0 ${20 * u}px ${C.greenBright}, 0 0 ${50 * u}px rgba(61,220,132,0.6)` }} />
            {/* The engraving: a shadow edge, a lit edge, the cut face */}
            <div style={{ position: "absolute", left: "26%", right: "26%", top: "20%", bottom: "20%", opacity: engrave }}>
              <div style={{ position: "absolute", inset: 0, ...logoMask, background: "rgba(60,54,45,0.85)", transform: `translate(${-2 * u}px, ${-2 * u}px)` }} />
              <div style={{ position: "absolute", inset: 0, ...logoMask, background: "rgba(255,250,240,0.7)", transform: `translate(${2 * u}px, ${2 * u}px)` }} />
              <div style={{ position: "absolute", inset: 0, ...logoMask, background: "linear-gradient(180deg, #9C9384, #B8AF9F)" }} />
              <div style={{ position: "absolute", inset: 0, ...logoMask, background: `radial-gradient(circle at 50% 80%, rgba(61,220,132,${0.55 * engrave}), rgba(61,220,132,0) 60%)` }} />
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// --- The ad ------------------------------------------------------------------

export const CastleAd2: React.FC = () => {
  const frame = useCurrentFrame()
  const cam = camAt(frame, CAM)
  const layout = useLayout()
  const build = buildAt(frame)
  const glow = interpolate(frame, [0, 140, 230, 1180, T.real[0] + 30, T.real[1]], [0.18, 0.2, 0.42, 0.45, 0.6, 0.1], clamp)
  const castleOut = interpolate(frame, [T.closeup[0], T.closeup[1]], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.bg }}>
      <Aurora glow={glow} />
      <World cam={cam} />
      <div style={{ position: "absolute", inset: 0, opacity: castleOut }}>
        <Castle build={build} cam={cam} overlay={<Overlay frame={frame} bays={build.bays} />} />
      </div>
      <Mist />
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(6,9,10,0.85) 0%, rgba(6,9,10,0.45) 16%, rgba(6,9,10,0) 30%)", opacity: 1 - interpolate(frame, [T.closeup[0], T.closeup[1]], [0, 1], clamp) }} />

      {/* Scene bursts */}
      <Ring {...screenOf(CORNER, camAt(T.corner[1], CAM), layout)} at={T.corner[1]} size={300} />
      <Ring {...screenOf(SPOT.stairsTop, camAt(T.steps[3] + 8, CAM), layout)} at={T.steps[3] + 8} />
      <Ring {...screenOf(SPOT.paymentsBase, camAt(T.rise[1], CAM), layout)} at={T.rise[1]} />

      <Sequence durationInFrames={T.hookEnd + 4}>
        <HookPile cam={cam} />
      </Sequence>
      {frame >= T.tx[0] && frame < T.fast[0] ? <Transactions cam={cam} /> : null}
      <GoalChip />
      <ExpenseTags />
      <ReceiptSnap />
      <BookingPhone />
      <InvoiceCards cam={cam} />
      {frame >= T.payments && frame < T.keep ? <PaymentQr cam={cam} /> : null}
      <Cornerstone />

      {/* Captions */}
      <Line from={6} to={80} text="Most apps help you **get paid…**" />
      <Line from={78} to={154} text="…and leave you to **sort out the rest.**" />
      <Line from={156} to={226} text="521 starts with **the books.**" />
      <Line from={226} to={300} text="Everything we build **stands on them.**" />
      <Line from={304} to={420} text="Every dollar, sorted. **Automatically.**" />
      <Line from={424} to={546} text="Watch every dollar **climb toward your goal.**" />
      <Line from={548} to={700} text="Every cost, **in its place.**" />
      <Line from={700} to={750} text="Snap a receipt. **It files itself.**" />
      <Line from={752} to={900} text="Clients book. **Deposits land in your books.**" />
      <Line from={902} to={1020} text="Invoice clients. **Payments match themselves.**" />
      <Line from={1022} to={1066} text="Get paid **on the spot.**" />
      <Line from={1066} to={1110} text="Automatically **booked for you.**" />
      <Line from={1226} to={1360} text="Run the business. **The books run themselves.**" size={60} />
    </AbsoluteFill>
  )
}

const Line: React.FC<{ from: number; to: number; text: string; size?: number }> = ({ from, to, text, size = 56 }) => {
  const frame = useCurrentFrame()
  const out = interpolate(frame, [to - 8, to], [1, 0], clamp)
  return (
    <Sequence from={from} durationInFrames={to - from}>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <Caption bottom={0.08}>
          <Words text={text} delay={2} size={size} stagger={3} />
        </Caption>
      </div>
    </Sequence>
  )
}
