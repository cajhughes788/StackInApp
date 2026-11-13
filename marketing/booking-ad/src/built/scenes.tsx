import React from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion"
import { C, fontFamily, useUnit } from "../theme"
import { Caption, Stage, Words, clamp, useIn } from "../components/motion"
import { Chip, Icon } from "../components/ui"
import { RingBurst, Wordmark } from "../components/backdrop"
import { Block, Floater, PulseLine, Slab, money, useFlash, useTotal } from "./foundation"

// The books before features land on them; each scene picks up the last one's totals.
const BASE = { income: 8310, expenses: 2140 }
const AFTER_BLOCKS = { income: BASE.income + 10 + 250 + 53, expenses: BASE.expenses + 84.2 }

// --- 0–7 s: money comes in from everywhere, then falls into the dark ---------

const PAYMENTS = [
  { title: "Card payment", amount: 45, x: -150, y: -250, rot: -7 },
  { title: "Transfer received", amount: 120, x: 160, y: -140, rot: 5 },
  { title: "Invoice paid", amount: 250, x: -120, y: -20, rot: -3 },
  { title: "Cash", amount: 60, x: 170, y: 90, rot: 8 },
  { title: "App payment", amount: 35, x: -170, y: 200, rot: -9 },
  { title: "Tip", amount: 18, x: 140, y: 300, rot: 4 },
]

export const Hook: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const firstOut = interpolate(frame, [104, 116], [1, 0], clamp)
  return (
    <AbsoluteFill>
      <Stage tallScale={1.12}>
        {PAYMENTS.map((pay, i) => {
          const p = useIn(8 + i * 12, 13, 160)
          const fall = Math.max(0, frame - (132 + i * 4))
          const drop = fall * fall * 0.9 * u
          return (
            <div
              key={pay.title}
              style={{
                position: "absolute",
                transform: `translate(${pay.x * u}px, ${pay.y * u + drop}px) rotate(${pay.rot + fall * (i % 2 ? 0.6 : -0.6)}deg) scale(${0.6 + 0.4 * p})`,
                opacity: p * interpolate(fall, [0, 30], [1, 0], clamp),
                filter: `blur(${interpolate(fall, [0, 30], [0, 10], clamp) * u}px)`,
                width: 460 * u,
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
              <div style={{ width: 56 * u, height: 56 * u, borderRadius: 16 * u, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="bell" size={30 * u} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22 * u, color: C.muted }}>{pay.title}</div>
                <div style={{ fontSize: 32 * u, fontWeight: 600 }}>{money(pay.amount, true)}</div>
              </div>
              <div style={{ fontSize: 20 * u, color: C.muted }}>now</div>
            </div>
          )
        })}
      </Stage>
      <Caption>
        <div style={{ opacity: firstOut, position: frame >= 116 ? "absolute" : "relative" }}>
          <Words text="Most apps help you **get paid…**" delay={16} size={64} stagger={4} />
        </div>
        {frame >= 112 ? <Words text="…then leave you to **sort out the books.**" delay={116} size={64} stagger={4} /> : null}
      </Caption>
    </AbsoluteFill>
  )
}

// --- 7–9 s: logo -----------------------------------------------------------------

export const Turn: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const p = useIn(8, 14, 90)
  const sweep = interpolate(frame, [0, 36], [-60, 160], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(105deg, transparent ${sweep - 30}%, rgba(61,220,132,0.3) ${sweep}%, transparent ${sweep + 30}%)`,
          filter: "blur(30px)",
        }}
      />
      <RingBurst start={8} size={720 * u} />
      <div style={{ transform: `scale(${0.75 + 0.25 * p})`, opacity: p, filter: `blur(${(1 - p) * 20 * u}px)`, marginBottom: 60 * u }}>
        <Wordmark width={400 * u} />
      </div>
      <div style={{ position: "absolute", bottom: "27%" }}>
        <Words text="521 starts with **the books.**" delay={20} size={56} stagger={4} />
      </div>
    </AbsoluteFill>
  )
}

// --- 9–14 s: accounts connect, transactions sort themselves ------------------------

const TRANSACTIONS = [
  { name: "Pro Supply Co.", amount: -84.2, tag: "Supplies", color: C.amber },
  { name: "Client payments", amount: 312, tag: "Income", color: C.green },
  { name: "Cloud storage", amount: -9.99, tag: "Software & Subscriptions", color: C.blue },
  { name: "Suite 4 rent", amount: -450, tag: "Rent / Booth Rent", color: C.violet },
  { name: "Social ads", amount: -25, tag: "Marketing & Advertising", color: C.rose },
]

export const Sorting: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const list = useIn(34)
  return (
    <AbsoluteFill>
      <Stage tallScale={1.12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
          <div style={{ display: "flex", gap: 18 * u }}>
            <Chip icon="bank" label="Checking" sub="••4821" delay={2} checkAt={14} width={390} />
            <Chip icon="card" label="Card" sub="Business ••1907" delay={10} checkAt={14} width={390} />
          </div>
          <div
            style={{
              width: 800 * u,
              borderRadius: 36 * u,
              padding: `${14 * u}px ${28 * u}px`,
              background: "linear-gradient(165deg, rgba(36,44,48,0.92), rgba(18,22,25,0.92))",
              border: `${1.5 * u}px solid rgba(255,255,255,0.12)`,
              boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.55)`,
              opacity: list,
              transform: `translateY(${(1 - list) * 50 * u}px)`,
              fontFamily,
              color: C.text,
            }}
          >
            {TRANSACTIONS.map((t, i) => {
              const row = interpolate(frame, [40 + i * 12, 52 + i * 12], [0, 1], clamp)
              const tag = useIn(54 + i * 12, 12, 170)
              return (
                <div
                  key={t.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16 * u,
                    padding: `${18 * u}px 0`,
                    borderTop: i ? `1px solid ${C.border}` : undefined,
                    opacity: row,
                    transform: `translateX(${(1 - row) * 60 * u}px)`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 28 * u, fontWeight: 500 }}>{t.name}</div>
                    <div style={{ height: 34 * u, marginTop: 6 * u }}>
                      <span
                        style={{
                          display: "inline-block",
                          background: t.color,
                          color: "#fff",
                          fontSize: 20 * u,
                          fontWeight: 600,
                          borderRadius: 999,
                          padding: `${5 * u}px ${16 * u}px`,
                          opacity: tag,
                          transform: `scale(${0.6 + 0.4 * tag})`,
                          transformOrigin: "left center",
                          boxShadow: `0 0 ${24 * u * tag}px ${t.color}99`,
                        }}
                      >
                        {t.tag}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 30 * u, fontWeight: 600, color: t.amount > 0 ? C.greenBright : C.text }}>{money(t.amount, true)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </Stage>
      <Caption>
        <Words text="Every dollar, **sorted.**" delay={30} size={64} stagger={4} />
      </Caption>
    </AbsoluteFill>
  )
}

// --- 14–18 s: all of the app's categories pour into the foundation ---------------

// The app's expense categories (shared/expenseCategories.ts), plus Income.
const CATEGORIES = [
  "Income",
  "Supplies",
  "Rent / Booth Rent",
  "Equipment",
  "Marketing & Advertising",
  "Software & Subscriptions",
  "Insurance",
  "Interest on Loan",
  "Travel",
  "Vehicle & Transportation",
  "Utilities",
  "Professional Fees",
  "Subcontractor Work",
  "Cleaning & Sanitation",
  "Education & Training",
  "Work Clothing",
  "Payment Processing Fees",
  "Taxes & Licenses",
  "Office Expenses",
  "Miscellaneous / Other",
]
const TAG_COLORS = [C.green, C.amber, C.violet, C.teal, C.rose, C.blue]

export const Foundation: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const slab = useIn(30, 16, 90)
  const count = interpolate(frame, [56, 100], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const flash = useFlash([58, 70, 82])
  return (
    <AbsoluteFill>
      <Stage tallScale={1.12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 * u }}>
          <div style={{ width: 860 * u, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 * u }}>
            {CATEGORIES.map((name, i) => {
              const p = useIn(2 + i * 1.5, 14, 170)
              const fly = interpolate(frame, [46 + (i % 7) * 2, 70 + (i % 7) * 2], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
              const color = TAG_COLORS[i % TAG_COLORS.length]
              return (
                <span
                  key={name}
                  style={{
                    background: color,
                    color: "#fff",
                    fontFamily,
                    fontSize: 22 * u,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: `${8 * u}px ${18 * u}px`,
                    whiteSpace: "nowrap",
                    opacity: p * (1 - fly),
                    transform: `translateY(${(1 - p) * 30 * u + fly * 340 * u}px) scale(${(0.7 + 0.3 * p) * (1 - fly * 0.6)})`,
                    boxShadow: `0 0 ${20 * u}px ${color}77`,
                  }}
                >
                  {name}
                </span>
              )
            })}
          </div>
          <div style={{ opacity: slab, transform: `translateY(${(1 - slab) * 120 * u}px)` }}>
            <Slab width={800} income={BASE.income * count} expenses={BASE.expenses * count} flash={flash} tilt={14} />
          </div>
        </div>
      </Stage>
      <Caption>
        <Words text="Your profit, **always current.**" delay={44} size={64} stagger={4} />
      </Caption>
    </AbsoluteFill>
  )
}

// --- 18–28 s: features drop onto the foundation; money flows down -----------------

const BLOCKS = [
  { icon: "calendar" as const, label: "Booking", detail: "Deposit $10", drop: 10, income: 10, expenses: 0, note: "+$10.00" },
  { icon: "invoice" as const, label: "Invoices", detail: "Paid · matched", drop: 58, income: 250, expenses: 0, note: "+$250.00" },
  { icon: "qr" as const, label: "Payments", detail: "QR + tip", drop: 106, income: 53, expenses: 0, note: "+$53.00" },
  { icon: "receipt" as const, label: "Receipts", detail: "Snap & sort", drop: 154, income: 0, expenses: 84.2, note: "−$84.20" },
]
const BLOCK_W = 180
const GAP = 20
const PULSE = 22 // frames after the drop that money reaches the books

export const BuiltOnTop: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const ats = BLOCKS.map((b) => b.drop + PULSE + 14)
  const income = useTotal(BASE.income, BLOCKS.map((b, i) => ({ at: ats[i], add: b.income })))
  const expenses = useTotal(BASE.expenses, BLOCKS.map((b, i) => ({ at: ats[i], add: b.expenses })))
  const flash = useFlash(ats)
  const rowWidth = BLOCKS.length * BLOCK_W + (BLOCKS.length - 1) * GAP
  const swap = frame >= 214
  return (
    <AbsoluteFill>
      <Stage tallScale={1.12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", gap: GAP * u, width: rowWidth * u }}>
            {BLOCKS.map((b, i) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Block icon={b.icon} label={b.label} detail={b.detail} delay={b.drop} width={BLOCK_W} lit={interpolate(frame, [b.drop + PULSE, b.drop + PULSE + 10], [0, 1], clamp)} />
                <PulseLine height={80} at={b.drop + PULSE} show={interpolate(frame, [b.drop + 10, b.drop + 18], [0, 1], clamp)} />
              </div>
            ))}
          </div>
          <div style={{ position: "relative" }}>
            {BLOCKS.map((b, i) => (
              <div key={b.label} style={{ position: "absolute", top: 0, left: ((800 - rowWidth) / 2 + i * (BLOCK_W + GAP) + BLOCK_W / 2) * u, width: 0 }}>
                <Floater text={b.note} at={ats[i]} negative={b.expenses > 0} />
              </div>
            ))}
            <Slab width={800} income={income} expenses={expenses} flash={flash} tilt={14} />
          </div>
        </div>
      </Stage>
      <Caption>
        <div style={{ opacity: interpolate(frame, [200, 212], [1, 0], clamp), position: swap ? "absolute" : "relative" }}>
          <Words text="Booking. Invoices. Payments. Receipts." delay={12} size={56} stagger={48} weight={400} />
        </div>
        {swap ? <Words text="All **built on your books.**" delay={216} size={66} stagger={5} /> : null}
      </Caption>
    </AbsoluteFill>
  )
}

// --- 28–34 s: one client, start to finish, straight into the books ----------------

const LEDGER = [
  { label: "Deposit · Jordan", amount: 10, at: 30 },
  { label: "Haircut + beard trim · Jordan", amount: 45, at: 80 },
  { label: "Tip · Jordan", amount: 8, at: 88 },
  { label: "Payment Processing Fees", amount: -2.43, at: 96 },
]

export const Trace: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const slab = useIn(0)
  const income = useTotal(AFTER_BLOCKS.income, LEDGER.filter((l) => l.amount > 0).map((l) => ({ at: l.at, add: l.amount })))
  const expenses = useTotal(AFTER_BLOCKS.expenses, LEDGER.filter((l) => l.amount < 0).map((l) => ({ at: l.at, add: -l.amount })))
  const flash = useFlash(LEDGER.map((l) => l.at))
  return (
    <AbsoluteFill>
      <Stage offset={-0.08} tallScale={1.12}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * u }}>
          <Chip icon="calendar" label="Jordan books · Thu 2pm" delay={0} checkAt={10} width={620} />
          <Chip icon="card" label="Pays the deposit · $10" delay={18} checkAt={12} width={620} />
          <Chip icon="qr" label="Pays the rest + tip · $53" delay={66} checkAt={12} width={620} />
          <PulseLine height={50} at={74} show={1} />
          <div style={{ opacity: slab, transform: `translateY(${(1 - slab) * 80 * u}px)` }}>
            <Slab width={800} income={income} expenses={expenses} flash={flash} tilt={10}>
              <div style={{ marginTop: 18 * u, borderTop: `1px solid ${C.border}` }}>
                {LEDGER.map((l) => {
                  const p = interpolate(frame, [l.at, l.at + 10], [0, 1], clamp)
                  return (
                    <div
                      key={l.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 24 * u,
                        padding: `${10 * u * p}px 0`,
                        maxHeight: 50 * u * p,
                        overflow: "hidden",
                        opacity: p,
                      }}
                    >
                      <span style={{ color: C.text }}>{l.label}</span>
                      <span style={{ fontWeight: 600, color: l.amount > 0 ? C.greenBright : C.muted }}>{money(l.amount, true)}</span>
                    </div>
                  )
                })}
              </div>
            </Slab>
          </div>
        </div>
      </Stage>
      <Caption bottom={0.08}>
        <Words text="Nothing to re-enter. **Nothing to reconcile.**" delay={110} size={56} stagger={4} />
      </Caption>
    </AbsoluteFill>
  )
}

// --- 34–39 s: pull back to the whole structure, then the logo ----------------------

export const Close: React.FC = () => {
  const u = useUnit()
  const frame = useCurrentFrame()
  const pull = interpolate(frame, [0, 64], [1, 0.62], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const out = interpolate(frame, [52, 68], [1, 0], clamp)
  const logo = useIn(62, 15, 90)
  const rowWidth = BLOCKS.length * BLOCK_W + (BLOCKS.length - 1) * GAP
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out, transform: `scale(${pull})`, filter: `blur(${(1 - out) * 14 * u}px)` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", gap: GAP * u, width: rowWidth * u }}>
            {BLOCKS.map((b) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Block icon={b.icon} label={b.label} detail={b.detail} delay={-60} width={BLOCK_W} lit={0.6 + 0.4 * Math.sin(frame / 10 + b.drop)} />
                <PulseLine height={80} at={-100} show={1} />
              </div>
            ))}
          </div>
          <Slab width={800} income={AFTER_BLOCKS.income + 63} expenses={AFTER_BLOCKS.expenses + 2.43} flash={0.6} tilt={14} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 44 * u }}>
        <div style={{ opacity: logo, transform: `scale(${0.8 + 0.2 * logo})`, filter: `blur(${(1 - logo) * 16 * u}px)` }}>
          <Wordmark width={360 * u} />
        </div>
        {frame >= 70 ? <Words text="Run the business." delay={72} size={58} stagger={5} weight={400} /> : null}
        {frame >= 84 ? <Words text="**The books run themselves.**" delay={86} size={58} stagger={5} style={{ marginTop: -30 * u }} /> : null}
        {frame >= 104 ? (
          <div style={{ opacity: interpolate(frame, [104, 116], [0, 1], clamp), fontFamily, fontSize: 30 * u, color: C.muted, marginTop: 10 * u }}>the521app.com</div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
