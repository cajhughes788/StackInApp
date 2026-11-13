import React from "react"
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion"
import { Aurora } from "./components/backdrop"
import { Scene, clamp } from "./components/motion"
import { LogoReveal, Opening } from "./scenes/opening"
import { ClientBooks, Notify, Services, Share } from "./scenes/setup"
import { Books, Ending, GetPaid } from "./scenes/money"

// The timeline, in frames at 30 fps. Scenes overlap by a few frames so each
// cut is a blur-through rather than a hard cut.
const SCENES: Array<{ from: number; duration: number; Component: React.FC; fadeIn?: number; fadeOut?: number }> = [
  { from: 0, duration: 212, Component: Opening, fadeIn: 6 },
  { from: 206, duration: 66, Component: LogoReveal },
  { from: 266, duration: 126, Component: Services },
  { from: 386, duration: 126, Component: Share },
  { from: 506, duration: 126, Component: ClientBooks },
  { from: 626, duration: 96, Component: Notify },
  { from: 716, duration: 156, Component: GetPaid },
  { from: 866, duration: 96, Component: Books },
  { from: 956, duration: 124, Component: Ending, fadeOut: 1 },
]

export const BookingAd: React.FC = () => {
  const frame = useCurrentFrame()
  // Light comes up after the dark opening and swells at the logo and payment.
  const glow =
    interpolate(frame, [0, 200, 230, 280], [0.25, 0.35, 1, 0.65], clamp) +
    interpolate(frame, [820, 836, 880], [0, 0.35, 0], clamp)
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
