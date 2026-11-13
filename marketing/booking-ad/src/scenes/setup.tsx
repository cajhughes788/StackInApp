import React from "react"
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { C, useUnit } from "../theme"
import { Caption, Stage, Words, clamp, useIn } from "../components/motion"
import { Card, CheckDot, Chip, Phone, Qr } from "../components/ui"

// 9–13 s: add services and hours; each one checks as it "saves".
export const Services: React.FC = () => {
  const u = useUnit()
  return (
    <AbsoluteFill>
      <Stage>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 * u, alignItems: "center" }}>
          <Chip icon="scissors" label="Haircut" sub="45 min · $40 · 25% deposit" delay={6} checkAt={16} />
          <Chip icon="scissors" label="Fade & beard" sub="1 hr · $55 · $15 deposit" delay={16} checkAt={16} />
          <Chip icon="scissors" label="Kids cut" sub="30 min · $25" delay={26} checkAt={16} />
          <Chip icon="clock" label="Mon – Fri · 9am – 6pm" sub="Sat · 10am – 2pm" delay={40} checkAt={16} />
        </div>
      </Stage>
      <Caption>
        <Words text="Add what you offer. **It saves itself.**" delay={8} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 13–17 s: the booking link, its QR, and a Book now button landing on a website.
export const Share: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const site = useIn(4)
  const drop = useIn(30, 11, 170)
  const qr = useIn(52)
  const press = interpolate(frame, [80, 86, 92], [1, 0.92, 1], clamp)
  const line = (w: number, o = 0.12) => (
    <div style={{ height: 18 * u, width: `${w}%`, borderRadius: 9 * u, background: `rgba(236,235,230,${o})`, marginBottom: 16 * u }} />
  )
  return (
    <AbsoluteFill>
      <Stage>
        <div style={{ position: "relative", width: 760 * u, height: 640 * u }}>
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)" }}>
            <Chip icon="link" label="the521app.com/book/jaycuts" delay={0} checkAt={18} width={700} />
          </div>
          <div
            style={{
              position: "absolute",
              top: 140 * u,
              left: 0,
              opacity: site,
              transform: `translateY(${(1 - site) * 60 * u}px)`,
            }}
          >
            <Card width={640} radius={30} style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 10 * u, padding: `${18 * u}px ${24 * u}px`, borderBottom: `1px solid ${C.border}` }}>
                {[C.rose, C.amber, C.green].map((c) => (
                  <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: "50%", background: c, opacity: 0.8 }} />
                ))}
                <div style={{ marginLeft: 16 * u, fontSize: 20 * u, color: C.muted }}>jaycuts.com</div>
              </div>
              <div style={{ padding: 36 * u, filter: `blur(${1.5 * u}px)` }}>
                <div style={{ fontSize: 44 * u, fontWeight: 700, marginBottom: 24 * u, color: "rgba(236,235,230,0.8)" }}>Jay&apos;s Cuts</div>
                {line(90)}
                {line(70)}
                {line(80)}
              </div>
              <div style={{ padding: `0 ${36 * u}px ${40 * u}px` }}>
                <div
                  style={{
                    display: "inline-block",
                    background: C.green,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 32 * u,
                    padding: `${20 * u}px ${48 * u}px`,
                    borderRadius: 999,
                    opacity: drop,
                    transform: `translateY(${(1 - drop) * -180 * u}px) scale(${press})`,
                    boxShadow: `0 0 ${50 * u * drop}px rgba(47,168,102,0.7)`,
                  }}
                >
                  Book now
                </div>
              </div>
            </Card>
          </div>
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              opacity: qr,
              transform: `scale(${0.7 + 0.3 * qr}) rotate(${(1 - qr) * 10}deg)`,
            }}
          >
            <Card width={250} radius={30} style={{ padding: 22 * u, background: "#ECEBE6", textAlign: "center" }}>
              <Qr size={206 * u} />
              <div style={{ fontSize: 20 * u, color: C.charcoal, fontWeight: 600, marginTop: 8 * u }}>Scan to book</div>
            </Card>
          </div>
        </div>
      </Stage>
      <Caption>
        <Words text="Share it anywhere. **Even your website.**" delay={10} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 17–21 s: the client books on their phone and pays the deposit.
export const ClientBooks: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const phone = useIn(0, 16, 90)
  const step = frame < 36 ? 0 : frame < 66 ? 1 : frame < 92 ? 2 : 3
  const stepIn = useIn([0, 36, 66, 92][step], 18, 140)
  const tap = (at: number) => interpolate(frame, [at, at + 4, at + 8], [1, 0.94, 1], clamp)
  const h = 900 * u
  const pad = 34 * u
  const row = (label: string, sub: string, active: boolean) => (
    <div
      key={label}
      style={{
        background: active ? "rgba(47,168,102,0.18)" : "rgba(255,255,255,0.05)",
        border: `${2 * u}px solid ${active ? C.green : "transparent"}`,
        borderRadius: 22 * u,
        padding: `${20 * u}px ${22 * u}px`,
        marginBottom: 14 * u,
        transform: active ? `scale(${tap(26)})` : undefined,
      }}
    >
      <div style={{ fontSize: 26 * u, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20 * u, color: C.muted, marginTop: 4 * u }}>{sub}</div>
    </div>
  )
  const times = ["9:00", "10:00", "11:30", "1:00", "2:00", "3:30", "4:00", "5:00"]
  return (
    <AbsoluteFill>
      <Stage offset={-0.08}>
        <div style={{ opacity: phone, transform: `translateY(${(1 - phone) * 200 * u}px)` }}>
          <Phone height={h} tilt={Math.sin(frame / 50) * 6 - 4}>
            <div style={{ padding: pad, paddingTop: 90 * u, opacity: stepIn, transform: `translateX(${(1 - stepIn) * 60 * u}px)` }}>
              <div style={{ fontSize: 20 * u, color: C.muted }}>Jay&apos;s Cuts</div>
              {step === 0 ? (
                <>
                  <div style={{ fontSize: 34 * u, fontWeight: 700, margin: `${8 * u}px 0 ${24 * u}px` }}>Book an appointment</div>
                  {row("Haircut", "45 min · $40", frame >= 24)}
                  {row("Fade & beard", "1 hr · $55", false)}
                  {row("Kids cut", "30 min · $25", false)}
                </>
              ) : step === 1 ? (
                <>
                  <div style={{ fontSize: 34 * u, fontWeight: 700, margin: `${8 * u}px 0 ${24 * u}px` }}>Thu, Dec 4</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 * u }}>
                    {times.map((t) => {
                      const active = t === "2:00" && frame >= 52
                      return (
                        <div
                          key={t}
                          style={{
                            textAlign: "center",
                            padding: `${20 * u}px 0`,
                            borderRadius: 999,
                            fontSize: 24 * u,
                            fontWeight: 600,
                            background: active ? C.green : "rgba(255,255,255,0.06)",
                            transform: active ? `scale(${tap(52)})` : undefined,
                          }}
                        >
                          {t}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div style={{ fontSize: 34 * u, fontWeight: 700, margin: `${8 * u}px 0 ${24 * u}px` }}>Your details</div>
                  {["Jordan Lee", "jordan@email.com"].map((v) => (
                    <div key={v} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 18 * u, padding: `${20 * u}px`, fontSize: 22 * u, marginBottom: 14 * u }}>
                      {v}
                    </div>
                  ))}
                  <div style={{ fontSize: 20 * u, color: C.muted, margin: `${10 * u}px 0 ${24 * u}px` }}>Haircut · Thu, Dec 4 at 2pm · $10 deposit</div>
                  <div
                    style={{
                      background: C.green,
                      borderRadius: 999,
                      textAlign: "center",
                      padding: `${24 * u}px 0`,
                      fontWeight: 600,
                      fontSize: 24 * u,
                      transform: `scale(${tap(84)})`,
                      boxShadow: `0 0 ${40 * u}px rgba(47,168,102,0.5)`,
                    }}
                  >
                    Confirm &amp; pay deposit
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 120 * u, gap: 26 * u }}>
                  <CheckDot size={150 * u} progress={interpolate(frame, [92, 102], [0, 1], clamp)} />
                  <div style={{ fontSize: 36 * u, fontWeight: 700 }}>You&apos;re booked.</div>
                  <div style={{ fontSize: 22 * u, color: C.muted, textAlign: "center" }}>Thu, Dec 4 at 2pm{"\n"}Deposit received</div>
                </div>
              )}
            </div>
          </Phone>
        </div>
      </Stage>
      <Caption bottom={0.1}>
        <Words text="Clients book and pay **upfront.**" delay={10} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

// 21–24 s: the owner's notification and automatic reminders.
export const Notify: React.FC = () => {
  const u = useUnit()
  const drop = useIn(4, 13, 150)
  return (
    <AbsoluteFill>
      <Stage>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 * u }}>
          <div style={{ opacity: drop, transform: `translateY(${(1 - drop) * -200 * u}px)` }}>
            <Card width={700} radius={36} style={{ padding: 28 * u, display: "flex", gap: 22 * u, alignItems: "center" }}>
              <div
                style={{
                  width: 84 * u,
                  height: 84 * u,
                  borderRadius: 22 * u,
                  background: C.charcoal,
                  border: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 30 * u,
                  flexShrink: 0,
                }}
              >
                521
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 * u, color: C.muted }}>
                  <span>521</span>
                  <span>now</span>
                </div>
                <div style={{ fontSize: 30 * u, fontWeight: 600, marginTop: 4 * u }}>New booking: Jordan · Thu 2pm</div>
                <div style={{ fontSize: 24 * u, color: C.muted, marginTop: 4 * u }}>Haircut · $10 deposit paid</div>
              </div>
            </Card>
          </div>
          <Chip icon="bell" label="Reminder emailed" sub="1 day before" delay={30} checkAt={12} width={560} />
          <Chip icon="bell" label="Reminder emailed" sub="2 hours before" delay={44} checkAt={12} width={560} />
        </div>
      </Stage>
      <Caption>
        <Words text="Reminders **send themselves.**" delay={12} size={60} />
      </Caption>
    </AbsoluteFill>
  )
}

