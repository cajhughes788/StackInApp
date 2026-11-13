// The castle, cut into the pieces a real build puts up, traced along the lines
// of the frame drawing (public/palace/frame-final.png). Everything here is in
// "F" pixels: the 1280×720 space the frame and the finished castle share.
//
// Traced on a 2× zoom of the frame cropped from x=260, so points are written
// in that zoom ("Z") and converted.

export type Pt = [number, number]
const z = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [260 + x / 2, y / 2])

export const F_W = 1280
export const F_H = 720

// Where the 1024² hologram sits in F space (it is ~7% taller than the frame).
export const HOLO = { left: 319 / 1.303, top: 1 / 1.4, width: 1024 / 1.303, height: 1024 / 1.4 }

// --- Pieces ------------------------------------------------------------------

// The base platform: outer walls, plinth and courtyard floor. Buildings are cut
// out of it (see FOUNDATION_CUTS), so its top edge can be generous.
export const BASE = z([
  [18, 940], [170, 820], [470, 700], [940, 630], [1210, 700], [1495, 985], [1490, 1012], [1050, 1310],
  [830, 1420], [455, 1295], [355, 1215], [22, 982],
])

export const STAIRS = z([
  [555, 1185], [620, 1080], [650, 1090], [700, 1105], [860, 1130], [885, 1135], [885, 1200], [835, 1310],
  [805, 1310], [800, 1255], [590, 1255], [560, 1260],
])

// The great hall with its gatehouse, left wing, front turret and right wing.
export const HALL = z([
  [272, 978], [272, 842], [300, 820], [337, 820], [337, 595], [362, 575], [410, 575], [412, 600], [520, 563],
  [565, 590], [715, 668], [800, 690], [820, 652], [840, 690], [935, 640], [1000, 588], [1203, 662], [1205, 1062],
  [1050, 1100], [950, 1130], [875, 1092], [765, 1092], [740, 1062], [600, 1005], [440, 942], [400, 968], [395, 980],
])

export const TOWER_BOOKING = z([
  [240, 372], [262, 372], [312, 515], [338, 525], [337, 820], [300, 820], [272, 842], [272, 915], [190, 915],
  [178, 860], [185, 590], [165, 560], [165, 525], [195, 515],
])

export const TOWER_INVOICES = z([
  [500, 232], [535, 232], [548, 300], [568, 392], [583, 402], [580, 468], [556, 478], [556, 585], [520, 563],
  [470, 580], [462, 440], [468, 398], [490, 392], [505, 300],
])

export const TOWER_PAYMENTS = z([
  [935, 262], [1052, 262], [1052, 296], [1015, 300], [1030, 395], [1047, 405], [1045, 450], [1035, 455],
  [1035, 595], [1000, 588], [935, 640], [948, 560], [950, 470], [930, 450], [930, 405], [965, 300],
])

export const TOWER_RECEIPTS = z([
  [1275, 438], [1297, 438], [1340, 590], [1362, 600], [1360, 650], [1350, 660], [1350, 1000], [1300, 1050],
  [1205, 1062], [1203, 662], [1205, 600], [1228, 590],
])

export const KEEP = z([
  [748, 28], [774, 28], [774, 150], [862, 175], [862, 262], [855, 268], [855, 465], [930, 455], [935, 640],
  [840, 690], [820, 652], [800, 690], [715, 668], [565, 590], [556, 585], [556, 478], [582, 468], [660, 460],
  [660, 268], [653, 262], [655, 178], [748, 150],
])

export const FOUNDATION_CUTS = [STAIRS, HALL, TOWER_BOOKING, TOWER_INVOICES, TOWER_PAYMENTS, TOWER_RECEIPTS, KEEP]

// Levels, as the y (F) each level's top reaches, bottom level first. A tower
// rises one level at a time; the last level is the roof/crown (to the top).
const zy = (y: number) => y / 2
export const LEVELS = {
  booking: [zy(770), zy(600), zy(515), 0],
  invoices: [zy(480), zy(395), zy(300), 0],
  receipts: [zy(860), zy(720), zy(595), 0],
  keep: [zy(470), zy(330), zy(175), 0],
  stairs: [zy(1215), zy(1180), zy(1145), 0],
  // The frame rises floor by floor: base walls, ground floor, hall roofs and
  // lower towers, tower tops and keep body, crown and antenna.
  frame: [zy(1000), zy(800), zy(560), zy(300), 0],
}

// The hall builds left to right, one section per expense category.
export const HALL_X = [260 + 272 / 2, 260 + 1205 / 2]

// --- The floor grid (ledger → foundation bays) ------------------------------

// The platform's top face as a quad: left, front, right, back corners.
export const QUAD = {
  L: [260 + 20 / 2, 950 / 2] as Pt,
  F: [260 + 830 / 2, 1340 / 2] as Pt,
  R: [260 + 1495 / 2, 990 / 2] as Pt,
  B: [260 + 685 / 2, 520 / 2] as Pt,
}
// The cornerstone sits at the front corner.
export const CORNER = QUAD.F

// Point on the quad: u runs left→front edge direction, v runs left→back.
export function onQuad(u: number, v: number): Pt {
  const { L, F, R, B } = QUAD
  // Bilinear across L(0,0) F(1,0) R(1,1) B(0,1).
  const x = L[0] * (1 - u) * (1 - v) + F[0] * u * (1 - v) + R[0] * u * v + B[0] * (1 - u) * v
  const y = L[1] * (1 - u) * (1 - v) + F[1] * u * (1 - v) + R[1] * u * v + B[1] * (1 - u) * v
  return [x, y]
}

export const GRID_N = 8
const WALL = 42 // the platform's wall height (F px), so edge bays take their wall too

// Foundation bays, nearest the cornerstone first.
export const BAYS: Pt[][] = (() => {
  const cells: Array<{ pts: Pt[]; d: number }> = []
  for (let i = 0; i < GRID_N; i++) {
    for (let j = 0; j < GRID_N; j++) {
      const a = onQuad(i / GRID_N, j / GRID_N)
      const b = onQuad((i + 1) / GRID_N, j / GRID_N)
      const c = onQuad((i + 1) / GRID_N, (j + 1) / GRID_N)
      const d = onQuad(i / GRID_N, (j + 1) / GRID_N)
      const down = (p: Pt): Pt => [p[0], p[1] + WALL]
      // The cell plus its drop to the base of the wall.
      const hull = convexHull([a, b, c, d, down(a), down(b), down(c), down(d)])
      cells.push({ pts: hull, d: Math.hypot(GRID_N - (i + 0.5), j + 0.5) })
    }
  }
  return cells.sort((p, q) => p.d - q.d).map((c) => c.pts)
})()

export function bayCenter(index: number): Pt {
  const pts = BAYS[Math.min(index, BAYS.length - 1)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) + 8]
}

function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// --- Landmarks (F) ----------------------------------------------------------

export const SPOT = {
  plot: [640, 520] as Pt,
  bookingTop: [386, 262] as Pt,
  bookingBase: [386, 455] as Pt,
  bookingRing: { cx: 386, cy: 270, rx: 43, ry: 9 },
  invoicesCrown: [519, 135] as Pt,
  invoicesBase: [519, 288] as Pt,
  paymentsHalo: [757, 138] as Pt,
  paymentsBase: [752, 295] as Pt,
  receiptsBase: [902, 520] as Pt,
  keepBase: [640, 300] as Pt,
  antenna: [640, 16] as Pt,
  foundationCenter: [650, 560] as Pt,
  stairsTop: [638, 556] as Pt,
}

export const toPoints = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
