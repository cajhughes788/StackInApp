import React from "react"
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, Easing } from "remotion"
import { Aurora, RingBurst } from "../components/backdrop"
import { Caption, Scene, Stage, Words, clamp, useIn } from "../components/motion"
import { Chip, GlassIcon, Phone, Qr } from "../components/ui"
import { C, fontFamily, useUnit } from "../theme"

// "Book. Show up. Get paid." — a ~22 s ad built from real 521 screens
// (public/real/, captured from the app in the iOS Simulator). The story:
// Jordan books a haircut online, it lands on the barber's calendar, the
// confirmation sends itself, the barber shows up, finishes and gets paid.

// Real screens still to capture: set to the file name once it's in
// public/real/ and the scene swaps the drawn stand-in for the screenshot.
const GET_PAID_SCREEN: string | null = "10-scan-to-pay.png"
const PAID_SCREEN: string | null = null // e.g. "09-paid.png"

// A phone showing a real screenshot (1206×2622), straight on and still. The
// screenshot already carries the status bar and Dynamic Island, so this frame
// draws neither. (`tilt` is accepted but ignored: the phone always faces front.)
const ScreenPhone: React.FC<{ height: number; children: React.ReactNode; tilt?: number }> = ({ height, children }) => {
  const u = useUnit()
  const width = height * (1206 / 2622)
  const bezel = height * 0.016
  return (
    <div
      style={{
        width: width + bezel * 2,
        height: height + bezel * 2,
        padding: bezel,
        borderRadius: height * 0.085,
        background: "linear-gradient(160deg, #3a4247, #14181b)",
        boxShadow: `0 ${50 * u}px ${120 * u}px rgba(0,0,0,0.6), 0 0 ${80 * u}px rgba(47,168,102,0.25), inset 0 0 0 ${2 * u}px rgba(255,255,255,0.15)`,
      }}
    >
      <div style={{ width, height, borderRadius: height * 0.07, overflow: "hidden", position: "relative", background: C.charcoal }}>
        {children}
      </div>
    </div>
  )
}

// Screens come from public/clean/ (workspace names swapped for a made-up one
// by Clean.tsx); the lock-screen push has no names, so it's used as captured.
// The screen holds still: `zoom` and `originY` are accepted but ignored.
const Shot: React.FC<{ file: string; opacity?: number; zoom?: number; originY?: number }> = ({ file, opacity = 1 }) => (
  <Img
    src={staticFile(file.startsWith("08-") ? `real/${file}` : `clean/${file}`)}
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity,
    }}
  />
)

// A finger tap: a ring that pops where the client taps.
const Tap: React.FC<{ at: number; x: number; y: number; size: number }> = ({ at, x, y, size }) => {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [at, at + 16], [0, 1], clamp)
  if (frame < at || p >= 1) return null
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: "50%",
        border: `${size * 0.08}px solid ${C.greenBright}`,
        background: "rgba(61,220,132,0.18)",
        opacity: 1 - p,
        transform: `scale(${0.4 + p * 0.9})`,
        zIndex: 10,
      }}
    />
  )
}

// The phone fades in where it stands and stays put.
function usePhoneMotion(delay = 0) {
  const p = useIn(delay, 16, 90)
  return { opacity: p }
}

// 0–2.3 s: the hook.
const Hook: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <div style={{ maxWidth: 900 }}>
      <Words text="Booked, reminded and paid." delay={4} size={72} />
      <div style={{ height: 24 }} />
      <Words text="Without **one** text." delay={26} size={72} />
    </div>
  </AbsoluteFill>
)

// 2.3–6.3 s: Jordan books online. Service → day → time → form → confirmed.
const Book: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const h = 980 * u
  const shots = ["01-book-service.png", "02-book-day.png", "03-book-time.png", "04-book-form.png", "05-booked-confirmed.png"]
  const step = 22
  return (
    <AbsoluteFill>
      <Stage tallScale={1.05} offset={-0.1}>
        <div style={usePhoneMotion(0)}>
          <ScreenPhone height={h} tilt={-6}>
            {shots.map((file, i) => {
              const start = 10 + i * step
              const o = i === 0 ? 1 : interpolate(frame, [start - 4, start + 4], [0, 1], clamp)
              return <Shot key={file} file={file} opacity={o} />
            })}
            <Tap at={10 + step - 8} x={50} y={34} size={110 * u} />
            <Tap at={10 + step * 2 - 8} x={50} y={40} size={110 * u} />
            <Tap at={10 + step * 3 - 8} x={77} y={40} size={110 * u} />
            <Tap at={10 + step * 4 - 8} x={50} y={69} size={110 * u} />
          </ScreenPhone>
        </div>
      </Stage>
      <Caption>
        <Words text="Clients book **themselves.**" delay={8} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 6.3–10.3 s: the real new-booking push on the lock screen, then the
// booking on the barber's calendar.
const Booked: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const toCalendar = interpolate(frame, [58, 70], [0, 1], clamp)
  return (
    <AbsoluteFill>
      <Stage tallScale={1.05} offset={-0.1}>
        <div style={usePhoneMotion(0)}>
          <ScreenPhone height={980 * u} tilt={5}>
            <Shot file="08-push-notification.png" zoom={interpolate(frame, [0, 60], [1, 1.1], clamp)} originY={78} />
            <Shot file="06-owner-calendar.png" opacity={toCalendar} zoom={interpolate(frame, [58, 120], [1, 1.06], clamp)} originY={65} />
          </ScreenPhone>
        </div>
      </Stage>
      <Caption>
        <div style={{ opacity: 1 - toCalendar, position: toCalendar > 0 ? "absolute" : "relative" }}>
          <Words text="**Booked** while you were off the clock." delay={8} size={48} />
        </div>
        {frame >= 60 ? <Words text="It lands on **your calendar.**" delay={62} size={60} /> : null}
      </Caption>
    </AbsoluteFill>
  )
}

// 9.3–11.8 s: the appointment, confirmation already emailed.
const Confirmed: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  return (
    <AbsoluteFill>
      <Stage tallScale={1.05} offset={-0.1}>
        <div style={usePhoneMotion(0)}>
          <ScreenPhone height={980 * u} tilt={-4}>
            <Shot file="07-appointment.png" zoom={interpolate(frame, [0, 75], [1, 1.12], { ...clamp, easing: Easing.inOut(Easing.quad) })} originY={78} />
          </ScreenPhone>
        </div>
      </Stage>
      <Caption>
        <Words text="Confirmations and reminders send **themselves.**" delay={6} size={54} />
      </Caption>
    </AbsoluteFill>
  )
}

// 11.8–14 s: show up and do the work. Swap in real footage here if you film it.
const ShowUp: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const p = useIn(4, 14, 90)
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ transform: `scale(${0.8 + 0.2 * p}) rotate(${Math.sin(frame / 10) * 6}deg)`, opacity: p }}>
        <GlassIcon name="scissors" label="Wed · 10:00 am" size={260 * u} glow={0.4} />
      </div>
      <Caption>
        <Words text="You just **show up.**" delay={10} size={64} />
      </Caption>
    </AbsoluteFill>
  )
}

// 14–17 s: Finish & get paid by QR.
const GetPaid: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const h = 980 * u
  const reveal = interpolate(frame, [10, 40], [0, 1], clamp)
  return (
    <AbsoluteFill>
      <Stage tallScale={1.05} offset={-0.1}>
        <div style={usePhoneMotion(0)}>
          {GET_PAID_SCREEN ? (
            <ScreenPhone height={h} tilt={5}>
              <Shot file={GET_PAID_SCREEN} />
            </ScreenPhone>
          ) : (
            <Phone height={h} tilt={5}>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 * u, fontFamily }}>
                <div style={{ fontSize: 30 * u, color: C.muted }}>Haircut · Jordan Lee</div>
                <div style={{ fontSize: 76 * u, fontWeight: 700 }}>$55.00</div>
                <div style={{ background: "#ECEBE6", padding: 24 * u, borderRadius: 28 * u }}>
                  <Qr size={300 * u} reveal={reveal} />
                </div>
                <div style={{ fontSize: 28 * u, color: C.muted }}>Scan to pay</div>
              </div>
            </Phone>
          )}
        </div>
      </Stage>
      <Caption>
        <Words text="Finish. They scan to pay. **Done.**" delay={8} size={56} />
      </Caption>
    </AbsoluteFill>
  )
}

// 17–19.5 s: paid.
const Paid: React.FC = () => {
  const u = useUnit()
  return (
    <AbsoluteFill>
      {PAID_SCREEN ? (
        <Stage tallScale={1.05} offset={-0.1}>
          <div style={usePhoneMotion(0)}>
            <ScreenPhone height={980 * u} tilt={-4}>
              <Shot file={PAID_SCREEN} />
            </ScreenPhone>
          </div>
        </Stage>
      ) : null}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <RingBurst start={6} size={800 * u} />
        <Chip icon="card" label="Paid · $55.00" sub="Jordan Lee · Haircut + beard trim" delay={6} checkAt={10} width={660} />
      </AbsoluteFill>
      <Caption>
        <Words text="Paid before you're **out the door.**" delay={14} size={58} />
      </Caption>
    </AbsoluteFill>
  )
}

// 19.5–22 s: logo and line.
const End: React.FC = () => {
  const u = useUnit()
  const p = useIn(4, 14, 100)
  const cta = useIn(34, 16, 110)
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <RingBurst start={2} size={700 * u} />
      <div
        style={{
          transform: `translateY(${-120 * u}px) scale(${0.7 + 0.3 * p})`,
          opacity: p,
          filter: `blur(${(1 - p) * 20 * u}px)`,
        }}
      >
        <Img
          src={staticFile("brand-logo.png")}
          style={{
            width: 360 * u,
            height: 360 * u,
            borderRadius: 80 * u,
            boxShadow: `0 ${30 * u}px ${90 * u}px rgba(0,0,0,0.6), 0 0 ${70 * u}px rgba(47,168,102,0.35), inset 0 0 0 ${2 * u}px rgba(255,255,255,0.1)`,
          }}
        />
      </div>
      <div style={{ position: "absolute", bottom: "22%", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 * u }}>
        <Words text="Book. Show up. **Get paid.**" delay={14} size={56} />
        <div
          style={{
            opacity: cta,
            transform: `translateY(${(1 - cta) * 30 * u}px)`,
            background: C.text,
            color: C.charcoal,
            fontFamily,
            fontWeight: 700,
            fontSize: 36 * u,
            padding: `${22 * u}px ${48 * u}px`,
            borderRadius: 999,
          }}
        >
          Download free
        </div>
        <div style={{ opacity: cta, fontFamily, fontSize: 30 * u, color: C.muted, letterSpacing: 0.02 * 30 * u }}>
          On the web and iPhone
        </div>
      </div>
    </AbsoluteFill>
  )
}

const SCENES: Array<{ from: number; duration: number; Component: React.FC; fadeIn?: number; fadeOut?: number }> = [
  { from: 0, duration: 70, Component: Hook, fadeIn: 4 },
  { from: 64, duration: 130, Component: Book },
  { from: 188, duration: 126, Component: Booked },
  { from: 308, duration: 80, Component: Confirmed },
  { from: 382, duration: 70, Component: ShowUp },
  { from: 446, duration: 94, Component: GetPaid },
  { from: 534, duration: 82, Component: Paid },
  { from: 610, duration: 110, Component: End, fadeOut: 1 },
]

export const BSP_DURATION = 720 // 24 s at 30 fps

export const BookShowPay: React.FC = () => {
  const frame = useCurrentFrame()
  const glow = 0.45 + interpolate(frame, [534, 550, 590, 630, 650], [0, 0.45, 0.2, 0.2, 0.5], clamp)
  return (
    <AbsoluteFill>
      <Aurora glow={glow} />
      {SCENES.map(({ from, duration, Component, fadeIn, fadeOut }) => (
        <Sequence key={from} from={from} durationInFrames={duration}>
          <Scene duration={duration} fadeIn={fadeIn} fadeOut={fadeOut} drift={false}>
            <Component />
          </Scene>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
