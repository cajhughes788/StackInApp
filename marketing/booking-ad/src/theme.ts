import { loadFont } from "@remotion/google-fonts/Inter"
import { useVideoConfig } from "remotion"

// 521 brand (product-positioning-rebrand): charcoal, off-white, green.
export const C = {
  bg: "#0B0F11",
  charcoal: "#161B1E",
  card: "rgba(28, 34, 38, 0.78)",
  cardSolid: "#1C2226",
  border: "rgba(236, 235, 230, 0.10)",
  text: "#ECEBE6",
  muted: "rgba(236, 235, 230, 0.55)",
  green: "#2FA866",
  greenBright: "#3DDC84",
  teal: "#1AA6A0",
  deep: "#0E5B46",
  amber: "#E3A93B",
  rose: "#E5566F",
  violet: "#8B6CF0",
  blue: "#3B82F6",
}

export const { fontFamily } = loadFont("normal", { weights: ["300", "400", "500", "600", "700"], subsets: ["latin"] })

export const FPS = 30
export const DURATION = 1080 // 36 s

// One design unit: 1px on a 1080-wide square, scaled to the short side so
// every aspect ratio uses the same layout.
export function useUnit() {
  const { width, height } = useVideoConfig()
  return Math.min(width, height) / 1080
}

export function useLandscape() {
  const { width, height } = useVideoConfig()
  return width > height
}
