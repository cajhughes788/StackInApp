import React from "react"
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion"
import { Aurora } from "./components/backdrop"
import { Scene, clamp } from "./components/motion"
import { BuiltOnTop, Close, Foundation, Hook, Sorting, Trace, Turn } from "./built/scenes"

export const BUILT_DURATION = 1164 // 38.8 s

// "Built on your books": bookkeeping is the foundation, every feature lands on it.
// Frames at 30 fps; scenes overlap a few frames to blur through.
const SCENES: Array<{ from: number; duration: number; Component: React.FC; fadeIn?: number; fadeOut?: number }> = [
  { from: 0, duration: 215, Component: Hook, fadeIn: 6 },
  { from: 209, duration: 71, Component: Turn },
  { from: 274, duration: 156, Component: Sorting },
  { from: 424, duration: 120, Component: Foundation },
  { from: 538, duration: 308, Component: BuiltOnTop },
  { from: 840, duration: 190, Component: Trace },
  { from: 1024, duration: 140, Component: Close, fadeOut: 1 },
]

export const BuiltOnBooks: React.FC = () => {
  const frame = useCurrentFrame()
  // Dark while money piles up; the light comes up with the logo and stays.
  const glow = interpolate(frame, [0, 200, 230, 300], [0.2, 0.25, 1, 0.7], clamp)
  return (
    <AbsoluteFill>
      <Aurora glow={glow} />
      {SCENES.map(({ from, duration, Component, fadeIn, fadeOut }) => (
        <Sequence key={from} from={from} durationInFrames={duration}>
          <Scene duration={duration} fadeIn={fadeIn} fadeOut={fadeOut}>
            <Component />
          </Scene>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
