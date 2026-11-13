// The castle (public/palace/palace.png, 1024×1024) cut into the pieces the
// story builds, as outlines in image pixels. The foundation is everything the
// other pieces don't claim.

export type Pt = [number, number]
export type PartId = "foundation" | "stairs" | "hall" | "booking" | "invoices" | "payments" | "receipts" | "keep"

export const IMAGE = 1024

export const PARTS: Record<Exclude<PartId, "foundation">, Pt[]> = {
  // Income: the grand front staircase and the terrace walls either side.
  stairs: [
    [250, 700], [330, 690], [400, 712], [470, 748], [600, 788], [645, 782], [700, 762], [762, 748],
    [770, 792], [700, 822], [604, 802], [598, 882], [556, 908], [420, 884], [386, 852], [300, 812], [240, 782],
  ],
  // Expenses: the great hall, its wings, the gatehouse and the small front turret.
  hall: [
    [203, 640], [240, 636], [246, 425], [262, 418], [300, 395], [330, 410], [405, 410], [430, 446], [628, 446], [698, 422],
    [745, 402], [806, 452], [806, 520], [808, 705], [770, 738], [700, 748], [645, 778], [590, 782], [520, 768],
    [470, 740], [400, 704], [330, 684], [270, 684], [203, 692],
  ],
  // Booking: front-left round tower, clock ring.
  booking: [
    [132, 372], [160, 330], [190, 262], [222, 330], [252, 374], [246, 425], [238, 635], [150, 635], [140, 425],
  ],
  // Invoices: back-left tower, stacked fins.
  invoices: [
    [330, 282], [345, 250], [366, 172], [388, 250], [404, 284], [402, 410], [330, 410],
  ],
  // Payments: back-right tower, halo disc.
  payments: [
    [622, 194], [696, 194], [696, 330], [698, 422], [628, 446], [622, 330],
  ],
  // Receipts: front-right tower, scanning beam.
  receipts: [
    [804, 432], [830, 380], [852, 318], [874, 362], [1006, 352], [1006, 388], [892, 388], [902, 432],
    [898, 702], [808, 705], [806, 520],
  ],
  // The central keep with its antenna.
  keep: [
    [504, 8], [526, 8], [526, 112], [588, 118], [590, 330], [622, 330], [628, 446], [430, 446], [405, 410],
    [402, 340], [444, 328], [444, 118], [504, 110],
  ],
}


export const toPath = (pts: Pt[], s: number) => `M${pts.map(([x, y]) => `${(x * s).toFixed(1)} ${(y * s).toFixed(1)}`).join(" L")} Z`
