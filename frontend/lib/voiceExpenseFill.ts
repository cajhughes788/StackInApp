// Turns a voice expense reply (shared/voiceExpense.ts) into what the Add
// expense form should fill in. A category nobody can vouch for, or a round
// trip, becomes a question with buttons instead of a guess. The only math
// here is doubling a one-way trip, and only after the person picks it.

import type { VoiceCategorySource, VoiceExpenseCurrent, VoiceExpenseResult } from "@shared/voiceExpense"

export type ExpenseVoiceQuestion =
  | { id: string; kind: "category"; prompt: string; options: Array<{ label: string; category: string }> }
  | { id: string; kind: "miles"; prompt: string; options: Array<{ label: string; miles: number }> }

export type ExpenseFillPlan = {
  date: string | null
  amount: number | null
  // The whole-dollar reading of a "9121" that was filled as $91.21, for the note's button.
  amountAsWhole: number | null
  vendor: string | null
  description: string | null
  category: string | null
  categorySource: VoiceCategorySource | null
  // Where the fields go when the category is the vehicle one.
  vehicleMode: "mileage" | "direct_expense" | null
  miles: number | null
  parkingAndTolls: number | null
  questions: ExpenseVoiceQuestion[]
  // Short notes for the person about what was left out and why.
  skipped: string[]
}

export type ExpenseFillContext = {
  // The categories the picker offers.
  categories: string[]
  vehicleCategory: string | null
  dateBounds: { start: string; end: string } | null
  // The phone's own vendor → category memory from typed expenses.
  phoneLearned: (vendor: string) => string | undefined
  // Categories used lately, most recent first, for the "which category?" buttons.
  recentCategories: string[]
  // A "Fix by voice" reply: only what was said changes, so nothing is asked about what wasn't.
  fixing: boolean
  // The category and vehicle mode already on the form (picked by hand, or a fix).
  // Voice only changes the category when one was said, learned or guessed.
  currentCategory?: string | null
  currentVehicleMode?: "mileage" | "direct_expense" | null
}

const money = (amount: number) =>
  `$${amount.toLocaleString("en-US", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function pickCategory(name: string | null | undefined, categories: string[]): string | null {
  if (!name) return null
  return categories.find((category) => sameName(category, name)) ?? null
}

export function planExpenseFill(result: VoiceExpenseResult, ctx: ExpenseFillContext): ExpenseFillPlan {
  const skipped: string[] = []
  const questions: ExpenseVoiceQuestion[] = []

  let date: string | null = null
  if (result.date) {
    if (!ctx.dateBounds || (result.date >= ctx.dateBounds.start && result.date <= ctx.dateBounds.end)) {
      date = result.date
    } else {
      skipped.push("That day is outside the period you're looking at, so the date wasn't changed.")
    }
  }

  const vendor = result.vendor?.trim() || null
  let amount = result.amount
  let parkingAndTolls = result.parkingAndTolls
  let miles = result.miles

  // Category, best first: said, learned (bank review, then this phone), Claude's guess.
  let category = pickCategory(result.category, ctx.categories)
  let categorySource: VoiceCategorySource | null = category ? result.categorySource : null
  if (vendor && categorySource !== "said" && categorySource !== "learned") {
    const fromPhone = pickCategory(ctx.phoneLearned(vendor), ctx.categories)
    if (fromPhone) {
      category = fromPhone
      categorySource = "learned"
    }
  }

  // Miles: only where mileage can be logged, and always under the vehicle category.
  const vehicle = pickCategory(ctx.vehicleCategory, ctx.categories)
  const wantsMileage = Boolean(miles || result.roundTrip)
  if (wantsMileage && !vehicle) {
    skipped.push("Mileage isn't turned on for this workspace, so the miles weren't added.")
    miles = null
  } else if (wantsMileage && vehicle) {
    if (category !== vehicle) {
      category = vehicle
      categorySource = "said"
    }
    if (result.roundTrip && miles) {
      questions.push({
        id: "miles",
        kind: "miles",
        prompt: `Was that ${miles} miles each way?`,
        options: [
          { label: `${miles * 2} miles (there and back)`, miles: miles * 2 },
          { label: `${miles} miles (one way)`, miles },
        ],
      })
      miles = null
    }
  }

  // With no category from voice, the one already on the form stays.
  const formCategory = category ?? pickCategory(ctx.currentCategory, ctx.categories)
  const isVehicle = Boolean(vehicle && formCategory === vehicle)
  let vehicleMode: ExpenseFillPlan["vehicleMode"] = null
  const unplacedParking = (amountPaid: number) =>
    `${money(amountPaid)} for parking or tolls wasn't added. Save it as its own expense.`
  if (isVehicle) {
    const keepMode = !category ? (ctx.currentVehicleMode ?? null) : null
    vehicleMode =
      wantsMileage || (parkingAndTolls && !amount)
        ? "mileage"
        : amount
          ? keepMode === "mileage" ? "mileage" : "direct_expense"
          : keepMode
    if (vehicleMode === "mileage" && amount) {
      skipped.push(`${money(amount)} wasn't added: the mileage rate already covers gas and upkeep. Only parking and tolls go on top.`)
      amount = null
    }
    if (vehicleMode !== "mileage" && parkingAndTolls) {
      skipped.push(unplacedParking(parkingAndTolls))
      parkingAndTolls = null
    }
  } else if (parkingAndTolls && !amount) {
    // Parking said on its own, with no mileage: it's just what they paid.
    amount = parkingAndTolls
    parkingAndTolls = null
  } else if (parkingAndTolls) {
    skipped.push(unplacedParking(parkingAndTolls))
    parkingAndTolls = null
  }

  // No category anyone can vouch for: ask, with recent ones first.
  if (!formCategory && !ctx.fixing && (amount || vendor)) {
    const options: string[] = []
    for (const name of [...ctx.recentCategories, ...ctx.categories]) {
      const real = pickCategory(name, ctx.categories)
      if (real && real !== vehicle && !options.includes(real)) options.push(real)
      if (options.length === 4) break
    }
    if (options.length > 0) {
      questions.push({
        id: "category",
        kind: "category",
        prompt: vendor ? `Which category is ${vendor}?` : "Which category is this?",
        options: options.map((name) => ({ label: name, category: name })),
      })
    }
  }

  return {
    date,
    amount,
    amountAsWhole: amount !== null ? result.amountAsWhole : null,
    vendor,
    description: result.description?.trim() || null,
    category,
    categorySource,
    vehicleMode,
    miles,
    parkingAndTolls,
    questions,
    skipped,
  }
}

export type ExpenseFormSnapshot = {
  date: string
  today: string
  account: string
  amount: string
  vendor: string
  description: string
  miles: string
  parkingAndTolls: string
}

/** What's on the form now, for a "Fix by voice" request. */
export function voiceExpenseCurrentFor(form: ExpenseFormSnapshot): VoiceExpenseCurrent {
  const positive = (value: string) => {
    const n = Number(value)
    return value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
  }
  return {
    date: form.date && form.date !== form.today ? form.date : null,
    amount: positive(form.amount),
    vendor: form.vendor.trim().slice(0, 100) || null,
    description: form.description.trim().slice(0, 200) || null,
    category: form.account.trim().slice(0, 100) || null,
    miles: positive(form.miles),
    parkingAndTolls: positive(form.parkingAndTolls),
  }
}

/** Words for the phone's speech recognition to listen for on this form:
 * the person's own vendors and categories, and trip words. */
export function voiceExpenseHints(vendors: string[], categories: string[]): string[] {
  const hints = new Set<string>(["miles", "round trip", "each way", "parking", "tolls", "gas", "supplies", "yesterday"])
  for (const vendor of vendors.slice(0, 50)) if (vendor.trim()) hints.add(vendor.trim())
  for (const category of categories) if (category.trim() && category.length <= 30) hints.add(category.trim())
  return [...hints].slice(0, 100)
}
