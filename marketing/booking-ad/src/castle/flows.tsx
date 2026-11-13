import React from "react"
import { interpolate, useCurrentFrame } from "remotion"
import { C, useUnit } from "../theme"
import { clamp, useIn } from "../components/motion"
import { CheckDot, Icon, Qr, type Glyph } from "../components/ui"

// Short flows from the app, played inside a feature window. Local frames run
// 0–90; each flow has four beats at roughly 0, 24, 48 and 70.

const useStep = (beats: number[]) => {
  const frame = useCurrentFrame()
  let step = 0
  beats.forEach((b, i) => {
    if (frame >= b) step = i
  })
  return step
}

const press = (frame: number, at: number) => interpolate(frame, [at, at + 4, at + 9], [1, 0.93, 1], clamp)

const Row: React.FC<{ children: React.ReactNode; active?: boolean; style?: React.CSSProperties }> = ({ children, active, style }) => {
  const u = useUnit()
  return (
    <div
      style={{
        background: active ? "rgba(47,168,102,0.18)" : "rgba(255,255,255,0.05)",
        border: `${2 * u}px solid ${active ? C.green : "transparent"}`,
        borderRadius: 20 * u,
        padding: `${18 * u}px ${22 * u}px`,
        marginBottom: 12 * u,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

const Button: React.FC<{ label: string; at: number }> = ({ label, at }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  return (
    <div
      style={{
        background: C.green,
        borderRadius: 999,
        textAlign: "center",
        padding: `${22 * u}px 0`,
        fontWeight: 600,
        fontSize: 26 * u,
        transform: `scale(${press(frame, at)})`,
        boxShadow: `0 0 ${40 * u}px rgba(47,168,102,0.5)`,
        marginTop: 16 * u,
      }}
    >
      {label}
    </div>
  )
}

const Done: React.FC<{ at: number; title: string; sub: string }> = ({ at, title, sub }) => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const p = useIn(at, 13, 150)
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 40 * u, gap: 20 * u, opacity: p, transform: `scale(${0.85 + 0.15 * p})` }}>
      <CheckDot size={130 * u} progress={interpolate(frame, [at, at + 10], [0, 1], clamp)} />
      <div style={{ fontSize: 36 * u, fontWeight: 700, textAlign: "center" }}>{title}</div>
      <div style={{ fontSize: 24 * u, color: C.muted, textAlign: "center" }}>{sub}</div>
    </div>
  )
}

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const u = useUnit()
  return <div style={{ fontSize: 32 * u, fontWeight: 700, margin: `${4 * u}px 0 ${20 * u}px` }}>{children}</div>
}

const Line: React.FC<{ l: string; r: string; bold?: boolean; muted?: boolean }> = ({ l, r, bold, muted }) => {
  const u = useUnit()
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: (bold ? 32 : 26) * u,
        fontWeight: bold ? 700 : 400,
        color: muted ? C.muted : C.text,
        padding: `${10 * u}px 0`,
        borderTop: bold ? `1px solid ${C.border}` : undefined,
      }}
    >
      <span>{l}</span>
      <span style={{ color: bold ? C.greenBright : undefined }}>{r}</span>
    </div>
  )
}

export const BookingFlow: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const step = useStep([0, 26, 50, 70])
  const times = ["9:00", "10:00", "11:30", "1:00", "2:00", "3:30"]
  return (
    <div key={step}>
      {step === 0 ? (
        <>
          <Heading>Book an appointment</Heading>
          <Row active={frame >= 16} style={{ transform: `scale(${press(frame, 16)})` }}>
            <div style={{ fontSize: 26 * u, fontWeight: 600 }}>Haircut</div>
            <div style={{ fontSize: 20 * u, color: C.muted }}>45 min · $40 · $10 deposit</div>
          </Row>
          <Row>
            <div style={{ fontSize: 26 * u, fontWeight: 600 }}>Fade &amp; beard</div>
            <div style={{ fontSize: 20 * u, color: C.muted }}>1 hr · $55</div>
          </Row>
        </>
      ) : step === 1 ? (
        <>
          <Heading>Thu, Dec 4</Heading>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 * u }}>
            {times.map((t) => {
              const on = t === "2:00" && frame >= 40
              return (
                <div
                  key={t}
                  style={{
                    textAlign: "center",
                    padding: `${18 * u}px 0`,
                    borderRadius: 999,
                    fontSize: 24 * u,
                    fontWeight: 600,
                    background: on ? C.green : "rgba(255,255,255,0.06)",
                    transform: on ? `scale(${press(frame, 40)})` : undefined,
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
          <Heading>Jordan Lee</Heading>
          <div style={{ fontSize: 22 * u, color: C.muted }}>Haircut · Thu, Dec 4 at 2pm</div>
          <Button label="Confirm & pay deposit · $10" at={60} />
        </>
      ) : (
        <Done at={70} title="You're booked." sub="Deposit received · $10.00" />
      )}
    </div>
  )
}

export const InvoiceFlow: React.FC = () => {
  const u = useUnit()
  const step = useStep([0, 26, 50, 70])
  return (
    <div key={step}>
      {step === 0 ? (
        <>
          <div style={{ fontSize: 22 * u, color: C.muted }}>Invoice INV-0042</div>
          <Heading>Jordan Lee</Heading>
          <Line l="Color & cut" r="$210.00" />
          <Line l="Deep conditioning" r="$40.00" />
          <Line l="Total" r="$250.00" bold />
          <Button label="Send invoice" at={16} />
        </>
      ) : step === 1 ? (
        <>
          <div style={{ fontSize: 22 * u, color: C.muted }}>What Jordan sees</div>
          <Heading>Pay $250.00</Heading>
          <Row>
            <div style={{ fontSize: 22 * u, color: C.muted }}>Due today · INV-0042</div>
          </Row>
          <Button label="Pay $250.00" at={40} />
        </>
      ) : step === 2 ? (
        <Done at={50} title="Paid" sub="INV-0042 · $250.00" />
      ) : (
        <div style={{ paddingTop: 30 * u }}>
          <Heading>Matched to your bank</Heading>
          <Row active>
            <div style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
              <Icon name="bank" size={36 * u} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 24 * u, fontWeight: 600 }}>Deposit · Checking</div>
                <div style={{ fontSize: 20 * u, color: C.muted }}>INV-0042 · Jordan Lee</div>
              </div>
              <div style={{ fontSize: 26 * u, fontWeight: 700, color: C.greenBright }}>+$250.00</div>
            </div>
          </Row>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 * u }}>
            <CheckDot size={70 * u} progress={1} />
          </div>
        </div>
      )}
    </div>
  )
}

export const PaymentFlow: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const step = useStep([0, 24, 50, 70])
  const tip = useIn(50, 12, 160)
  return (
    <div key={step}>
      {step === 0 ? (
        <>
          <div style={{ fontSize: 22 * u, color: C.muted }}>Finish &amp; get paid · Jordan</div>
          <Heading>Haircut</Heading>
          <Line l="Haircut" r="$40.00" />
          <Line l="Beard trim" r="$15.00" />
          <Line l="Already paid" r="−$10.00" muted />
          <Line l="Due today" r="$45.00" bold />
        </>
      ) : step === 1 || step === 2 ? (
        <div style={{ textAlign: "center", position: "relative" }}>
          <div style={{ display: "inline-block", background: "#ECEBE6", borderRadius: 24 * u, padding: 20 * u }}>
            <Qr size={300 * u} reveal={interpolate(frame, [24, 44], [0, 1], clamp)} />
          </div>
          <div style={{ fontSize: 30 * u, fontWeight: 700, marginTop: 18 * u }}>Scan to pay · $45.00</div>
          {step === 2 ? (
            <div
              style={{
                position: "absolute",
                top: -10 * u,
                right: 10 * u,
                background: C.green,
                borderRadius: 999,
                padding: `${12 * u}px ${26 * u}px`,
                fontSize: 30 * u,
                fontWeight: 700,
                opacity: tip,
                transform: `scale(${0.5 + 0.5 * tip}) rotate(6deg)`,
                boxShadow: `0 0 ${40 * u}px rgba(47,168,102,0.8)`,
              }}
            >
              + $8.00 tip
            </div>
          ) : null}
        </div>
      ) : (
        <Done at={70} title="Paid in full" sub="Booked as income for you." />
      )}
    </div>
  )
}

export const ReceiptFlow: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const step = useStep([0, 50, 72])
  const scan = interpolate(frame, [16, 46], [0, 1], clamp)
  const field = (l: string, r: string, at: number) => {
    const p = interpolate(frame, [at, at + 8], [0, 1], clamp)
    return (
      <div style={{ opacity: p, transform: `translateX(${(1 - p) * 30 * u}px)` }}>
        <Line l={l} r={r} />
      </div>
    )
  }
  const receipt = (
    <div style={{ position: "relative", width: 300 * u, margin: "0 auto", background: "#ECEBE6", color: C.charcoal, borderRadius: 10 * u, padding: 24 * u, fontSize: 18 * u, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 800, textAlign: "center", fontSize: 22 * u }}>PRO SUPPLY CO.</div>
      <div style={{ textAlign: "center", opacity: 0.6 }}>10/28/2026</div>
      <div style={{ borderTop: "1px dashed #999", margin: `${10 * u}px 0` }} />
      {[
        ["Color tubes x6", "54.00"],
        ["Developer 32oz", "18.50"],
        ["Foils", "11.70"],
      ].map(([a, b]) => (
        <div key={a} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{a}</span>
          <span>{b}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #999", margin: `${10 * u}px 0` }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
        <span>TOTAL</span>
        <span>$84.20</span>
      </div>
      {scan > 0 && scan < 1 ? (
        <div style={{ position: "absolute", left: -10 * u, right: -10 * u, top: `${scan * 100}%`, height: 4 * u, background: C.greenBright, boxShadow: `0 0 ${24 * u}px ${C.greenBright}` }} />
      ) : null}
    </div>
  )
  return (
    <div key={step}>
      {step === 0 ? (
        <div style={{ position: "relative", paddingTop: 10 * u }}>
          {receipt}
          {(["tl", "tr", "bl", "br"] as const).map((c) => (
            <div
              key={c}
              style={{
                position: "absolute",
                width: 40 * u,
                height: 40 * u,
                [c[0] === "t" ? "top" : "bottom"]: -10 * u,
                [c[1] === "l" ? "left" : "right"]: 40 * u,
                borderColor: C.greenBright,
                borderStyle: "solid",
                borderWidth: 0,
                [c[0] === "t" ? "borderTopWidth" : "borderBottomWidth"]: 5 * u,
                [c[1] === "l" ? "borderLeftWidth" : "borderRightWidth"]: 5 * u,
              }}
            />
          ))}
        </div>
      ) : step === 1 ? (
        <>
          <Heading>Receipt read</Heading>
          {field("Vendor", "Pro Supply Co.", 52)}
          {field("Date", "Oct 28, 2026", 56)}
          {field("Amount", "$84.20", 60)}
        </>
      ) : (
        <Done at={72} title="Filed under Supplies" sub="Pro Supply Co. · −$84.20" />
      )}
    </div>
  )
}

export const FEATURES: Array<{ id: "booking" | "invoices" | "payments" | "receipts"; title: string; icon: Glyph; Flow: React.FC; caption: string }> = [
  { id: "booking", title: "Booking", icon: "calendar", Flow: BookingFlow, caption: "Book **clients.**" },
  { id: "invoices", title: "Invoices", icon: "invoice", Flow: InvoiceFlow, caption: "Send **invoices.**" },
  { id: "payments", title: "Payments", icon: "qr", Flow: PaymentFlow, caption: "Get paid **on the spot.**" },
  { id: "receipts", title: "Receipts", icon: "receipt", Flow: ReceiptFlow, caption: "Snap **receipts.**" },
]

