import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"
import { fontFamily } from "../theme"

// Renders one real screenshot (1206×2622) with the workspace name swapped for
// a made-up one, so the ad shows no real business names or addresses.
// Render with:  npx remotion still CleanShot public/clean/<file> --props='{"file":"…","kind":"…"}'
export const BUSINESS_NAME = "Fade Studio"

type Kind = "app" | "app-qr" | "page" | "page-scrolled" | "none"

// A QR-looking pattern that scans to nothing: three corner finders and
// random modules, with none of the timing/format data a reader needs.
const FakeQr: React.FC<{ x: number; y: number; size: number }> = ({ x, y, size }) => {
  const n = 29
  const cell = size / n
  let seed = 521
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const finder = (r: number, c: number): number => {
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      if (r >= r0 - 1 && r <= r0 + 7 && c >= c0 - 1 && c <= c0 + 7) {
        const rr = r - r0
        const cc = c - c0
        if (rr < 0 || rr > 6 || cc < 0 || cc > 6) return 0 // quiet ring
        return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4) ? 1 : 0
      }
    }
    return -1
  }
  const cells: React.ReactNode[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const f = finder(r, c)
      const on = f === -1 ? rand() < 0.48 : f === 1
      if (on) cells.push(<rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell + 0.5} height={cell + 0.5} fill="#000" />)
    }
  }
  return (
    <>
      <div style={{ position: "absolute", left: x - 12, top: y - 12, width: size + 24, height: size + 24, background: "#fff" }} />
      <svg width={size} height={size} style={{ position: "absolute", left: x, top: y }} shapeRendering="crispEdges">
        {cells}
      </svg>
    </>
  )
}

// The app's workspace pill in the top bar (measured from the screenshots).
const AppPill: React.FC = () => (
  <>
    {/* cover the old pill with the header colour */}
    <div style={{ position: "absolute", left: 40, top: 204, width: 640, height: 126, background: "#323b40" }} />
    <div
      style={{
        position: "absolute",
        left: 48,
        top: 210,
        height: 114,
        boxSizing: "border-box",
        border: "4px solid #3d474d",
        background: "#283035",
        borderRadius: 57,
        display: "flex",
        alignItems: "center",
        paddingLeft: 12,
        paddingRight: 52,
        gap: 26,
        fontFamily,
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          background: "#29423c",
          color: "#2fa866",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 40,
          fontWeight: 600,
        }}
      >
        {BUSINESS_NAME[0]}
      </div>
      <span style={{ color: "#ecebe6", fontSize: 45, fontWeight: 500, letterSpacing: -0.2 }}>{BUSINESS_NAME}</span>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ea6a1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  </>
)

// The business name at the top of the public booking page (Safari).
const PageTitle: React.FC = () => (
  <>
    <div style={{ position: "absolute", left: 110, top: 350, width: 700, height: 80, background: "#ffffff" }} />
    <div
      style={{
        position: "absolute",
        left: 122,
        top: 352,
        fontFamily,
        fontSize: 53,
        fontWeight: 700,
        letterSpacing: -0.8,
        color: "#1b1f22",
        lineHeight: "64px",
      }}
    >
      {BUSINESS_NAME}
    </div>
  </>
)

export const CleanShot: React.FC<{ file: string; kind: Kind }> = ({ file, kind }) => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Img src={staticFile(`real/${file}`)} style={{ position: "absolute", left: 0, top: 0, width: 1206, height: 2622 }} />
    {kind === "app" || kind === "app-qr" ? <AppPill /> : null}
    {kind === "app-qr" ? <FakeQr x={232} y={922} size={744} /> : null}
    {kind === "page" ? <PageTitle /> : null}
    {kind === "page-scrolled" ? (
      // The scrolled page shows the old name faintly under the status bar:
      // paste the clean status bar from the unscrolled time-picker shot.
      <div style={{ position: "absolute", left: 0, top: 0, width: 1206, height: 227, overflow: "hidden" }}>
        <Img src={staticFile("real/03-book-time.png")} style={{ position: "absolute", left: 0, top: 0, width: 1206, height: 2622 }} />
      </div>
    ) : null}
  </AbsoluteFill>
)
