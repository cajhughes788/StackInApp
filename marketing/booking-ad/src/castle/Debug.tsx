import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"
import { PARTS } from "./parts"

// Outlines over the castle, to check the tracing. Not part of the ad.
const COLORS = ["#ff4d6d", "#ffd23f", "#3bceac", "#5e60ce", "#f72585", "#4cc9f0", "#fb8500", "#ffffff"]

export const CastleDebug: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Img src={staticFile("palace/palace.png")} style={{ width: 1024, height: 1024 }} />
    <svg width={1024} height={1024} style={{ position: "absolute", inset: 0 }}>
      {Object.values(PARTS).map((pts, i) => (
        <polygon
          key={i}
          points={pts.map((p) => p.join(",")).join(" ")}
          fill={COLORS[i]}
          fillOpacity={0.28}
          stroke={COLORS[i]}
          strokeWidth={2}
        />
      ))}
    </svg>
  </AbsoluteFill>
)
