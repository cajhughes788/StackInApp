import React from "react"
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { Castle, EMPTY, type Build } from "./Castle"

// The castle at each stage of the build, one stage per frame. A check, not part of the ad.
const STAGES: Array<Partial<Build>> = [
  { frame: 2 },
  { frame: 5 },
  { frame: 5, bays: 20 },
  { frame: 5, bays: 64 },
  { frame: 5, bays: 64, stairs: 4 },
  { frame: 5, bays: 64, stairs: 4, hall: 9 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4, booking: 2 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4, booking: 4, invoices: 4 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4, booking: 4, invoices: 4, payments: 1, keep: 2 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4, booking: 4, invoices: 4, payments: 1, keep: 4 },
  { frame: 5, bays: 64, stairs: 4, hall: 19, receipts: 4, booking: 4, invoices: 4, payments: 1, keep: 4, real: 0.5 },
]

export const STRIP_FRAMES = STAGES.length

export const CastleStrip: React.FC = () => {
  const frame = useCurrentFrame()
  const build = { ...EMPTY, ...STAGES[Math.min(frame, STAGES.length - 1)] }
  return (
    <AbsoluteFill style={{ background: "#05080A" }}>
      <Castle build={build} cam={{ fx: 640, fy: 360, z: 1 }} />
    </AbsoluteFill>
  )
}
