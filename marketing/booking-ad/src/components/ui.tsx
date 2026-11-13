import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { C, fontFamily, useUnit } from "../theme"
import { clamp, useIn } from "./motion"

const glass = (u: number): React.CSSProperties => ({
  background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.25))",
  border: `${1.5 * u}px solid rgba(255,255,255,0.16)`,
  boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.55), inset 0 ${1.5 * u}px 0 rgba(255,255,255,0.18)`,
  backdropFilter: "blur(20px)",
})

// --- Icons (simple line glyphs) ---------------------------------------------

export type Glyph = "calendar" | "card" | "sheet" | "link" | "bell" | "check" | "scissors" | "clock" | "qr" | "chat" | "bank" | "receipt" | "invoice" | "phone" | "bill" | "copy" | "share"

export const Icon: React.FC<{ name: Glyph; size: number; color?: string; stroke?: number }> = ({
  name,
  size,
  color = C.text,
  stroke = 2,
}) => {
  const p = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {name === "calendar" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" {...p} />
          <path d="M3 10h18M8 3v4M16 3v4" {...p} />
          <path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" {...p} />
        </>
      ) : name === "card" ? (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="3" {...p} />
          <path d="M2.5 9.5h19M6 15h4" {...p} />
        </>
      ) : name === "sheet" ? (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" {...p} />
          <path d="M3.5 9h17M3.5 14.5h17M9 3.5v17M14.5 3.5v17" {...p} />
        </>
      ) : name === "link" ? (
        <>
          <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" {...p} />
          <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" {...p} />
        </>
      ) : name === "bell" ? (
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" {...p} />
      ) : name === "check" ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" {...p} />
      ) : name === "scissors" ? (
        <>
          <circle cx="6" cy="7" r="2.6" {...p} />
          <circle cx="6" cy="17" r="2.6" {...p} />
          <path d="M8.2 8.4L20 18M8.2 15.6L20 6" {...p} />
        </>
      ) : name === "clock" ? (
        <>
          <circle cx="12" cy="12" r="8.5" {...p} />
          <path d="M12 7.5V12l3 2" {...p} />
        </>
      ) : name === "qr" ? (
        <>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" {...p} />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" {...p} />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" {...p} />
          <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18z" {...p} />
        </>
      ) : name === "bank" ? (
        <path d="M3 9.5L12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" {...p} />
      ) : name === "receipt" ? (
        <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3zM9 8h6M9 12h6M9 16h3" {...p} />
      ) : name === "copy" ? (
        <>
          <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" {...p} />
          <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" {...p} />
        </>
      ) : name === "share" ? (
        <>
          <circle cx="18" cy="5.5" r="2.5" {...p} />
          <circle cx="6" cy="12" r="2.5" {...p} />
          <circle cx="18" cy="18.5" r="2.5" {...p} />
          <path d="M8.2 10.9l7.6-4.2M8.2 13.1l7.6 4.2" {...p} />
        </>
      ) : name === "phone" ? (
        <>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" {...p} />
          <path d="M10.5 18.5h3" {...p} />
        </>
      ) : name === "bill" ? (
        <>
          <rect x="2.5" y="6" width="19" height="12" rx="2" {...p} />
          <circle cx="12" cy="12" r="2.6" {...p} />
          <path d="M6 9.5v5M18 9.5v5" {...p} />
        </>
      ) : name === "invoice" ? (
        <>
          <path d="M6 3h8l4 4v14H6V3z" {...p} />
          <path d="M14 3v4h4M9 12h6M9 16h6" {...p} />
        </>
      ) : (
        <path d="M4 5.5h16v10H9l-5 4v-14z" {...p} />
      )}
    </svg>
  )
}

// A rounded, lit glass tile with a glyph, like the reference's 3D icons.
export const GlassIcon: React.FC<{ name: Glyph; label: string; size: number; tint?: string; glow?: number }> = ({
  name,
  label,
  size,
  tint = C.green,
  glow = 0,
}) => {
  const u = useUnit()
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size * 0.1 }}>
      <div
        style={{
          ...glass(u),
          width: size,
          height: size,
          borderRadius: size * 0.26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `${glass(u).boxShadow}, 0 0 ${size * 0.6 * glow}px rgba(61,220,132,${0.6 * glow})`,
        }}
      >
        <Icon name={name} size={size * 0.5} color={tint} stroke={1.7} />
      </div>
      <span style={{ fontFamily, fontSize: size * 0.13, color: C.muted, letterSpacing: 0.5 }}>{label}</span>
    </div>
  )
}

// --- Chips, cards, tags ------------------------------------------------------

// A pill that slides in, then gets a green check at `checkAt` (frames from start).
export const Chip: React.FC<{
  icon?: Glyph
  label: string
  sub?: string
  delay: number
  checkAt?: number
  width?: number
  accent?: string
}> = ({ icon, label, sub, delay, checkAt, width = 620, accent = C.green }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const p = useIn(delay)
  const checked = checkAt !== undefined ? interpolate(frame, [delay + checkAt, delay + checkAt + 8], [0, 1], clamp) : 0
  return (
    <div
      style={{
        ...glass(u),
        width: width * u,
        borderRadius: 999,
        padding: `${20 * u}px ${28 * u}px`,
        display: "flex",
        alignItems: "center",
        gap: 20 * u,
        opacity: p,
        transform: `translateX(${(1 - p) * 120 * u}px)`,
        filter: `blur(${(1 - p) * 8 * u}px)`,
        background:
          checked > 0
            ? `linear-gradient(90deg, ${accent}${Math.round(checked * 0x55).toString(16).padStart(2, "0")}, rgba(255,255,255,0.03))`
            : glass(u).background,
        borderColor: checked > 0.5 ? `${accent}aa` : "rgba(255,255,255,0.16)",
      }}
    >
      {icon ? (
        <div
          style={{
            width: 56 * u,
            height: 56 * u,
            borderRadius: 18 * u,
            background: "rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={icon} size={30 * u} color={C.text} />
        </div>
      ) : null}
      <div style={{ flex: 1, fontFamily, minWidth: 0 }}>
        <div style={{ fontSize: 34 * u, color: C.text, fontWeight: 500, whiteSpace: "nowrap" }}>{label}</div>
        {sub ? <div style={{ fontSize: 24 * u, color: C.muted, marginTop: 4 * u, whiteSpace: "nowrap" }}>{sub}</div> : null}
      </div>
      {checkAt !== undefined ? <CheckDot size={52 * u} progress={checked} /> : null}
    </div>
  )
}

export const CheckDot: React.FC<{ size: number; progress: number; color?: string }> = ({ size, progress, color = C.green }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      flexShrink: 0,
      border: `${size * 0.06}px solid ${progress > 0 ? color : "rgba(255,255,255,0.25)"}`,
      background: progress > 0 ? color : "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${1 + Math.sin(progress * Math.PI) * 0.25})`,
      boxShadow: progress > 0 ? `0 0 ${size * 0.6}px ${color}aa` : "none",
    }}
  >
    <div style={{ opacity: progress }}>
      <Icon name="check" size={size * 0.62} color="#fff" stroke={3} />
    </div>
  </div>
)

export const Card: React.FC<{ width: number; children: React.ReactNode; style?: React.CSSProperties; radius?: number }> = ({
  width,
  children,
  style,
  radius = 40,
}) => {
  const u = useUnit()
  return (
    <div
      style={{
        ...glass(u),
        background: "linear-gradient(165deg, rgba(36,44,48,0.92), rgba(18,22,25,0.92))",
        width: width * u,
        borderRadius: radius * u,
        padding: 36 * u,
        fontFamily,
        color: C.text,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// A colored category tag with an amount, sliding in like the reference's tags.
export const Tag: React.FC<{ label: string; amount: string; color: string; delay: number; negative?: boolean }> = ({
  label,
  amount,
  color,
  delay,
  negative,
}) => {
  const u = useUnit()
  const p = useIn(delay)
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: 640 * u,
        opacity: p,
        transform: `translateY(${(1 - p) * 40 * u}px) scale(${0.9 + 0.1 * p})`,
        filter: `blur(${(1 - p) * 8 * u}px)`,
        fontFamily,
      }}
    >
      <span
        style={{
          background: color,
          color: "#fff",
          borderRadius: 999,
          padding: `${12 * u}px ${30 * u}px`,
          fontSize: 30 * u,
          fontWeight: 600,
          boxShadow: `0 0 ${30 * u}px ${color}88`,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 36 * u, fontWeight: 600, color: negative ? C.muted : C.greenBright }}>
        {amount} <span style={{ fontSize: 28 * u }}>{negative ? "↘" : "↗"}</span>
      </span>
    </div>
  )
}

// A chat bubble for the "too many apps" scene.
export const Bubble: React.FC<{ text: string; from: string; delay: number; x: number; y: number; rot: number }> = ({
  text,
  from,
  delay,
  x,
  y,
  rot,
}) => {
  const u = useUnit()
  const p = useIn(delay, 14, 160)
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${x * u}px)`,
        top: `calc(50% + ${y * u}px)`,
        transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${0.6 + 0.4 * p})`,
        opacity: p,
        ...glass(u),
        background: "rgba(30,36,40,0.9)",
        borderRadius: 30 * u,
        padding: `${18 * u}px ${26 * u}px`,
        fontFamily,
        width: 470 * u,
      }}
    >
      <div style={{ fontSize: 22 * u, color: C.muted, marginBottom: 6 * u }}>{from}</div>
      <div style={{ fontSize: 30 * u, color: C.text }}>{text}</div>
    </div>
  )
}

// A generated QR-looking grid. Deterministic, not a real code.
export const Qr: React.FC<{ size: number; reveal?: number }> = ({ size, reveal = 1 }) => {
  const n = 25
  const cell = size / n
  const finder = (r: number, c: number) => {
    const inBox = (r0: number, c0: number) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      if (inBox(r0, c0)) {
        const rr = r - r0
        const cc = c - c0
        return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4) ? 1 : 0
      }
    }
    return -1
  }
  const cells: React.ReactNode[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const f = finder(r, c)
      const on = f === -1 ? ((r * 7 + c * 13 + ((r * c) % 5)) * 2654435761) % 7 < 3 : f === 1
      const order = (r + c) / (2 * n)
      if (on && order <= reveal)
        cells.push(<rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell * 0.92} height={cell * 0.92} rx={cell * 0.2} fill="#161B1E" />)
    }
  }
  return (
    <svg width={size} height={size}>
      {cells}
    </svg>
  )
}

// A floating phone with the given screen.
export const Phone: React.FC<{ height: number; children: React.ReactNode; tilt?: number }> = ({ height, children, tilt = 0 }) => {
  const u = useUnit()
  const width = height * 0.49
  return (
    <div
      style={{
        width,
        height,
        borderRadius: height * 0.09,
        padding: height * 0.018,
        background: "linear-gradient(160deg, #3a4247, #14181b)",
        boxShadow: `0 ${50 * u}px ${120 * u}px rgba(0,0,0,0.6), 0 0 ${80 * u}px rgba(47,168,102,0.25), inset 0 0 0 ${2 * u}px rgba(255,255,255,0.15)`,
        transform: `perspective(${2000 * u}px) rotateY(${tilt}deg) rotateX(${tilt * 0.3}deg)`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: height * 0.075,
          background: C.charcoal,
          overflow: "hidden",
          position: "relative",
          fontFamily,
          color: C.text,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: height * 0.014,
            left: "50%",
            transform: "translateX(-50%)",
            width: width * 0.3,
            height: height * 0.032,
            borderRadius: 999,
            background: "#000",
            zIndex: 5,
          }}
        />
        {children}
      </div>
    </div>
  )
}
