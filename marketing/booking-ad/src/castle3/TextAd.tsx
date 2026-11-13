import React from "react"
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { C, useUnit } from "../theme"
import { Words, clamp } from "../components/motion"
import { Aurora } from "../components/backdrop"
import { CheckDot, Icon, Qr, type Glyph } from "../components/ui"
import { fontFamily } from "../theme"

// "Built on your books", text first: the castle builds quietly in the
// background from the stage images (public/build), one part per line.
// Image space is the stages' 2048×1152; the camera never moves except a slow push.

export const TEXT_AD_DURATION = 1170 // 39 s

const IMG_W = 2048
const IMG_H = 1152
const CASTLE = { cx: 1030, cy: 570, w: 1140 }
const FRONT_CORNER = [990, 1090]
const HALO = [1195, 230]
const LOGO = [1080, 640] // the 521 on the cornerstone image
const UPLIGHT = [937, 1024] // the ground light under the cornerstone
const ZOOM_AT = [1180, 1050] // right of the staircase, at the bottom

const src = (f: string) => staticFile(`build/${f}`)

// --- Timeline -------------------------------------------------------------------
const T = {
  foundation: [14, 100],
  frameHall: [136, 210],
  booking: [236, 446],
  invoices: [470, 566],
  payments: [614, 668],
  qrProject: [670, 696],
  qrForward: [694, 720],
  scan: 734,
  qrDrop: [778, 800],
  real: [826, 916],
  shimmer: [918, 940], // a beat after the castle is real, every light comes on at once
  zoom: [940, 1020], // the push in toward the stairs (end-a in the cards version)
  beam: [986, 1020], // the light rises as we close in...
  whiteOut: [1020, 1060], // ...whites out over the join, and the descent (end-b) comes out of it
  cornerstone: [1074, 1082],
  download: 1086,
}

const ease = { ...clamp, easing: Easing.inOut(Easing.cubic) }
const pulse = (frame: number, at: number, len = 24) => interpolate(frame, [at, at + 4, at + len], [0, 1, 0], clamp)

// Image space → screen.
function useView() {
  const { width, height } = useVideoConfig()
  const frame = useCurrentFrame()
  const tall = height > width * 1.5
  const base = tall ? (width * 1.12) / CASTLE.w : Math.min((width * 0.62) / CASTLE.w, (height * 0.96) / 1080)
  // A slow push the whole way, then the dive toward the stairs at the end.
  const zp = interpolate(frame, T.zoom, [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const s = base * interpolate(frame, [0, TEXT_AD_DURATION], [1, 1.07]) * (1 + zp * 1.8)
  const fx = CASTLE.cx + (ZOOM_AT[0] - CASTLE.cx) * zp
  const fy = CASTLE.cy + (ZOOM_AT[1] - CASTLE.cy) * zp
  const cy = height * (tall ? 0.5 : 0.5)
  const at = (x: number, y: number) => ({ x: width / 2 + (x - fx) * s, y: cy + (y - fy) * s })
  const origin = at(0, 0)
  return { s, at, origin, width, height, tall }
}

// A stage image revealed inside its change mask, rising from the bottom of `range`.
const Rise: React.FC<{ file: string; mask?: string; p: number; range: [number, number] }> = ({ file, mask, p, range }) => {
  if (p <= 0) return null
  const y = range[1] - p * (range[1] - range[0])
  const done = p >= 1
  const outer: React.CSSProperties = mask
    ? { maskImage: `url(${src(mask)})`, WebkitMaskImage: `url(${src(mask)})`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }
    : {}
  const scan = `linear-gradient(to top, black ${IMG_H - y - 10}px, transparent ${IMG_H - y + 30}px)`
  const edge = `linear-gradient(to top, transparent ${IMG_H - y - 60}px, black ${IMG_H - y - 8}px, black ${IMG_H - y + 6}px, transparent ${IMG_H - y + 30}px)`
  return (
    <div style={{ position: "absolute", inset: 0, ...outer }}>
      <div style={{ position: "absolute", inset: 0, ...(done ? {} : { maskImage: scan, WebkitMaskImage: scan }) }}>
        <Img src={src(file)} style={{ width: IMG_W, height: IMG_H }} />
      </div>
      {!done ? (
        // The building edge: the same image, brighter, in a thin band at the line.
        <div style={{ position: "absolute", inset: 0, maskImage: edge, WebkitMaskImage: edge, filter: "brightness(2.4) saturate(1.3)" }}>
          <Img src={src(file)} style={{ width: IMG_W, height: IMG_H }} />
        </div>
      ) : null}
    </div>
  )
}

// The foundation, laid outward from the front corner.
const Laid: React.FC<{ p: number }> = ({ p }) => {
  if (p <= 0) return null
  const r = p * 1500
  const fill = `radial-gradient(circle at ${FRONT_CORNER[0]}px ${FRONT_CORNER[1]}px, black ${r - 40}px, transparent ${r + 40}px)`
  const ring = `radial-gradient(circle at ${FRONT_CORNER[0]}px ${FRONT_CORNER[1]}px, transparent ${r - 90}px, black ${r - 20}px, transparent ${r + 30}px)`
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", inset: 0, ...(p < 1 ? { maskImage: fill, WebkitMaskImage: fill } : {}) }}>
        <Img src={src("stage-1.png")} style={{ width: IMG_W, height: IMG_H }} />
      </div>
      {p < 1 ? (
        <div style={{ position: "absolute", inset: 0, maskImage: ring, WebkitMaskImage: ring, filter: "brightness(2.6)" }}>
          <Img src={src("stage-1.png")} style={{ width: IMG_W, height: IMG_H }} />
        </div>
      ) : null}
    </div>
  )
}

// The opening of the cards version: the P&L melts and pours into the foundation
// (an ElevenLabs clip whose last frame matches stage-1), then hands off to stage-1.
const MORPH_FRAMES = 121 // 4.03 s
const PourIntoFoundation: React.FC = () => {
  const frame = useCurrentFrame()
  const handoff = interpolate(frame, [MORPH_FRAMES - 10, MORPH_FRAMES - 1], [0, 1], clamp)
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {frame < MORPH_FRAMES ? (
        // Contrast crushes the clip's dark grey floor to black so it screens away cleanly.
        <div style={{ position: "absolute", inset: 0, opacity: 1 - handoff, filter: "contrast(1.25) brightness(0.92)" }}>
          <OffthreadVideo src={src("morph-pl.mp4")} muted style={{ width: IMG_W, height: IMG_H }} />
        </div>
      ) : null}
      <div style={{ position: "absolute", inset: 0, opacity: handoff }}>
        <Img src={src("stage-1.png")} style={{ width: IMG_W, height: IMG_H }} />
      </div>
      {/* The video redraws the panel's numbers slightly, so hold the exact start
          image (figures that add up) until the moment it begins to melt. */}
      {frame < 40 ? (
        <div style={{ position: "absolute", inset: 0, opacity: interpolate(frame, [30, 39], [1, 0], clamp) }}>
          <Img src={src("start-pl.png")} style={{ width: IMG_W, height: IMG_H }} />
        </div>
      ) : null}
    </div>
  )
}

// --- The castle in the background -----------------------------------------------

const CastleBackground: React.FC<{ dim: number; blur: number; glow: number; morph?: boolean }> = ({ dim, blur, glow, morph }) => {
  const frame = useCurrentFrame()
  const v = useView()
  const p = (r: number[]) => interpolate(frame, r, [0, 1], ease)
  const real = interpolate(frame, T.real, [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) })
  const lineY = IMG_H + 40 - real * (IMG_H + 80)
  const flash = Math.max(pulse(frame, T.booking[1]), pulse(frame, T.invoices[1]), pulse(frame, T.payments[1]) * 1.2, pulse(frame, T.qrDrop[1], 30))
  const stage: React.CSSProperties = {
    position: "absolute",
    left: v.origin.x,
    top: v.origin.y,
    width: IMG_W,
    height: IMG_H,
    transformOrigin: "0 0",
    transform: `scale(${v.s})`,
  }
  const realMask = `linear-gradient(to bottom, transparent ${lineY - 40}px, black ${lineY + 4}px)`
  const holoMask = `linear-gradient(to bottom, black ${lineY - 4}px, transparent ${lineY + 30}px)`
  return (
    <AbsoluteFill style={{ filter: `brightness(${1 - dim}) blur(${blur}px)` }}>
      {/* The glow lives inside this layer so the screened hologram has something to blend with. */}
      <Aurora glow={glow} streaks={false} />
      {/* The world around the real castle, soft, revealed with the same line. */}
      {real > 0 ? (
        <AbsoluteFill style={{ maskImage: `linear-gradient(to bottom, transparent ${v.origin.y + lineY * v.s - 60}px, black ${v.origin.y + lineY * v.s + 10}px)`, WebkitMaskImage: `linear-gradient(to bottom, transparent ${v.origin.y + lineY * v.s - 60}px, black ${v.origin.y + lineY * v.s + 10}px)` }}>
          <Img src={staticFile("palace/palace-final.png")} style={{ position: "absolute", inset: -60, width: "calc(100% + 120px)", height: "calc(100% + 120px)", objectFit: "cover", filter: "blur(24px) brightness(0.6)" }} />
        </AbsoluteFill>
      ) : null}
      {real > 0 ? (
        <div style={{ ...stage, maskImage: realMask, WebkitMaskImage: realMask }}>
          <div style={{ position: "absolute", inset: 0, maskImage: "linear-gradient(to bottom, transparent 0, black 90px, black 1060px, transparent 1152px), linear-gradient(to right, transparent 0, black 140px, black 1908px, transparent 2048px)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 90px, black 1060px, transparent 1152px), linear-gradient(to right, transparent 0, black 140px, black 1908px, transparent 2048px)", maskComposite: "intersect", WebkitMaskComposite: "source-in" }}>
            <Img src={staticFile(morph ? "palace/palace-lights-off.png" : "palace/palace-final.png")} style={{ width: IMG_W, height: IMG_H }} />
            {morph ? <LightsOn /> : null}
          </div>
        </div>
      ) : null}
      {/* The hologram build, light on black, screened over the backdrop. */}
      <div style={{ ...stage, mixBlendMode: "screen", ...(real > 0 ? { maskImage: holoMask, WebkitMaskImage: holoMask } : {}), filter: flash > 0 ? `brightness(${1 + flash * 0.5})` : undefined }}>
        <div style={{ position: "absolute", inset: 0, isolation: "isolate" }}>
          {morph ? <PourIntoFoundation /> : <Laid p={p(T.foundation)} />}
          <Rise file="stage-2.png" mask="alpha-2.png" p={p(T.frameHall)} range={[20, 1152]} />
          <Rise file="stage-3.png" mask="alpha-3.png" p={p(T.booking)} range={[285, 805]} />
          <Rise file="stage-4.png" mask="alpha-4.png" p={p(T.invoices)} range={[150, 530]} />
          <Rise file="stage-5.png" mask="alpha-5.png" p={interpolate(frame, T.payments, [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} range={[140, 570]} />
        </div>
      </div>
      {real > 0 && real < 1 ? (
        <div style={stage}>
          <div style={{ position: "absolute", left: -800, right: -800, top: lineY - 2, height: 4, background: "#F4FFF8", boxShadow: "0 0 14px #3DDC84, 0 0 40px #3DDC84, 0 0 90px rgba(61,220,132,0.6)" }} />
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// --- The finished castle catches the light -------------------------------------------

// The castle arrives dark (palace-lights-off.png, the same picture with its warm lights
// dimmed), then every light comes on at once with a small pop of glow that settles.
const LightsOn: React.FC = () => {
  const frame = useCurrentFrame()
  const at = T.shimmer[0]
  const on = interpolate(frame, [at, at + 3], [0, 1], clamp)
  const pop = interpolate(frame, [at, at + 2, at + 16], [0, 1, 0], { ...clamp, easing: Easing.out(Easing.quad) })
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: on }}>
        <Img src={staticFile("palace/palace-final.png")} style={{ width: IMG_W, height: IMG_H }} />
      </div>
      {pop > 0 ? (
        <>
          {/* The lights flare a touch brighter than they settle... */}
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "screen", filter: "brightness(1.5)", opacity: pop * 0.55 }}>
            <Img src={staticFile("palace/palace-final.png")} style={{ width: IMG_W, height: IMG_H }} />
          </div>
          {/* ...with a soft halo of their own glow. */}
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "screen", filter: "blur(22px) brightness(1.8)", opacity: pop * 0.5 }}>
            <Img src={staticFile("palace/palace-final.png")} style={{ width: IMG_W, height: IMG_H }} />
          </div>
        </>
      ) : null}
    </>
  )
}

// --- The QR moment ---------------------------------------------------------------

const QrMoment: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const v = useView()
  if (frame < T.qrProject[0] || frame > T.qrDrop[1] + 2) return null
  const halo = v.at(HALO[0], HALO[1])
  const project = interpolate(frame, T.qrProject, [0, 1], ease)
  const forward = interpolate(frame, T.qrForward, [0, 1], ease)
  const drop = interpolate(frame, T.qrDrop, [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const corner = v.at(FRONT_CORNER[0], FRONT_CORNER[1] - 60)
  const big = Math.min(v.width, v.height) * (v.tall ? 0.62 : 0.42)
  const small = 120 * u
  const center = { x: v.width / 2, y: v.height * (v.tall ? 0.4 : 0.38) }
  const near = { x: halo.x + (v.width / 2 - halo.x) * 0.25, y: halo.y + 160 * u }
  let x = near.x + (center.x - near.x) * forward
  let y = near.y + (center.y - near.y) * forward
  let size = small + (big - small) * forward
  if (drop > 0) {
    x = center.x + (corner.x - center.x) * drop
    y = center.y + (corner.y - center.y) * drop
    size = big * (1 - drop * 0.95)
  }
  const paid = interpolate(frame, [T.scan, T.scan + 8], [0, 1], clamp)
  const scanLine = interpolate(frame, [T.scan - 14, T.scan], [0, 1], clamp)
  const beam = project * (1 - forward)
  return (
    <AbsoluteFill>
      {beam > 0 ? (
        <svg width={v.width} height={v.height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id="beam" x1={halo.x} y1={halo.y} x2={x} y2={y} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#7CFFB2" stopOpacity={0.7} />
              <stop offset="1" stopColor="#7CFFB2" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <polygon points={`${halo.x},${halo.y} ${x - size / 2},${y - size / 2} ${x + size / 2},${y - size / 2} ${x + size / 2},${y + size / 2} ${x - size / 2},${y + size / 2}`} fill="url(#beam)" opacity={beam} />
        </svg>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          opacity: project * (1 - interpolate(drop, [0.8, 1], [0, 1], clamp)),
          background: "#ECEBE6",
          borderRadius: size * 0.08,
          padding: size * 0.07,
          boxSizing: "border-box",
          boxShadow: `0 0 ${size * 0.35}px rgba(61,220,132,${0.35 + paid * 0.4}), 0 ${size * 0.08}px ${size * 0.25}px rgba(0,0,0,0.6)`,
          border: `${Math.max(2, size * 0.012)}px solid rgba(61,220,132,${paid})`,
        }}
      >
        <Qr size={size * 0.86} reveal={project} />
        {scanLine > 0 && scanLine < 1 ? <div style={{ position: "absolute", left: 0, right: 0, top: `${scanLine * 100}%`, height: Math.max(3, size * 0.012), background: C.greenBright, boxShadow: `0 0 ${size * 0.06}px ${C.greenBright}` }} /> : null}
        <div style={{ position: "absolute", inset: 0, borderRadius: size * 0.08, background: `rgba(22,27,30,${0.88 * paid})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ opacity: paid }}>
            <CheckDot size={size * 0.4} progress={paid} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

// --- Text --------------------------------------------------------------------------

const Center: React.FC<{ from: number; to: number; lines: string[]; y?: number; delays?: number[]; scale?: number; weight?: number; grow?: number }> = ({
  from,
  to,
  lines,
  y,
  delays,
  scale = 1,
  weight = 400,
  grow = 0,
}) => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { height, width } = useVideoConfig()
  const tall = height > width * 1.5
  const out = interpolate(frame, [to - 10, to], [1, 0], clamp)
  const size = (tall ? 84 : width > height ? 76 : 70) * scale
  // `grow` pushes the words toward the viewer over the scene.
  const zoom = 1 + grow * interpolate(frame, [from, to], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) })
  return (
    <Sequence from={from} durationInFrames={to - from}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out, ...(y !== undefined ? { justifyContent: "flex-start", paddingTop: y * height } : {}) }}>
        <div style={{ maxWidth: (tall ? 960 : 1300) * u * Math.max(1, scale * 0.9), display: "flex", flexDirection: "column", gap: 10 * u * scale, transform: `scale(${zoom})` }}>
          {lines.map((line, i) => (
            <Words key={line} text={line} delay={delays?.[i] ?? 2 + i * 16} size={size} stagger={3} weight={weight} style={weight > 500 ? { textShadow: "0 4px 40px rgba(0,0,0,0.6)" } : undefined} />
          ))}
        </div>
      </AbsoluteFill>
    </Sequence>
  )
}

// --- The end: the engraved cornerstone ------------------------------------------------

const Cornerstone: React.FC = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const show = interpolate(frame, T.cornerstone, [0, 1], ease)
  if (show <= 0) return null
  // Cover the screen, centered on the logo, with a slow push.
  const s = Math.max(width / IMG_W, height / IMG_H) * (1.04 + (frame - T.cornerstone[0]) * 0.0006)
  const left = Math.min(0, Math.max(width - IMG_W * s, width / 2 - LOGO[0] * s))
  const top = Math.min(0, Math.max(height - IMG_H * s, height / 2 - LOGO[1] * s))
  const glow = 0.5 + 0.5 * pulse(frame, T.whiteOut[1] - 4, 50)
  const bar = { x: left + 1260 * s, y: top + 762 * s }
  return (
    <AbsoluteFill style={{ opacity: show, background: C.bg }}>
      <Img src={src("cornerstone.png")} style={{ position: "absolute", left, top, width: IMG_W * s, height: IMG_H * s }} />
      <div style={{ position: "absolute", left: bar.x - 160 * s, top: bar.y - 60 * s, width: 320 * s, height: 120 * s, borderRadius: "50%", background: "radial-gradient(ellipse at center, rgba(61,220,132,0.5), rgba(61,220,132,0) 70%)", opacity: glow, mixBlendMode: "screen" }} />
    </AbsoluteFill>
  )
}



// --- The cards version's end: two ElevenLabs clips, joined under the light -------------------

// end-a: starts exactly on palace-final and pushes in toward the stairs (its first 64 frames, 24 fps).
// end-b: a pull-back from the cornerstone, reversed, so it comes down onto the stone and holds there.
const END_A_FRAMES = Math.round((64 / 24) * 30)
const END_B = { rate: 0.8, cx: 0.52 }

// Where a 1280×720 clip covers the screen, centered on `cx` across.
function cover(width: number, height: number, cx: number) {
  const s = Math.max(width / 1280, height / 720)
  return { s, left: Math.min(0, Math.max(width - 1280 * s, width / 2 - cx * 1280 * s)), top: (height - 720 * s) / 2 }
}

const EndPushIn: React.FC = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const start = T.zoom[0]
  if (frame < start || frame > T.whiteOut[0] + 8) return null
  // Begin exactly where the real castle sits on screen, and grow to fill the frame.
  const tall = height > width * 1.5
  const base = tall ? (width * 1.12) / CASTLE.w : Math.min((width * 0.62) / CASTLE.w, (height * 0.96) / 1080)
  const s0 = (base * interpolate(start, [0, TEXT_AD_DURATION], [1, 1.07]) * IMG_W) / 1280
  const a = { s: s0, left: width / 2 - (CASTLE.cx / 1.6) * s0, top: height / 2 - (CASTLE.cy / 1.6) * s0 }
  const b = cover(width, height, 0.5)
  const p = interpolate(frame, [start, start + END_A_FRAMES], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const sc = a.s + (b.s - a.s) * p
  const left = a.left + (b.left - a.left) * p
  const top = a.top + (b.top - a.top) * p
  const fadeIn = interpolate(frame, [start, start + 6], [0, 1], clamp)
  const bright = interpolate(frame, [start, start + 40], [0.85, 1], clamp)
  const edge = "linear-gradient(to bottom, transparent 0, black 56px, black 664px, transparent 720px), linear-gradient(to right, transparent 0, black 88px, black 1192px, transparent 1280px)"
  const clip = (style: React.CSSProperties) => (
    <Sequence from={start} layout="none">
      <OffthreadVideo src={src("end-a.mp4")} muted style={style} />
    </Sequence>
  )
  return (
    <AbsoluteFill style={{ opacity: fadeIn, filter: `brightness(${bright})`, overflow: "hidden" }}>
      {/* The same shot, soft, around it until it fills the frame itself. */}
      {clip({ position: "absolute", inset: -60, width: "calc(100% + 120px)", height: "calc(100% + 120px)", objectFit: "cover", filter: "blur(24px) brightness(0.6)" })}
      <div style={{ position: "absolute", left, top, width: 1280, height: 720, transformOrigin: "0 0", transform: `scale(${sc})`, maskImage: p < 1 ? edge : undefined, WebkitMaskImage: p < 1 ? edge : undefined, maskComposite: "intersect", WebkitMaskComposite: "source-in" }}>
        {clip({ width: 1280, height: 720 })}
      </div>
    </AbsoluteFill>
  )
}

const EndDescent: React.FC = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  // It holds on its own last frame to the end, so the stone never shifts once we land.
  if (frame < T.whiteOut[0]) return null
  const c = cover(width, height, END_B.cx)
  return (
    <Sequence from={T.whiteOut[0]} layout="none">
      <OffthreadVideo src={src("end-b.mp4")} muted playbackRate={END_B.rate} style={{ position: "absolute", left: c.left, top: c.top, width: 1280 * c.s, height: 720 * c.s }} />
    </Sequence>
  )
}

// --- The light: shoots up from the ground at the cornerstone's angle, whites out, fades to the stone ----

// Where the cornerstone image sits on screen (cover, centered on the logo, slow push).
function stoneView(frame: number, width: number, height: number) {
  const s = Math.max(width / IMG_W, height / IMG_H) * (1.04 + Math.max(0, frame - T.cornerstone[0]) * 0.0006)
  const left = Math.min(0, Math.max(width - IMG_W * s, width / 2 - LOGO[0] * s))
  const top = Math.min(0, Math.max(height - IMG_H * s, height / 2 - LOGO[1] * s))
  return { s, left, top }
}

const LightBurst: React.FC<{ fromStairs?: boolean }> = ({ fromStairs }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  if (frame < T.beam[0] || frame > T.whiteOut[1] + 2) return null
  const v = stoneView(T.cornerstone[0], width, height)
  // The beam starts where the ground light sits in the last shot, so the light carries through;
  // in the cards version it rises from the stairs we're pushing into, over the join of the two clips.
  const ox = fromStairs ? width / 2 : v.left + UPLIGHT[0] * v.s
  const oy = fromStairs ? height + 40 : Math.min(height + 40, v.top + UPLIGHT[1] * v.s)
  const rise = interpolate(frame, T.beam, [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  const white = interpolate(frame, [T.beam[1] - 10, T.beam[1], T.whiteOut[0] + 4, T.whiteOut[1] - 18], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.sin) })
  // The beam itself dims over the next two seconds, like a light powering down.
  const fade = interpolate(frame, [T.whiteOut[0], T.whiteOut[1]], [1, 0], { ...clamp, easing: Easing.inOut(Easing.sin) })
  const reach = rise * height * 1.4
  const spread = width * (0.15 + rise * 1.1)
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}>
        <defs>
          <linearGradient id="up" x1={ox} y1={oy} x2={ox} y2={oy - reach} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFF6E6" stopOpacity={1} />
            <stop offset="0.35" stopColor="#FFD9A0" stopOpacity={0.85} />
            <stop offset="1" stopColor="#FFD9A0" stopOpacity={0} />
          </linearGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation={30} />
          </filter>
        </defs>
        {/* The cone of light, fanning up from the fixture */}
        <polygon points={`${ox - 30},${oy} ${ox + 30},${oy} ${ox + spread},${oy - reach} ${ox - spread * 0.8},${oy - reach}`} fill="url(#up)" opacity={Math.min(1, rise * 1.6) * fade} filter="url(#soft)" />
        <polygon points={`${ox - 8},${oy} ${ox + 8},${oy} ${ox + spread * 0.25},${oy - reach} ${ox - spread * 0.2},${oy - reach}`} fill="#FFFFFF" opacity={rise * 0.9 * fade} filter="url(#soft)" />
        <ellipse cx={ox} cy={oy} rx={140 + rise * 300} ry={50 + rise * 120} fill="#FFF3DD" opacity={rise * fade} filter="url(#soft)" />
      </svg>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 120% 90% at ${(ox / width) * 100}% 100%, #FFFDF8 0%, #FFF0D6 55%, #F6E2C0 100%)`, opacity: white }} />
    </AbsoluteFill>
  )
}

// "Start using 521 today" over the stone.
const Download: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { width, height } = useVideoConfig()
  const tall = height > width * 1.5
  if (frame < T.download) return null
  const sub = interpolate(frame, [T.download + 24, T.download + 38], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * (tall ? 0.14 : 0.09) }}>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(5,8,10,0.8) 0%, rgba(5,8,10,0.35) 26%, rgba(5,8,10,0) 45%)", opacity: interpolate(frame, [T.download, T.download + 14], [0, 1], clamp) }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 * u }}>
        <Words text="Start using **521 today.**" delay={T.download} size={tall ? 78 : 64} stagger={3} weight={700} style={{ textShadow: "0 4px 30px rgba(0,0,0,0.7)" }} />
        <div style={{ opacity: sub, fontFamily, fontSize: (tall ? 30 : 26) * u, color: "rgba(236,235,230,0.8)", letterSpacing: 0.5 }}>Download free · 30-day free trial</div>
      </div>
    </AbsoluteFill>
  )
}

// The voiceover, line by line: [start, end] in the recording (seconds) → frame it plays at.
const VO: Array<[number, number, number]> = [
  [0.0, 2.3, 12], // 521 starts with the books.
  [2.55, 4.85, 128], // Everything we build… stands on them.
  [5.12, 7.05, 218], // Share your booking link anywhere.
  [7.22, 9.68, 284], // Clients book in seconds, no app needed.
  [9.82, 12.1, 382], // Deposits land right in your books.
  [12.2, 14.22, 464], // Invoice clients in seconds.
  [14.3, 16.02, 532], // Know the moment they've paid.
  [16.15, 18.1, 614], // Charge clients right at their appointment.
  [18.23, 19.88, 676], // Get paid on the spot. (straight on, one sentence with the line before)
  [20.03, 21.75, 754], // And it's already in your books.
  [21.87, 23.06, 830], // Run the business. (after a pause, with the turn to real)
  [23.26, 24.95, 874], // The books run themselves.
  [25.08, 27.2, 1090], // Start using 521 today.
]

function duckAt(frame: number) {
  return Math.max(
    0,
    ...VO.map(([a, b, at]) => {
      const end = at + (b - a) * 30
      // A slow release, so a short gap between two lines doesn't let the music swell and dip again.
      return interpolate(frame, [at - 8, at + 2, end + 4, end + 30], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.sin) })
    }),
  )
}

// The score sits under the voice and swells back between lines.
const scoreVolume = (frame: number) => 0.56 - duckAt(frame) * 0.36

// The piano bed (scripts/piano.py), dipping under each spoken line.
function musicVolume(frame: number) {
  const duck = Math.max(
    0,
    ...VO.map(([a, b, at]) => {
      const end = at + (b - a) * 30
      return interpolate(frame, [at - 6, at + 2, end, end + 10], [0, 1, 1, 0], clamp)
    }),
  )
  return 0.62 - duck * 0.3
}

// The cards version uses the orchestral score (scripts/score.py), built to the castle's hits.
const Voiceover: React.FC<{ score?: boolean }> = ({ score }) => (
  <>
    {score ? <Audio src={staticFile("audio/score.mp3")} volume={scoreVolume} /> : <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />}
    {VO.map(([a, b, at]) => (
      <Sequence key={at} from={at} durationInFrames={Math.ceil((b - a) * 30) + 2}>
        <Audio src={staticFile("audio/voiceover.mp3")} startFrom={Math.round(a * 30)} endAt={Math.round(b * 30) + 2} />
      </Sequence>
    ))}
  </>
)

// --- App cards (the "with cards" version) ------------------------------------------

const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const u = useUnit()
  return (
    <div
      style={{
        background: "linear-gradient(165deg, rgba(36,44,48,0.92), rgba(16,20,22,0.92))",
        border: `${1.5 * u}px solid rgba(255,255,255,0.14)`,
        borderRadius: 28 * u,
        boxShadow: `0 ${24 * u}px ${70 * u}px rgba(0,0,0,0.6)`,
        fontFamily,
        color: C.text,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

const Tile: React.FC<{ icon: Glyph; size: number }> = ({ icon, size }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.3, background: "rgba(47,168,102,0.28)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Icon name={icon} size={size * 0.56} color="#ECEBE6" />
  </div>
)

// A card that rises in below the words and fades with them.
const Card: React.FC<{ from: number; to: number; delay?: number; y?: number; children: React.ReactNode }> = ({ from, to, delay = 22, y = 0.66, children }) => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const { height } = useVideoConfig()
  if (frame < from || frame > to) return null
  const p = interpolate(frame, [from + delay, from + delay + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const out = interpolate(frame, [to - 10, to], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: height * y, transform: `translateY(${(1 - p) * 40 * u}px)`, opacity: p * out, filter: `blur(${(1 - p) * 8 * u}px)` }}>{children}</div>
    </AbsoluteFill>
  )
}


// The app's Online booking card (booking setup), recreated with the demo business.
const BookingLinkScreen: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const press = interpolate(frame, [244, 248, 254], [1, 0.92, 1], clamp)
  const copied = interpolate(frame, [246, 252, 268, 276], [0, 1, 1, 0], clamp)
  const button = (icon: Glyph, label: string, active = false) => (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12 * u,
        padding: `${18 * u}px 0`,
        borderRadius: 999,
        border: `${1.5 * u}px solid ${active ? C.green : "rgba(255,255,255,0.14)"}`,
        background: active ? `rgba(47,168,102,${0.25 * copied})` : "transparent",
        transform: active ? `scale(${press})` : undefined,
        fontSize: 26 * u,
        fontWeight: 500,
      }}
    >
      <Icon name={icon} size={28 * u} color={C.text} />
      {label}
    </div>
  )
  return (
    <div style={{ position: "relative" }}>
      <Glass style={{ width: 720 * u, padding: `${32 * u}px ${34 * u}px`, display: "flex", flexDirection: "column", gap: 18 * u }}>
        <div style={{ fontSize: 26 * u, fontWeight: 600, color: C.muted }}>Online booking</div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 * u }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 28 * u, fontWeight: 600 }}>Take bookings online</div>
            <div style={{ fontSize: 20 * u, color: C.muted, marginTop: 6 * u, lineHeight: 1.4 }}>Customers pick a service and an open time from your link. A deposit is paid by card first.</div>
          </div>
          <div style={{ width: 64 * u, height: 36 * u, borderRadius: 999, background: C.green, position: "relative", flexShrink: 0 }}>
            <div style={{ position: "absolute", right: 4 * u, top: 4 * u, width: 28 * u, height: 28 * u, borderRadius: "50%", background: "#0D1A14" }} />
          </div>
        </div>
        <div style={{ fontSize: 24 * u, color: C.muted, marginTop: 4 * u }}>Your link</div>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 22 * u, padding: `${20 * u}px ${24 * u}px`, fontSize: 27 * u, whiteSpace: "nowrap" }}>
          <span style={{ color: C.muted }}>app.the521app.com/book/</span>
          <span style={{ fontWeight: 600 }}>bloomstudio</span>
        </div>
        <div style={{ display: "flex", gap: 14 * u }}>
          {button("copy", "Copy", true)}
          {button("share", "Share")}
          {button("qr", "QR")}
        </div>
      </Glass>
      <div style={{ position: "absolute", left: "50%", bottom: -34 * u, transform: `translateX(-50%) translateY(${(1 - copied) * 10 * u}px)`, opacity: copied }}>
        <Glass style={{ padding: `${10 * u}px ${22 * u}px`, borderRadius: 999, fontSize: 22 * u, display: "flex", alignItems: "center", gap: 10 * u, border: `${1.5 * u}px solid ${C.green}` }}>
          <CheckDot size={26 * u} progress={1} />
          Link copied
        </Glass>
      </div>
    </div>
  )
}

// The app's Invoices screen, recreated with demo clients: Jordan's invoice flips to Paid.
const InvoicesScreen: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const flip = interpolate(frame, [536, 544], [0, 1], clamp)
  const flash = interpolate(frame, [536, 540, 568], [0, 1, 0], clamp)
  const count = interpolate(frame, [536, 554], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const badge = (text: string, paid: boolean) => (
    <span style={{ fontSize: 22 * u, fontWeight: 600, borderRadius: 999, padding: `${6 * u}px ${18 * u}px`, background: paid ? "rgba(47,168,102,0.22)" : "rgba(255,255,255,0.10)", color: paid ? C.greenBright : C.text }}>{text}</span>
  )
  const row = (name: string, sub: string, amount: string, status: React.ReactNode, highlight = 0) => (
    <div key={name} style={{ display: "flex", alignItems: "center", padding: `${20 * u}px ${28 * u}px`, borderTop: `1px solid ${C.border}`, background: `rgba(47,168,102,${0.18 * highlight})` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 28 * u, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 21 * u, color: C.muted, marginTop: 4 * u, whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 * u }}>
        <div style={{ fontSize: 28 * u, fontWeight: 600 }}>{amount}</div>
        {status}
      </div>
    </div>
  )
  return (
    <div style={{ width: 720 * u, display: "flex", flexDirection: "column", gap: 18 * u }}>
      <Glass style={{ display: "flex", padding: `${26 * u}px ${32 * u}px` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22 * u, color: C.muted }}>Waiting on</div>
          <div style={{ fontSize: 44 * u, fontWeight: 700, marginTop: 4 * u }}>{money(250 * (1 - count))}</div>
          <div style={{ fontSize: 20 * u, color: C.muted, marginTop: 2 * u }}>{count > 0.5 ? "Nothing overdue" : "Due Nov 3"}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22 * u, color: C.muted }}>Paid this month</div>
          <div style={{ fontSize: 44 * u, fontWeight: 700, marginTop: 4 * u, color: count > 0 ? C.greenBright : C.text }}>{money(3860 + 250 * count)}</div>
          <div style={{ fontSize: 20 * u, color: C.muted, marginTop: 2 * u }}>{count > 0.5 ? "12 invoices" : "11 invoices"}</div>
        </div>
      </Glass>
      <Glass style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ borderTop: "none" }}>
          {row(
            "Jordan Lee",
            flip > 0.5 ? "#0042 · Paid Oct 30 · paid online" : "#0042 · Emailed Oct 27",
            "$250.00",
            <span style={{ display: "inline-block", transform: `scale(${1 + Math.sin(flip * Math.PI) * 0.25})` }}>{flip > 0.5 ? badge("Paid", true) : badge("Due Nov 3", false)}</span>,
            flash,
          )}
          {row("Maya Ortiz", "#0041 · Paid Oct 26 · Venmo", "$180.00", badge("Paid", true))}
          {row("Sam Rivera", "#0040 · Paid Oct 24 · Cash", "$95.00", badge("Paid", true))}
        </div>
      </Glass>
    </div>
  )
}

const Cards: React.FC = () => {
  const frame = useCurrentFrame()
  const u = useUnit()
  const tick = (at: number) => interpolate(frame, [at, at + 8], [0, 1], clamp)
  const row = (icon: Glyph, title: string, sub: string, right?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
      <Tile icon={icon} size={64 * u} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 30 * u, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 22 * u, color: C.muted, marginTop: 2 * u, whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      {right}
    </div>
  )
  const pill = (text: string, color: string) => (
    <span style={{ background: color, color: "#fff", fontFamily, fontSize: 26 * u, fontWeight: 600, borderRadius: 999, padding: `${10 * u}px ${22 * u}px`, whiteSpace: "nowrap", boxShadow: `0 0 ${24 * u}px ${color}88` }}>{text}</span>
  )
  return (
    <>
      {/* Everything we build: the app's features, side by side */}
      <Card from={124} to={212} delay={30}>
        <div style={{ display: "flex", gap: 22 * u }}>
          {(
            [
              ["calendar", "Booking"],
              ["invoice", "Invoices"],
              ["qr", "Payments"],
              ["bank", "Bank"],
            ] as Array<[Glyph, string]>
          ).map(([icon, label], i) => {
            const p = interpolate(frame, [154 + i * 6, 166 + i * 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) })
            return (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 * u, opacity: p, transform: `scale(${0.7 + 0.3 * p})` }}>
                <Glass style={{ width: 120 * u, height: 120 * u, borderRadius: 32 * u, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Tile icon={icon} size={76 * u} />
                </Glass>
                <span style={{ fontFamily, fontSize: 22 * u, color: C.muted }}>{label}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Booking: the link they share (Online booking card), then a client booking from it */}
      <Card from={214} to={282} delay={8} y={0.42}>
        <BookingLinkScreen />
      </Card>
      <Card from={280} to={456} delay={6} y={0.46}>
        <Glass style={{ width: 640 * u, padding: 26 * u, display: "flex", flexDirection: "column", gap: 18 * u }}>
          {row("calendar", "Appointment · Thu 2pm", "Jordan Lee · booked from your link")}
          <div style={{ height: 1, background: C.border }} />
          {row("card", "$10 deposit", "Booked as income", <CheckDot size={52 * u} progress={tick(400)} />)}
        </Glass>
      </Card>

      {/* Invoices: the Invoices screen, Jordan's invoice flipping to Paid */}
      <Card from={460} to={606} delay={8} y={0.4}>
        <InvoicesScreen />
      </Card>

      {/* Already in your books: the payment split into its places */}
      <Card from={750} to={812} delay={8} y={0.86}>
        <div style={{ display: "flex", gap: 14 * u }}>
          {pill("+$45.00 Income", C.green)}
          {pill("+$8.00 Tip", C.teal)}
          {pill("−$1.84 Fee", "#5B646B")}
        </div>
      </Card>
    </>
  )
}

// --- The ad -----------------------------------------------------------------------------

export const TextAd: React.FC<{ cards?: boolean }> = ({ cards = false }) => {
  const frame = useCurrentFrame()
  const v = useView()
  const qr = interpolate(frame, [T.qrForward[0], T.qrForward[1], T.qrDrop[0], T.qrDrop[1]], [0, 1, 1, 0], clamp)
  const realLift = interpolate(frame, [T.real[0], T.real[1]], [0, 1], clamp)
  const zp = interpolate(frame, T.zoom, [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })
  // With the P&L opening, start brighter so the screen reads, then settle as it pours.
  const opening = cards ? interpolate(frame, [0, 30, 95], [-0.24, -0.24, 0], clamp) : 0
  // The finished castle brightens as it shimmers, and stays a little brighter while we take it in.
  const shine = interpolate(frame, [T.shimmer[0], T.shimmer[0] + 16, T.zoom[0] + 30], [0, 1, 0.6], { ...clamp, easing: Easing.out(Easing.quad) })
  const dim = 0.42 + opening + qr * 0.25 - realLift * 0.12 - shine * 0.12 + zp * 0.15
  // The castle goes soft as the camera dives, so the final words are the only thing in focus.
  const blur = 0.5 * (1 + qr * 3) + zp * 7
  const glow = interpolate(frame, [0, 120, T.real[0], T.real[1]], [0.12, 0.3, 0.3, 0.05], clamp)
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <CastleBackground dim={dim} blur={blur} glow={glow} morph={cards} />
      {/* A soft pool of dark behind the words. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 38% at 50% 50%, rgba(5,8,10,0.55), rgba(5,8,10,0) 100%)", opacity: cards ? interpolate(frame, T.zoom, [1, 0], clamp) : 1 }} />
      <QrMoment />

      <Center from={10} to={120} lines={["521 starts with **the books.**"]} />
      <Center from={124} to={212} lines={["Everything we build", "**stands on them.**"]} delays={[2, 30]} />
      <Center from={214} to={280} lines={["Share your booking link", "**anywhere.**"]} delays={[2, 18]} y={cards && v.tall ? 0.24 : undefined} />
      <Center from={280} to={370} lines={["Clients book in seconds,", "**no app needed.**"]} delays={[2, 18]} y={cards && v.tall ? 0.24 : undefined} />
      <Center from={378} to={456} lines={["Deposits land", "**right in your books.**"]} delays={[2, 18]} y={cards && v.tall ? 0.24 : undefined} />
      <Center from={460} to={528} lines={["Invoice clients", "**in seconds.**"]} delays={[2, 18]} y={cards && v.tall ? 0.2 : undefined} />
      <Center from={528} to={606} lines={["Know the moment", "**they've paid.**"]} delays={[2, 18]} y={cards && v.tall ? 0.2 : undefined} />
      <Center from={610} to={678} lines={["Charge clients", "**right at their appointment,**"]} />
      <Center from={676} to={750} lines={["get paid **on the spot.**"]} y={v.tall ? 0.7 : 0.74} />
      <Center from={750} to={812} lines={["And it's **already in your books.**"]} y={v.tall ? 0.7 : 0.74} />
      {/* The cards version says this line in voice only, over the finished castle. */}
      {cards ? null : <Center from={830} to={966} lines={["Run the business.", "**The books run themselves.**"]} delays={[4, 48]} scale={1.35} weight={700} grow={0.18} />}

      {cards ? <Cards /> : null}

      {cards ? <EndPushIn /> : null}
      {cards ? <EndDescent /> : null}
      {cards ? null : <Cornerstone />}
      <LightBurst fromStairs={cards} />
      <Download />
      <Voiceover score={cards} />
    </AbsoluteFill>
  )
}
