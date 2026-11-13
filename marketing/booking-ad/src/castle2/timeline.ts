import { Easing, interpolate } from "remotion"
import { CORNER } from "./geometry"
import type { Build } from "./Castle"

// The 48-second castle ad, in frames at 30 fps.
export const AD_DURATION = 1440

export const T = {
  // 1. Hook
  hookEnd: 150,
  // 2. Layout, cornerstone, frame
  ledgerIn: 150,
  ledgerFlat: [176, 204],
  corner: [204, 222],
  frame: 222, // five levels, 14 frames apart
  // 3. Foundation
  lines: [300, 318],
  tx: [318, 332, 346], // readable transactions start
  fast: [374, 416],
  // 4. Climb to the goal
  steps: [445, 470, 495, 520],
  // 5. Expenses, then the receipt
  expensesIn: 546,
  readable: 552, // six categories, 14 frames apart
  quick: 640, // the other 13, 4 frames apart
  travel: 18,
  receipt: 700,
  receiptLevels: 728,
  // 6. Booking
  booking: 750,
  bookingSteps: [772, 800, 828, 856],
  deposit: [830, 852],
  ring: 862,
  // 7. Invoices
  invoices: 900,
  invoiceLands: [920, 944, 968],
  matchLine: [972, 998],
  matched: 1000,
  // 8. Payments
  payments: 1020,
  qr: [1026, 1046],
  scan: 1050,
  rise: [1054, 1066],
  split: 1070,
  // 9. Keep and transformation
  keep: 1110,
  keepLines: [1114, 1150],
  keepLevels: [1152, 1164, 1176, 1188],
  flare: [1196, 1212],
  real: [1216, 1300],
  // 10. Cornerstone
  end: 1320,
  closeup: [1366, 1392],
  engrave: [1392, 1418],
}

export const EXPENSES = [
  "Supplies", "Rent / Booth Rent", "Software & Subscriptions", "Vehicle & Transportation", "Marketing & Advertising",
  "Payment Processing Fees", "Equipment", "Insurance", "Interest on Loan", "Travel", "Utilities", "Professional Fees",
  "Subcontractor Work", "Cleaning & Sanitation", "Education & Training", "Work Clothing", "Taxes & Licenses",
  "Office Expenses", "Miscellaneous / Other",
]
export const expenseStart = (i: number) => (i < 6 ? T.readable + i * 14 : T.quick + (i - 6) * 4)
export const expenseLand = (i: number) => expenseStart(i) + T.travel

// Camera: [frame, focus x, focus y, zoom] in F pixels.
export const CAM: Array<[number, number, number, number]> = [
  [0, 640, 470, 1.0],
  [150, 640, 450, 0.98],
  [222, 640, 380, 0.95],
  [298, 640, 380, 0.95],
  [326, 640, 540, 1.2],
  [420, 640, 540, 1.2],
  [440, 630, 590, 1.45],
  [538, 630, 590, 1.45],
  [566, 640, 440, 1.1],
  [700, 640, 440, 1.1],
  [714, 900, 420, 1.35],
  [750, 900, 420, 1.35],
  [776, 400, 350, 1.45],
  [900, 400, 350, 1.45],
  [926, 522, 225, 1.5],
  [1020, 522, 225, 1.5],
  [1040, 752, 225, 1.5],
  [1110, 752, 235, 1.5],
  [1140, 640, 330, 1.0],
  [1212, 640, 370, 0.95],
  [1300, 640, 380, 1.0],
  [1322, 640, 380, 1.0],
  [1376, CORNER[0], CORNER[1] - 20, 2.6],
  [1440, CORNER[0], CORNER[1] - 20, 2.75],
]

export const c01 = (v: number) => Math.max(0, Math.min(1, v))
const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) } as const

// A count that steps up by one at each moment, each step easing in over `dur`.
export const steps = (frame: number, ats: number[], dur = 8) => ats.reduce((n, at) => n + interpolate(frame, [at, at + dur], [0, 1], ease), 0)
export const pulse = (frame: number, ats: number[], len = 22) => Math.max(0, ...ats.map((at) => interpolate(frame, [at, at + 3, at + len], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })))

// Where the foundation stands at a frame: three readable transactions fill
// three bays each, then the rest pour in.
export function baysAt(frame: number) {
  const readable = T.tx.map((s) => s + 26)
  const first = readable.reduce((n, at) => n + 3 * interpolate(frame, [at, at + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), 0)
  const rest = interpolate(frame, T.fast, [0, 55], { ...ease, easing: Easing.in(Easing.quad) })
  return first + rest
}

export function buildAt(frame: number): Build {
  const levels = (ats: number[]) => steps(frame, ats, 8)
  const towerDone = (at: number, len = 26) => pulse(frame, [at], len)
  const finale = pulse(frame, [T.keepLines[1], T.flare[0]], 30)
  return {
    frame: steps(frame, [0, 1, 2, 3, 4].map((i) => T.frame + i * 14), 10),
    frameOpacity: interpolate(frame, [T.frame + 70, T.fast[1], T.keep], [1, 0.75, 0.55], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    bays: baysAt(frame),
    stairs: levels(T.steps),
    hall: steps(frame, Array.from({ length: 19 }, (_, i) => expenseLand(i)), 6),
    receipts: levels([0, 6, 12, 18].map((d) => T.receiptLevels + d)),
    booking: levels(T.bookingSteps),
    invoices: levels([...T.invoiceLands, T.matched]),
    payments: interpolate(frame, T.rise, [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }),
    keep: levels(T.keepLevels),
    real: interpolate(frame, T.real, [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) }),
    flash: {
      foundation: Math.max(
        pulse(frame, T.tx.map((s) => s + 26)) * 0.7,
        pulse(frame, [T.fast[1], T.steps[3] + 8, T.deposit[1], T.split + 20, T.split + 26, T.split + 32]),
      ),
      stairs: pulse(frame, T.steps.map((s) => s + 6), 18) * 0.7,
      hall: Math.max(pulse(frame, Array.from({ length: 19 }, (_, i) => expenseLand(i)), 14) * 0.35, pulse(frame, [T.receipt + 40])),
      receipts: towerDone(T.receiptLevels + 24),
      booking: towerDone(T.bookingSteps[3] + 8),
      invoices: towerDone(T.matched + 4),
      payments: towerDone(T.rise[1]),
      keep: towerDone(T.keepLevels[3] + 8),
      all: finale * 0.8,
    },
  }
}

export const PAYMENT_CARDS: Array<{ app: string; letter?: string; icon?: "phone" | "bill" | "invoice"; color: string; amount: string }> = [
  { app: "Venmo", letter: "V", color: "#008CFF", amount: "+$120.00" },
  { app: "Apple Pay", icon: "phone", color: "#111111", amount: "+$45.00" },
  { app: "Zelle", letter: "Z", color: "#6D1ED4", amount: "+$60.00" },
  { app: "Cash App", letter: "$", color: "#00C244", amount: "+$35.00" },
  { app: "Square", letter: "S", color: "#2A2F33", amount: "+$80.00" },
  { app: "Cash", icon: "bill", color: "#2E7D4F", amount: "+$40.00" },
  { app: "Check", icon: "invoice", color: "#4A5560", amount: "+$250.00" },
]
