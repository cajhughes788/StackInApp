import React from "react"
import { Composition } from "remotion"
import { BookingAd } from "./BookingAd"
import { BUILT_DURATION, BuiltOnBooks } from "./BuiltOnBooks"
import { CastleDebug } from "./castle/Debug"
import { CutMap } from "./castle2/CutMap"
import { CastleStrip, STRIP_FRAMES } from "./castle2/Strip"
import { CastleAd2 } from "./castle2/Ad"
import { AD_DURATION } from "./castle2/timeline"
import { TEXT_AD_DURATION, TextAd } from "./castle3/TextAd"
import { DemoPL } from "./castle3/DemoPL"
import { CASTLE_DURATION, CastleAd } from "./castle/CastleAd"
import { DURATION, FPS } from "./theme"
import { BSP_DURATION, BookShowPay } from "./bsp/BookShowPay"
import { CleanShot } from "./bsp/Clean"

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="BookShowPayVertical" component={BookShowPay} durationInFrames={BSP_DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="CleanShot" component={CleanShot} defaultProps={{ file: "06-owner-calendar.png", kind: "app" as const }} durationInFrames={1} fps={FPS} width={1206} height={2622} />
    <Composition id="BookShowPaySquare" component={BookShowPay} durationInFrames={BSP_DURATION} fps={FPS} width={1080} height={1080} />
    <Composition id="BookingAdVertical" component={BookingAd} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="BookingAdSquare" component={BookingAd} durationInFrames={DURATION} fps={FPS} width={1080} height={1080} />
    <Composition id="BookingAdWide" component={BookingAd} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="BuiltOnBooksVertical" component={BuiltOnBooks} durationInFrames={BUILT_DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="BuiltOnBooksSquare" component={BuiltOnBooks} durationInFrames={BUILT_DURATION} fps={FPS} width={1080} height={1080} />
    <Composition id="BuiltOnBooksWide" component={BuiltOnBooks} durationInFrames={BUILT_DURATION} fps={FPS} width={1920} height={1080} />
    {/* The castle ad: with the faint plan of the whole castle from the start, or without. */}
    {([
      ["Vertical", 1080, 1920],
      ["Square", 1080, 1080],
      ["Wide", 1920, 1080],
    ] as const).flatMap(([name, w, h]) => [
      <Composition key={`plan-${name}`} id={`Castle${name}Plan`} component={CastleAd} defaultProps={{ plan: true }} durationInFrames={CASTLE_DURATION} fps={FPS} width={w} height={h} />,
      <Composition key={`noplan-${name}`} id={`Castle${name}NoPlan`} component={CastleAd} defaultProps={{ plan: false }} durationInFrames={CASTLE_DURATION} fps={FPS} width={w} height={h} />,
    ])}
    <Composition id="BooksTextVertical" component={TextAd} durationInFrames={TEXT_AD_DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="DemoPL" component={DemoPL} durationInFrames={1} fps={FPS} width={1160} height={1786} />
    <Composition id="BooksTextVerticalCards"component={TextAd} defaultProps={{ cards: true }} durationInFrames={TEXT_AD_DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="BooksTextSquare"component={TextAd} durationInFrames={TEXT_AD_DURATION} fps={FPS} width={1080} height={1080} />
    <Composition id="BooksTextWide" component={TextAd} durationInFrames={TEXT_AD_DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="BuiltOnBooksVertical48"component={CastleAd2} durationInFrames={AD_DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="BuiltOnBooksSquare48" component={CastleAd2} durationInFrames={AD_DURATION} fps={FPS} width={1080} height={1080} />
    <Composition id="BuiltOnBooksWide48" component={CastleAd2} durationInFrames={AD_DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="CastleStrip"component={CastleStrip} durationInFrames={STRIP_FRAMES} fps={FPS} width={1280} height={720} />
    <Composition id="CutMap"component={CutMap} durationInFrames={1} fps={FPS} width={1280} height={720} />
    <Composition id="CastleDebug" component={CastleDebug} durationInFrames={1} fps={FPS} width={1024} height={1024} />
  </>
)
