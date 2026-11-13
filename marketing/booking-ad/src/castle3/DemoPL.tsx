import React from "react"
import { AbsoluteFill } from "remotion"
import { fontFamily } from "../theme"

// The app's Profit & Loss screen with made-up numbers, for the ad's opening
// morph. Mirrors the real screen's layout; nothing here is real data.
// Every figure adds up: 7,150 + 890 + 380 = 8,420; expenses total 2,180; net 6,240.

const BG = "#1A1E21"
const CARD = "#262C31"
const LINE = "rgba(255,255,255,0.08)"
const TEXT = "#ECEBE6"
const MUTED = "#9DA4A8"

const REVENUE = [
  ["Services", "42 transactions", "$7,150.00"],
  ["Tips", "28 transactions", "$890.00"],
  ["Products", "9 transactions", "$380.00"],
]
const EXPENSES = [
  ["Car and truck expenses", "3 expenses", "$186.40"],
  ["Commissions and fees", "12 expenses", "$244.18"],
  ["Legal and professional services", "1 expense", "$150.00"],
  ["Office expense", "4 expenses", "$96.42"],
  ["Rent or lease - other business property", "1 expense", "$900.00"],
  ["Supplies", "6 expenses", "$603.00"],
]

const Chevron = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" style={{ marginLeft: 22 }}>
    <path d="M6 9l6 6 6-6" fill="none" stroke={MUTED} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: CARD, border: `1.5px solid ${LINE}`, borderRadius: 34, padding: "0 26px", ...style }}>{children}</div>
)

const Row: React.FC<{ name: string; sub: string; amount: string; last?: boolean }> = ({ name, sub, amount, last }) => (
  <div style={{ display: "flex", alignItems: "center", padding: "18px 0 20px", borderBottom: last ? "none" : `1.5px solid ${LINE}` }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: TEXT }}>{name}</div>
      <div style={{ fontSize: 18, color: MUTED, marginTop: 6 }}>{sub}</div>
    </div>
    <div style={{ fontSize: 22, fontWeight: 600, color: TEXT }}>{amount}</div>
    <Chevron />
  </div>
)

const Total: React.FC<{ label: string; amount: string }> = ({ label, amount }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0 30px", fontSize: 26, fontWeight: 700, color: TEXT }}>
    <span>{label}</span>
    <span>{amount}</span>
  </div>
)

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 29, fontWeight: 700, color: TEXT, padding: "30px 0 8px" }}>{children}</div>
)

export const DemoPL: React.FC = () => (
  <AbsoluteFill style={{ background: BG, fontFamily, padding: "20px 14px", gap: 32, display: "flex", flexDirection: "column" }}>
    <Card style={{ padding: "34px 32px 32px" }}>
      <div style={{ fontSize: 21, color: MUTED }}>Profit &amp; Loss · Bloom Studio</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: TEXT, marginTop: 10 }}>October 2026</div>
      <div style={{ fontSize: 22, color: MUTED, marginTop: 30 }}>Net income</div>
      <div style={{ fontSize: 76, fontWeight: 800, color: TEXT, letterSpacing: -1, marginTop: 2 }}>$6,240.00</div>
      <div style={{ height: 1.5, background: LINE, margin: "26px 0 26px" }} />
      <div style={{ display: "flex" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, color: MUTED }}>Income</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginTop: 8 }}>$8,420.00</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, color: MUTED }}>Expenses</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginTop: 8 }}>$2,180.00</div>
        </div>
      </div>
    </Card>

    <Card>
      <Heading>Revenue</Heading>
      {REVENUE.map(([n, s, a]) => (
        <Row key={n} name={n} sub={s} amount={a} />
      ))}
      <Total label="Gross profit" amount="$8,420.00" />
    </Card>

    <Card>
      <Heading>Operating expenses</Heading>
      {EXPENSES.map(([n, s, a]) => (
        <Row key={n} name={n} sub={s} amount={a} />
      ))}
      <Total label="Total operating expenses" amount="$2,180.00" />
    </Card>

    <Card style={{ padding: "30px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 29, fontWeight: 700, color: TEXT }}>
        <span>Net income</span>
        <span>$6,240.00</span>
      </div>
    </Card>
  </AbsoluteFill>
)
