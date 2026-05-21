import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type ConnecticutPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type ConnecticutWithholdingCode = "A" | "B" | "C" | "D" | "E" | "F"
type ConnecticutTableCode = Exclude<ConnecticutWithholdingCode, "E">

type RangeValue = {
  min: number
  max: number | null
  value: number
}

type PiecewiseBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const CONNECTICUT_NO_FORM_RATE = 0.0699

const CONNECTICUT_EXEMPTION_TABLE: Record<Exclude<ConnecticutWithholdingCode, "E">, RangeValue[]> = {
  A: [
    { min: 0, max: 24000, value: 12000 },
    { min: 24000, max: 25000, value: 11000 },
    { min: 25000, max: 26000, value: 10000 },
    { min: 26000, max: 27000, value: 9000 },
    { min: 27000, max: 28000, value: 8000 },
    { min: 28000, max: 29000, value: 7000 },
    { min: 29000, max: 30000, value: 6000 },
    { min: 30000, max: 31000, value: 5000 },
    { min: 31000, max: 32000, value: 4000 },
    { min: 32000, max: 33000, value: 3000 },
    { min: 33000, max: 34000, value: 2000 },
    { min: 34000, max: 35000, value: 1000 },
    { min: 35000, max: null, value: 0 },
  ],
  B: [
    { min: 0, max: 38000, value: 19000 },
    { min: 38000, max: 39000, value: 18000 },
    { min: 39000, max: 40000, value: 17000 },
    { min: 40000, max: 41000, value: 16000 },
    { min: 41000, max: 42000, value: 15000 },
    { min: 42000, max: 43000, value: 14000 },
    { min: 43000, max: 44000, value: 13000 },
    { min: 44000, max: 45000, value: 12000 },
    { min: 45000, max: 46000, value: 11000 },
    { min: 46000, max: 47000, value: 10000 },
    { min: 47000, max: 48000, value: 9000 },
    { min: 48000, max: 49000, value: 8000 },
    { min: 49000, max: 50000, value: 7000 },
    { min: 50000, max: 51000, value: 6000 },
    { min: 51000, max: 52000, value: 5000 },
    { min: 52000, max: 53000, value: 4000 },
    { min: 53000, max: 54000, value: 3000 },
    { min: 54000, max: 55000, value: 2000 },
    { min: 55000, max: 56000, value: 1000 },
    { min: 56000, max: null, value: 0 },
  ],
  C: [
    { min: 0, max: 48000, value: 24000 },
    { min: 48000, max: 49000, value: 23000 },
    { min: 49000, max: 50000, value: 22000 },
    { min: 50000, max: 51000, value: 21000 },
    { min: 51000, max: 52000, value: 20000 },
    { min: 52000, max: 53000, value: 19000 },
    { min: 53000, max: 54000, value: 18000 },
    { min: 54000, max: 55000, value: 17000 },
    { min: 55000, max: 56000, value: 16000 },
    { min: 56000, max: 57000, value: 15000 },
    { min: 57000, max: 58000, value: 14000 },
    { min: 58000, max: 59000, value: 13000 },
    { min: 59000, max: 60000, value: 12000 },
    { min: 60000, max: 61000, value: 11000 },
    { min: 61000, max: 62000, value: 10000 },
    { min: 62000, max: 63000, value: 9000 },
    { min: 63000, max: 64000, value: 8000 },
    { min: 64000, max: 65000, value: 7000 },
    { min: 65000, max: 66000, value: 6000 },
    { min: 66000, max: 67000, value: 5000 },
    { min: 67000, max: 68000, value: 4000 },
    { min: 68000, max: 69000, value: 3000 },
    { min: 69000, max: 70000, value: 2000 },
    { min: 70000, max: 71000, value: 1000 },
    { min: 71000, max: null, value: 0 },
  ],
  D: [{ min: 0, max: null, value: 0 }],
  F: [
    { min: 0, max: 30000, value: 15000 },
    { min: 30000, max: 31000, value: 14000 },
    { min: 31000, max: 32000, value: 13000 },
    { min: 32000, max: 33000, value: 12000 },
    { min: 33000, max: 34000, value: 11000 },
    { min: 34000, max: 35000, value: 10000 },
    { min: 35000, max: 36000, value: 9000 },
    { min: 36000, max: 37000, value: 8000 },
    { min: 37000, max: 38000, value: 7000 },
    { min: 38000, max: 39000, value: 6000 },
    { min: 39000, max: 40000, value: 5000 },
    { min: 40000, max: 41000, value: 4000 },
    { min: 41000, max: 42000, value: 3000 },
    { min: 42000, max: 43000, value: 2000 },
    { min: 43000, max: 44000, value: 1000 },
    { min: 44000, max: null, value: 0 },
  ],
}

const CONNECTICUT_INITIAL_TAX_TABLE: Record<ConnecticutTableCode, PiecewiseBracket[]> = {
  A: [
    { min: 0, max: 10000, base: 0, rate: 0.02 },
    { min: 10000, max: 50000, base: 200, rate: 0.045 },
    { min: 50000, max: 100000, base: 2000, rate: 0.055 },
    { min: 100000, max: 200000, base: 4750, rate: 0.06 },
    { min: 200000, max: 250000, base: 10750, rate: 0.065 },
    { min: 250000, max: 500000, base: 14000, rate: 0.069 },
    { min: 500000, max: null, base: 31250, rate: 0.0699 },
  ],
  B: [
    { min: 0, max: 16000, base: 0, rate: 0.02 },
    { min: 16000, max: 80000, base: 320, rate: 0.045 },
    { min: 80000, max: 160000, base: 3200, rate: 0.055 },
    { min: 160000, max: 320000, base: 7600, rate: 0.06 },
    { min: 320000, max: 400000, base: 17200, rate: 0.065 },
    { min: 400000, max: 800000, base: 22400, rate: 0.069 },
    { min: 800000, max: null, base: 50000, rate: 0.0699 },
  ],
  C: [
    { min: 0, max: 20000, base: 0, rate: 0.02 },
    { min: 20000, max: 100000, base: 400, rate: 0.045 },
    { min: 100000, max: 200000, base: 4000, rate: 0.055 },
    { min: 200000, max: 400000, base: 9500, rate: 0.06 },
    { min: 400000, max: 500000, base: 21500, rate: 0.065 },
    { min: 500000, max: 1000000, base: 28000, rate: 0.069 },
    { min: 1000000, max: null, base: 62500, rate: 0.0699 },
  ],
  D: [
    { min: 0, max: 10000, base: 0, rate: 0.02 },
    { min: 10000, max: 50000, base: 200, rate: 0.045 },
    { min: 50000, max: 100000, base: 2000, rate: 0.055 },
    { min: 100000, max: 200000, base: 4750, rate: 0.06 },
    { min: 200000, max: 250000, base: 10750, rate: 0.065 },
    { min: 250000, max: 500000, base: 14000, rate: 0.069 },
    { min: 500000, max: null, base: 31250, rate: 0.0699 },
  ],
  F: [
    { min: 0, max: 10000, base: 0, rate: 0.02 },
    { min: 10000, max: 50000, base: 200, rate: 0.045 },
    { min: 50000, max: 100000, base: 2000, rate: 0.055 },
    { min: 100000, max: 200000, base: 4750, rate: 0.06 },
    { min: 200000, max: 250000, base: 10750, rate: 0.065 },
    { min: 250000, max: 500000, base: 14000, rate: 0.069 },
    { min: 500000, max: null, base: 31250, rate: 0.0699 },
  ],
}

const CONNECTICUT_PHASE_OUT_TABLE: Record<ConnecticutTableCode, RangeValue[]> = {
  A: [
    { min: 0, max: 50250, value: 0 },
    { min: 50250, max: 52750, value: 25 },
    { min: 52750, max: 55250, value: 50 },
    { min: 55250, max: 57750, value: 75 },
    { min: 57750, max: 60250, value: 100 },
    { min: 60250, max: 62750, value: 125 },
    { min: 62750, max: 65250, value: 150 },
    { min: 65250, max: 67750, value: 175 },
    { min: 67750, max: 70250, value: 200 },
    { min: 70250, max: 72750, value: 225 },
    { min: 72750, max: null, value: 250 },
  ],
  B: [
    { min: 0, max: 78500, value: 0 },
    { min: 78500, max: 82500, value: 40 },
    { min: 82500, max: 86500, value: 80 },
    { min: 86500, max: 90500, value: 120 },
    { min: 90500, max: 94500, value: 160 },
    { min: 94500, max: 98500, value: 200 },
    { min: 98500, max: 102500, value: 240 },
    { min: 102500, max: 106500, value: 280 },
    { min: 106500, max: 110500, value: 320 },
    { min: 110500, max: 114500, value: 360 },
    { min: 114500, max: null, value: 400 },
  ],
  C: [
    { min: 0, max: 100500, value: 0 },
    { min: 100500, max: 105500, value: 50 },
    { min: 105500, max: 110500, value: 100 },
    { min: 110500, max: 115500, value: 150 },
    { min: 115500, max: 120500, value: 200 },
    { min: 120500, max: 125500, value: 250 },
    { min: 125500, max: 130500, value: 300 },
    { min: 130500, max: 135500, value: 350 },
    { min: 135500, max: 140500, value: 400 },
    { min: 140500, max: 145500, value: 450 },
    { min: 145500, max: null, value: 500 },
  ],
  D: [
    { min: 0, max: 50250, value: 0 },
    { min: 50250, max: 52750, value: 25 },
    { min: 52750, max: 55250, value: 50 },
    { min: 55250, max: 57750, value: 75 },
    { min: 57750, max: 60250, value: 100 },
    { min: 60250, max: 62750, value: 125 },
    { min: 62750, max: 65250, value: 150 },
    { min: 65250, max: 67750, value: 175 },
    { min: 67750, max: 70250, value: 200 },
    { min: 70250, max: 72750, value: 225 },
    { min: 72750, max: null, value: 250 },
  ],
  F: [
    { min: 0, max: 56500, value: 0 },
    { min: 56500, max: 61500, value: 25 },
    { min: 61500, max: 66500, value: 50 },
    { min: 66500, max: 71500, value: 75 },
    { min: 71500, max: 76500, value: 100 },
    { min: 76500, max: 81500, value: 125 },
    { min: 81500, max: 86500, value: 150 },
    { min: 86500, max: 91500, value: 175 },
    { min: 91500, max: 96500, value: 200 },
    { min: 96500, max: 101500, value: 225 },
    { min: 101500, max: null, value: 250 },
  ],
}

const CONNECTICUT_RECAPTURE_TABLE: Record<Exclude<ConnecticutTableCode, "F">, RangeValue[]> = {
  A: [
    { min: 0, max: 105000, value: 0 },
    { min: 105000, max: 110000, value: 25 },
    { min: 110000, max: 115000, value: 50 },
    { min: 115000, max: 120000, value: 75 },
    { min: 120000, max: 125000, value: 100 },
    { min: 125000, max: 130000, value: 125 },
    { min: 130000, max: 135000, value: 150 },
    { min: 135000, max: 140000, value: 175 },
    { min: 140000, max: 145000, value: 200 },
    { min: 145000, max: 150000, value: 225 },
    { min: 150000, max: 200000, value: 250 },
    { min: 200000, max: 205000, value: 340 },
    { min: 205000, max: 210000, value: 430 },
    { min: 210000, max: 215000, value: 520 },
    { min: 215000, max: 220000, value: 610 },
    { min: 220000, max: 225000, value: 700 },
    { min: 225000, max: 230000, value: 790 },
    { min: 230000, max: 235000, value: 880 },
    { min: 235000, max: 240000, value: 970 },
    { min: 240000, max: 245000, value: 1060 },
    { min: 245000, max: 250000, value: 1150 },
    { min: 250000, max: 255000, value: 1240 },
    { min: 255000, max: 260000, value: 1330 },
    { min: 260000, max: 265000, value: 1420 },
    { min: 265000, max: 270000, value: 1510 },
    { min: 270000, max: 275000, value: 1600 },
    { min: 275000, max: 280000, value: 1690 },
    { min: 280000, max: 285000, value: 1780 },
    { min: 285000, max: 290000, value: 1870 },
    { min: 290000, max: 295000, value: 1960 },
    { min: 295000, max: 300000, value: 2050 },
    { min: 300000, max: 305000, value: 2140 },
    { min: 305000, max: 310000, value: 2230 },
    { min: 310000, max: 315000, value: 2320 },
    { min: 315000, max: 320000, value: 2410 },
    { min: 320000, max: 325000, value: 2500 },
    { min: 325000, max: 330000, value: 2590 },
    { min: 330000, max: 335000, value: 2680 },
    { min: 335000, max: 340000, value: 2770 },
    { min: 340000, max: 345000, value: 2860 },
    { min: 345000, max: 500000, value: 2950 },
    { min: 500000, max: 505000, value: 3000 },
    { min: 505000, max: 510000, value: 3050 },
    { min: 510000, max: 515000, value: 3100 },
    { min: 515000, max: 520000, value: 3150 },
    { min: 520000, max: 525000, value: 3200 },
    { min: 525000, max: 530000, value: 3250 },
    { min: 530000, max: 535000, value: 3300 },
    { min: 535000, max: 540000, value: 3350 },
    { min: 540000, max: null, value: 3400 },
  ],
  D: [
    { min: 0, max: 105000, value: 0 },
    { min: 105000, max: 110000, value: 25 },
    { min: 110000, max: 115000, value: 50 },
    { min: 115000, max: 120000, value: 75 },
    { min: 120000, max: 125000, value: 100 },
    { min: 125000, max: 130000, value: 125 },
    { min: 130000, max: 135000, value: 150 },
    { min: 135000, max: 140000, value: 175 },
    { min: 140000, max: 145000, value: 200 },
    { min: 145000, max: 150000, value: 225 },
    { min: 150000, max: 200000, value: 250 },
    { min: 200000, max: 205000, value: 340 },
    { min: 205000, max: 210000, value: 430 },
    { min: 210000, max: 215000, value: 520 },
    { min: 215000, max: 220000, value: 610 },
    { min: 220000, max: 225000, value: 700 },
    { min: 225000, max: 230000, value: 790 },
    { min: 230000, max: 235000, value: 880 },
    { min: 235000, max: 240000, value: 970 },
    { min: 240000, max: 245000, value: 1060 },
    { min: 245000, max: 250000, value: 1150 },
    { min: 250000, max: 255000, value: 1240 },
    { min: 255000, max: 260000, value: 1330 },
    { min: 260000, max: 265000, value: 1420 },
    { min: 265000, max: 270000, value: 1510 },
    { min: 270000, max: 275000, value: 1600 },
    { min: 275000, max: 280000, value: 1690 },
    { min: 280000, max: 285000, value: 1780 },
    { min: 285000, max: 290000, value: 1870 },
    { min: 290000, max: 295000, value: 1960 },
    { min: 295000, max: 300000, value: 2050 },
    { min: 300000, max: 305000, value: 2140 },
    { min: 305000, max: 310000, value: 2230 },
    { min: 310000, max: 315000, value: 2320 },
    { min: 315000, max: 320000, value: 2410 },
    { min: 320000, max: 325000, value: 2500 },
    { min: 325000, max: 330000, value: 2590 },
    { min: 330000, max: 335000, value: 2680 },
    { min: 335000, max: 340000, value: 2770 },
    { min: 340000, max: 345000, value: 2860 },
    { min: 345000, max: 500000, value: 2950 },
    { min: 500000, max: 505000, value: 3000 },
    { min: 505000, max: 510000, value: 3050 },
    { min: 510000, max: 515000, value: 3100 },
    { min: 515000, max: 520000, value: 3150 },
    { min: 520000, max: 525000, value: 3200 },
    { min: 525000, max: 530000, value: 3250 },
    { min: 530000, max: 535000, value: 3300 },
    { min: 535000, max: 540000, value: 3350 },
    { min: 540000, max: null, value: 3400 },
  ],
  B: [
    { min: 0, max: 168000, value: 0 },
    { min: 168000, max: 176000, value: 40 },
    { min: 176000, max: 184000, value: 80 },
    { min: 184000, max: 192000, value: 120 },
    { min: 192000, max: 200000, value: 160 },
    { min: 200000, max: 208000, value: 200 },
    { min: 208000, max: 216000, value: 240 },
    { min: 216000, max: 224000, value: 280 },
    { min: 224000, max: 232000, value: 320 },
    { min: 232000, max: 240000, value: 360 },
    { min: 240000, max: 320000, value: 400 },
    { min: 320000, max: 328000, value: 540 },
    { min: 328000, max: 336000, value: 680 },
    { min: 336000, max: 344000, value: 820 },
    { min: 344000, max: 352000, value: 960 },
    { min: 352000, max: 360000, value: 1100 },
    { min: 360000, max: 368000, value: 1240 },
    { min: 368000, max: 376000, value: 1380 },
    { min: 376000, max: 384000, value: 1520 },
    { min: 384000, max: 392000, value: 1660 },
    { min: 392000, max: 400000, value: 1800 },
    { min: 400000, max: 408000, value: 1940 },
    { min: 408000, max: 416000, value: 2080 },
    { min: 416000, max: 424000, value: 2220 },
    { min: 424000, max: 432000, value: 2360 },
    { min: 432000, max: 440000, value: 2500 },
    { min: 440000, max: 448000, value: 2640 },
    { min: 448000, max: 456000, value: 2780 },
    { min: 456000, max: 464000, value: 2920 },
    { min: 464000, max: 472000, value: 3060 },
    { min: 472000, max: 480000, value: 3200 },
    { min: 480000, max: 488000, value: 3340 },
    { min: 488000, max: 496000, value: 3480 },
    { min: 496000, max: 504000, value: 3620 },
    { min: 504000, max: 512000, value: 3760 },
    { min: 512000, max: 520000, value: 3900 },
    { min: 520000, max: 528000, value: 4040 },
    { min: 528000, max: 536000, value: 4180 },
    { min: 536000, max: 544000, value: 4320 },
    { min: 544000, max: 552000, value: 4460 },
    { min: 552000, max: 800000, value: 4600 },
    { min: 800000, max: 808000, value: 4680 },
    { min: 808000, max: 816000, value: 4760 },
    { min: 816000, max: 824000, value: 4840 },
    { min: 824000, max: 832000, value: 4920 },
    { min: 832000, max: 840000, value: 5000 },
    { min: 840000, max: 848000, value: 5080 },
    { min: 848000, max: 856000, value: 5160 },
    { min: 856000, max: 864000, value: 5240 },
    { min: 864000, max: null, value: 5320 },
  ],
  C: [
    { min: 0, max: 210000, value: 0 },
    { min: 210000, max: 220000, value: 50 },
    { min: 220000, max: 230000, value: 100 },
    { min: 230000, max: 240000, value: 150 },
    { min: 240000, max: 250000, value: 200 },
    { min: 250000, max: 260000, value: 250 },
    { min: 260000, max: 270000, value: 300 },
    { min: 270000, max: 280000, value: 350 },
    { min: 280000, max: 290000, value: 400 },
    { min: 290000, max: 300000, value: 450 },
    { min: 300000, max: 400000, value: 500 },
    { min: 400000, max: 410000, value: 680 },
    { min: 410000, max: 420000, value: 860 },
    { min: 420000, max: 430000, value: 1040 },
    { min: 430000, max: 440000, value: 1220 },
    { min: 440000, max: 450000, value: 1400 },
    { min: 450000, max: 460000, value: 1580 },
    { min: 460000, max: 470000, value: 1760 },
    { min: 470000, max: 480000, value: 1940 },
    { min: 480000, max: 490000, value: 2120 },
    { min: 490000, max: 500000, value: 2300 },
    { min: 500000, max: 510000, value: 2480 },
    { min: 510000, max: 520000, value: 2660 },
    { min: 520000, max: 530000, value: 2840 },
    { min: 530000, max: 540000, value: 3020 },
    { min: 540000, max: 550000, value: 3200 },
    { min: 550000, max: 560000, value: 3380 },
    { min: 560000, max: 570000, value: 3560 },
    { min: 570000, max: 580000, value: 3740 },
    { min: 580000, max: 590000, value: 3920 },
    { min: 590000, max: 600000, value: 4100 },
    { min: 600000, max: 610000, value: 4280 },
    { min: 610000, max: 620000, value: 4460 },
    { min: 620000, max: 630000, value: 4640 },
    { min: 630000, max: 640000, value: 4820 },
    { min: 640000, max: 650000, value: 5000 },
    { min: 650000, max: 660000, value: 5180 },
    { min: 660000, max: 670000, value: 5360 },
    { min: 670000, max: 680000, value: 5540 },
    { min: 680000, max: 690000, value: 5720 },
    { min: 690000, max: 1000000, value: 5900 },
    { min: 1000000, max: 1010000, value: 6000 },
    { min: 1010000, max: 1020000, value: 6100 },
    { min: 1020000, max: 1030000, value: 6200 },
    { min: 1030000, max: 1040000, value: 6300 },
    { min: 1040000, max: 1050000, value: 6400 },
    { min: 1050000, max: 1060000, value: 6500 },
    { min: 1060000, max: 1070000, value: 6600 },
    { min: 1070000, max: 1080000, value: 6700 },
    { min: 1080000, max: null, value: 6800 },
  ],
}

const CONNECTICUT_CREDIT_TABLE: Record<Exclude<ConnecticutWithholdingCode, "D" | "E">, RangeValue[]> = {
  A: [
    { min: 0, max: 12000, value: 1 },
    { min: 12000, max: 15000, value: 0.75 },
    { min: 15000, max: 15500, value: 0.7 },
    { min: 15500, max: 16000, value: 0.65 },
    { min: 16000, max: 16500, value: 0.6 },
    { min: 16500, max: 17000, value: 0.55 },
    { min: 17000, max: 17500, value: 0.5 },
    { min: 17500, max: 18000, value: 0.45 },
    { min: 18000, max: 18500, value: 0.4 },
    { min: 18500, max: 20000, value: 0.35 },
    { min: 20000, max: 20500, value: 0.3 },
    { min: 20500, max: 21000, value: 0.25 },
    { min: 21000, max: 21500, value: 0.2 },
    { min: 21500, max: 25000, value: 0.15 },
    { min: 25000, max: 25500, value: 0.14 },
    { min: 25500, max: 26000, value: 0.13 },
    { min: 26000, max: 26500, value: 0.12 },
    { min: 26500, max: 27000, value: 0.11 },
    { min: 27000, max: 48000, value: 0.1 },
    { min: 48000, max: 48500, value: 0.09 },
    { min: 48500, max: 49000, value: 0.08 },
    { min: 49000, max: 49500, value: 0.07 },
    { min: 49500, max: 50000, value: 0.06 },
    { min: 50000, max: 50500, value: 0.05 },
    { min: 50500, max: 51000, value: 0.04 },
    { min: 51000, max: 51500, value: 0.03 },
    { min: 51500, max: 52000, value: 0.02 },
    { min: 52000, max: 52500, value: 0.01 },
    { min: 52500, max: null, value: 0 },
  ],
  B: [
    { min: 0, max: 19000, value: 1 },
    { min: 19000, max: 24000, value: 0.75 },
    { min: 24000, max: 24500, value: 0.7 },
    { min: 24500, max: 25000, value: 0.65 },
    { min: 25000, max: 25500, value: 0.6 },
    { min: 25500, max: 26000, value: 0.55 },
    { min: 26000, max: 26500, value: 0.5 },
    { min: 26500, max: 27000, value: 0.45 },
    { min: 27000, max: 27500, value: 0.4 },
    { min: 27500, max: 34000, value: 0.35 },
    { min: 34000, max: 34500, value: 0.3 },
    { min: 34500, max: 35000, value: 0.25 },
    { min: 35000, max: 35500, value: 0.2 },
    { min: 35500, max: 44000, value: 0.15 },
    { min: 44000, max: 44500, value: 0.14 },
    { min: 44500, max: 45000, value: 0.13 },
    { min: 45000, max: 45500, value: 0.12 },
    { min: 45500, max: 46000, value: 0.11 },
    { min: 46000, max: 74000, value: 0.1 },
    { min: 74000, max: 74500, value: 0.09 },
    { min: 74500, max: 75000, value: 0.08 },
    { min: 75000, max: 75500, value: 0.07 },
    { min: 75500, max: 76000, value: 0.06 },
    { min: 76000, max: 76500, value: 0.05 },
    { min: 76500, max: 77000, value: 0.04 },
    { min: 77000, max: 77500, value: 0.03 },
    { min: 77500, max: 78000, value: 0.02 },
    { min: 78000, max: 78500, value: 0.01 },
    { min: 78500, max: null, value: 0 },
  ],
  C: [
    { min: 0, max: 24000, value: 1 },
    { min: 24000, max: 30000, value: 0.75 },
    { min: 30000, max: 30500, value: 0.7 },
    { min: 30500, max: 31000, value: 0.65 },
    { min: 31000, max: 31500, value: 0.6 },
    { min: 31500, max: 32000, value: 0.55 },
    { min: 32000, max: 32500, value: 0.5 },
    { min: 32500, max: 33000, value: 0.45 },
    { min: 33000, max: 33500, value: 0.4 },
    { min: 33500, max: 40000, value: 0.35 },
    { min: 40000, max: 40500, value: 0.3 },
    { min: 40500, max: 41000, value: 0.25 },
    { min: 41000, max: 41500, value: 0.2 },
    { min: 41500, max: 50000, value: 0.15 },
    { min: 50000, max: 50500, value: 0.14 },
    { min: 50500, max: 51000, value: 0.13 },
    { min: 51000, max: 51500, value: 0.12 },
    { min: 51500, max: 52000, value: 0.11 },
    { min: 52000, max: 96000, value: 0.1 },
    { min: 96000, max: 96500, value: 0.09 },
    { min: 96500, max: 97000, value: 0.08 },
    { min: 97000, max: 97500, value: 0.07 },
    { min: 97500, max: 98000, value: 0.06 },
    { min: 98000, max: 98500, value: 0.05 },
    { min: 98500, max: 99000, value: 0.04 },
    { min: 99000, max: 99500, value: 0.03 },
    { min: 99500, max: 100000, value: 0.02 },
    { min: 100000, max: 100500, value: 0.01 },
    { min: 100500, max: null, value: 0 },
  ],
  F: [
    { min: 0, max: 15000, value: 1 },
    { min: 15000, max: 18800, value: 0.75 },
    { min: 18800, max: 19300, value: 0.7 },
    { min: 19300, max: 19800, value: 0.65 },
    { min: 19800, max: 20300, value: 0.6 },
    { min: 20300, max: 20800, value: 0.55 },
    { min: 20800, max: 21300, value: 0.5 },
    { min: 21300, max: 21800, value: 0.45 },
    { min: 21800, max: 22300, value: 0.4 },
    { min: 22300, max: 25000, value: 0.35 },
    { min: 25000, max: 25500, value: 0.3 },
    { min: 25500, max: 26000, value: 0.25 },
    { min: 26000, max: 26500, value: 0.2 },
    { min: 26500, max: 31300, value: 0.15 },
    { min: 31300, max: 31800, value: 0.14 },
    { min: 31800, max: 32300, value: 0.13 },
    { min: 32300, max: 32800, value: 0.12 },
    { min: 32800, max: 33300, value: 0.11 },
    { min: 33300, max: 60000, value: 0.1 },
    { min: 60000, max: 60500, value: 0.09 },
    { min: 60500, max: 61000, value: 0.08 },
    { min: 61000, max: 61500, value: 0.07 },
    { min: 61500, max: 62000, value: 0.06 },
    { min: 62000, max: 62500, value: 0.05 },
    { min: 62500, max: 63000, value: 0.04 },
    { min: 63000, max: 63500, value: 0.03 },
    { min: 63500, max: 64000, value: 0.02 },
    { min: 64000, max: 64500, value: 0.01 },
    { min: 64500, max: null, value: 0 },
  ],
}

function getPeriodsPerYear(freq: ConnecticutPayrollFrequency): number {
  switch (freq) {
    case "weekly":
      return 52
    case "biweekly":
      return 26
    case "semi-monthly":
      return 24
    case "monthly":
      return 12
    case "annual":
      return 1
  }
}

function normalizeConnecticutCode(
  code: TaxProfileInput["connecticutWithholdingCode"]
): ConnecticutWithholdingCode | undefined {
  if (!code) return undefined
  return code
}

function getRangeValue(annualSalary: number, table: RangeValue[]): number {
  const row = table.find(({ min, max }) => annualSalary >= min && (max == null || annualSalary <= max))
  return row?.value ?? table[table.length - 1]?.value ?? 0
}

function getPiecewiseTax(annualTaxableIncome: number, table: PiecewiseBracket[]): number {
  const row = table.find(({ min, max }) => annualTaxableIncome >= min && (max == null || annualTaxableIncome <= max))
    ?? table[table.length - 1]
  return row.base + (annualTaxableIncome - row.min) * row.rate
}

function getConnecticutSourceWagesPerPayPeriod(profile: {
  taxableIncome: number
  state?: string
  residenceState?: string
  workState?: string
  connecticutNonresidentApportionmentPercent?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isConnecticutResident = residenceState === "Connecticut"

  if (isConnecticutResident || primaryState === "Connecticut" || workState === "Connecticut") {
    if (!isConnecticutResident && profile.connecticutNonresidentApportionmentPercent != null) {
      return d(profile.taxableIncome)
        .mul(profile.connecticutNonresidentApportionmentPercent)
        .div(100)
        .toDecimalPlaces(2)
        .toNumber()
    }

    return profile.taxableIncome
  }

  return 0
}

export function isConnecticutWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return state === "Connecticut" || residenceState === "Connecticut" || workState === "Connecticut"
}

export function calculateConnecticutWithholding(profile: {
  taxableIncome: number
  payFrequency: ConnecticutPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  connecticutWithholdingCode?: ConnecticutWithholdingCode
  connecticutAdditionalWithholding?: number
  connecticutReducedWithholding?: number
  connecticutNonresidentApportionmentPercent?: number
  connecticutFifteenDayExempt?: boolean
}): number {
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const primaryState = normalizeStateKey(profile.state ?? "")
  const isConnecticutResident = residenceState === "Connecticut"
  const worksInConnecticut = workState === "Connecticut"
  const sourceWages = getConnecticutSourceWagesPerPayPeriod(profile)

  if (!isConnecticutResident && !worksInConnecticut && primaryState !== "Connecticut") {
    return 0
  }

  if (!isConnecticutResident && profile.connecticutFifteenDayExempt) {
    return 0
  }

  const additionalWithholding = profile.connecticutAdditionalWithholding ?? 0
  const reducedWithholding = profile.connecticutReducedWithholding ?? 0
  const code = normalizeConnecticutCode(profile.connecticutWithholdingCode)

  if (code === "E") {
    return 0
  }

  if (sourceWages <= 0) {
    return clampNonNegative(d(additionalWithholding).sub(reducedWithholding)).toDecimalPlaces(2).toNumber()
  }

  if (!code) {
    return clampNonNegative(
      d(sourceWages)
        .mul(CONNECTICUT_NO_FORM_RATE)
        .add(additionalWithholding)
        .sub(reducedWithholding)
    )
      .toDecimalPlaces(2)
      .toNumber()
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualSalary = d(sourceWages).mul(periods).toNumber()
  const exemptionAmount = getRangeValue(annualSalary, CONNECTICUT_EXEMPTION_TABLE[code])
  const annualTaxableIncome = clampNonNegative(d(annualSalary).sub(exemptionAmount)).toNumber()

  let annualWithholding = d(0)

  if (annualTaxableIncome > 0) {
    const initialTax = getPiecewiseTax(annualTaxableIncome, CONNECTICUT_INITIAL_TAX_TABLE[code])
    const phaseOut = getRangeValue(annualSalary, CONNECTICUT_PHASE_OUT_TABLE[code])
    const recapture =
      code === "F"
        ? 0
        : getRangeValue(annualSalary, CONNECTICUT_RECAPTURE_TABLE[code as Exclude<ConnecticutTableCode, "F">])
    const creditRate =
      code === "D"
        ? 0
        : getRangeValue(annualSalary, CONNECTICUT_CREDIT_TABLE[code as Exclude<ConnecticutWithholdingCode, "D" | "E">])

    annualWithholding = d(initialTax + phaseOut + recapture).mul(d(1).sub(creditRate))
  }

  return clampNonNegative(
    annualWithholding.div(periods).add(additionalWithholding).sub(reducedWithholding)
  )
    .toDecimalPlaces(2)
    .toNumber()
}

export const connecticutStrategy: StateTaxStrategy = {
  stateCode: "Connecticut",
  applies: (context) => isConnecticutWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      context.profile.connecticutAdditionalWithholding != null &&
      context.profile.connecticutReducedWithholding != null &&
      (context.profile.connecticutAdditionalWithholding > 0 || context.profile.connecticutReducedWithholding > 0)
    ) {
      warnings.push(
        "Connecticut Form CT-W4 usually uses either an additional withholding amount or a reduced withholding amount, not both. Review those entries if both were intentional."
      )
    }

    if (
      residenceState === "Connecticut" &&
      workState !== "Connecticut"
    ) {
      warnings.push(
        "Connecticut residents working in another taxing jurisdiction can require the resident withholding reduction for other-state withholding. This calculator currently computes the Connecticut withholding amount before any cross-state offset."
      )
    }

    if (
      residenceState !== "Connecticut" &&
      workState === "Connecticut" &&
      context.profile.connecticutNonresidentApportionmentPercent == null &&
      context.multiStateWorker
    ) {
      warnings.push(
        "For a nonresident working partly inside and partly outside Connecticut, enter the CT-W4NA Connecticut work percentage to avoid treating the full paycheck as Connecticut wages."
      )
    }

    if (
      residenceState !== "Connecticut" &&
      context.profile.connecticutFifteenDayExempt &&
      workState === "Connecticut"
    ) {
      warnings.push(
        "Connecticut's 15-day nonresident rule only applies if the employee actually performs services in Connecticut for 15 days or fewer during the calendar year. If that threshold is exceeded, withholding is due on all Connecticut workday wages, including the first 15 days."
      )
    }

    if (!context.profile.connecticutWithholdingCode) {
      warnings.push(
        "No Connecticut CT-W4 withholding code is on file, so this estimate uses the required 6.99% no-form fallback without any personal exemption or credit."
      )
    }

    if (context.profile.connecticutWithholdingCode === "D") {
      warnings.push(
        "Connecticut withholding code D is the highest regular withholding setting and is commonly used when the employee has significant nonwage income or wants to avoid underwithholding."
      )
    }

    return createStateCalculationResult("Connecticut CT-W4 payroll withholding", "dedicated", {
      stateTax: calculateConnecticutWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        connecticutWithholdingCode: context.profile.connecticutWithholdingCode,
        connecticutAdditionalWithholding: context.profile.connecticutAdditionalWithholding,
        connecticutReducedWithholding: context.profile.connecticutReducedWithholding,
        connecticutNonresidentApportionmentPercent: context.profile.connecticutNonresidentApportionmentPercent,
        connecticutFifteenDayExempt: context.profile.connecticutFifteenDayExempt,
      }),
      warnings,
    })
  },
}
