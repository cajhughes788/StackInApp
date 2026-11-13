import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"
import { BAYS, BASE, HALL, KEEP, LEVELS, STAIRS, TOWER_BOOKING, TOWER_INVOICES, TOWER_PAYMENTS, TOWER_RECEIPTS, toPoints, type Pt } from "./geometry"

// Every piece outlined on the frame, to check the tracing. Not part of the ad.
const PIECES: Array<[string, Pt[], string]> = [
  ["Foundation", BASE, "#7CFFB2"],
  ["Stairs", STAIRS, "#FFD23F"],
  ["Hall", HALL, "#4CC9F0"],
  ["Booking", TOWER_BOOKING, "#FF4D6D"],
  ["Invoices", TOWER_INVOICES, "#B388FF"],
  ["Payments", TOWER_PAYMENTS, "#FB8500"],
  ["Receipts", TOWER_RECEIPTS, "#F72585"],
  ["Keep", KEEP, "#FFFFFF"],
]

export const CutMap: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Img src={staticFile("palace/frame-final.png")} style={{ width: 1280, height: 720, opacity: 0.8 }} />
    <svg width={1280} height={720} viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
      {BAYS.map((b, i) => (
        <polygon key={`bay${i}`} points={toPoints(b)} fill="none" stroke="#7CFFB2" strokeOpacity={0.25} strokeWidth={0.6} />
      ))}
      {PIECES.map(([name, pts, color]) => (
        <polygon key={name} points={toPoints(pts)} fill={color} fillOpacity={name === "Foundation" ? 0.08 : 0.22} stroke={color} strokeWidth={1.5} />
      ))}
      {LEVELS.booking.slice(0, -1).map((y) => <line key={`b${y}`} x1={340} x2={440} y1={y} y2={y} stroke="#FF4D6D" strokeDasharray="4 3" />)}
      {LEVELS.invoices.slice(0, -1).map((y) => <line key={`i${y}`} x1={485} x2={555} y1={y} y2={y} stroke="#B388FF" strokeDasharray="4 3" />)}
      {LEVELS.receipts.slice(0, -1).map((y) => <line key={`r${y}`} x1={860} x2={945} y1={y} y2={y} stroke="#F72585" strokeDasharray="4 3" />)}
      {LEVELS.keep.slice(0, -1).map((y) => <line key={`k${y}`} x1={540} x2={740} y1={y} y2={y} stroke="#fff" strokeDasharray="4 3" />)}
    </svg>
  </AbsoluteFill>
)
