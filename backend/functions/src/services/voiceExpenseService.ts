import Anthropic from "@anthropic-ai/sdk"
import { readSpokenCents, VoiceExpenseResultSchema, type VoiceExpenseRequest, type VoiceExpenseResult } from "@shared/voiceExpense"
import { normalizePlaidMerchantKey } from "@shared/plaidClassification"
import { db } from "../admin"
import { getVoiceClient, VOICE_MODEL, VOICE_THINKING, type VoiceThinking, askedLines } from "./voiceEntryService"

// Turns a spoken expense ("spent 42 on gas at Shell yesterday") into Add
// expense form fields. Only the typed-out words reach this server, and
// nothing is saved here: the app fills the form and the person checks it.
//
// The category is picked in this order:
//   1. the person said it ("for supplies"),
//   2. what they decided before for this merchant in bank review
//      (workspaces/{id}/plaidMerchantMemory — the same record and merchant
//      matching the bank review uses),
//   3. Claude's guess, marked "suggested" so the app shows it as one.
// The app adds one more check between 2 and 3: the vendor → category pairs
// the phone remembers from typed expenses. With none of these, the app asks.

const SYSTEM_PROMPT = [
  "You turn what a person said out loud into fields for the Add expense form of 521, a bookkeeping app for self-employed service workers.",
  "Say only what they said. Leave a field null when they didn't say it. Never invent amounts, vendors or miles, and never add numbers up.",
  "",
  "Rules:",
  "- date: YYYY-MM-DD. 'today' or no day mentioned = null (the form already shows today). Work out 'yesterday', 'Monday', 'last Friday' from the today date you're given; a weekday means the most recent one on or before today.",
  "- amount: what they paid ('42', 'forty-two bucks', '1.2k' = 1200). Copy a plain number exactly as the words show it, even when it looks too big ('9121' = 9121, not 91.21); the app works out dollars and cents itself. For a trip with miles, amount is only something else they paid, not the trip itself; put parking and tolls in parkingAndTolls instead.",
  "- vendor: the store or business name as people write it ('Shell', 'Home Depot', 'Sally Beauty'). Null when they don't name one.",
  "- description: a few words for what it was, from their words ('Gas', 'Color supplies', 'Client visit in Spokane'). Null when they only gave a store and amount with nothing about what it was.",
  "- category: one name copied exactly from the category list, or null.",
  "- categoryHow: 'said' when they named that category or something only it covers ('for supplies', 'advertising', 'parking'); 'likely' when it's your best guess from the vendor or what it was (Shell → gas → the vehicle category, Sally Beauty → supplies); 'unsure' when you can't tell (then category null). Don't stretch: a store that sells many kinds of things (Target, Walmart, Amazon, Costco) with nothing said about what was bought = 'unsure'.",
  "- miles: business miles driven, when they say miles. With 'each way' or 'there and back' or 'round trip' plus a one-way number, give the one-way number and set roundTrip true. A round-trip total ('36 miles round trip') is just miles 36, roundTrip false.",
  "- When they drove somewhere for work and give miles, the category is the vehicle category (categoryHow 'said').",
  "- parkingAndTolls: money paid for parking or tolls, with or without miles ('paid 15 for parking' = parkingAndTolls 15). Put it only here, never also in amount; amount is only for anything else they paid.",
  "- isExpense: false when the words aren't about spending money or driving for work.",
  "",
  "Fixing: when you're given 'Already on the form', the person is correcting that form. Return only what the new words change; leave everything else null, and set isExpense true. 'Make that 52' changes the amount; 'it was Chevron' changes the vendor; 'that was supplies' changes the category ('said').",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isExpense: { type: "boolean" },
    date: nullable({ type: "string" }),
    amount: nullable({ type: "number" }),
    vendor: nullable({ type: "string" }),
    description: nullable({ type: "string" }),
    category: nullable({ type: "string" }),
    categoryHow: { type: "string", enum: ["said", "likely", "unsure"] },
    miles: nullable({ type: "number" }),
    roundTrip: { type: "boolean" },
    parkingAndTolls: nullable({ type: "number" }),
  },
  required: [
    "isExpense", "date", "amount", "vendor", "description", "category",
    "categoryHow", "miles", "roundTrip", "parkingAndTolls",
  ],
  additionalProperties: false,
}

const EMPTY_RESULT: VoiceExpenseResult = {
  isExpense: false,
  date: null,
  amount: null,
  vendor: null,
  description: null,
  category: null,
  categorySource: null,
  miles: null,
  roundTrip: false,
  parkingAndTolls: null,
  amountAsWhole: null,
}

function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
}

function buildUserContent(request: VoiceExpenseRequest): string {
  const current = request.current
  return [
    `Today: ${request.today} (${weekdayOf(request.today)})`,
    `Categories: ${request.categories.join(" | ")}`,
    request.vehicleCategory
      ? `Vehicle category (for miles, gas, parking, tolls): ${request.vehicleCategory}`
      : "Vehicle category: none (this person doesn't log mileage)",
    ...(current
      ? [
          "",
          "Already on the form (they're fixing it):",
          `- date: ${current.date ?? "today"}; amount: ${current.amount ?? "none"}; vendor: ${current.vendor ?? "none"}`,
          `- description: ${current.description ?? "none"}; category: ${current.category ?? "none"}`,
          `- miles: ${current.miles ?? "none"}; parkingAndTolls: ${current.parkingAndTolls ?? "none"}`,
        ]
      : []),
    "",
    ...askedLines(request.asking),
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

/** A past bank-review decision for this merchant, or null. Business only. */
export type LearnedCategoryLookup = (vendor: string) => Promise<string | null>

export function learnedCategoryLookup(workspaceId: string): LearnedCategoryLookup {
  return async (vendor) => {
    const key = normalizePlaidMerchantKey(vendor, vendor)
    if (!key) return null
    // Banks often add "The" ("The Home Depot"), people rarely say it.
    const keys = key.startsWith("the ") ? [key, key.slice(4)] : [key, `the ${key}`]
    const col = db.collection("workspaces").doc(workspaceId).collection("plaidMerchantMemory")
    const snaps = await db.getAll(...keys.map((k) => col.doc(k)))
    for (const snap of snaps) {
      const data = snap.exists ? snap.data() : null
      if (data?.isBusiness === true && typeof data.expenseCategory === "string" && data.expenseCategory.trim()) {
        return data.expenseCategory
      }
    }
    return null
  }
}

/** The request's own spelling of a category, or null when it isn't one of them. */
function matchCategory(name: string | null, categories: readonly string[]): string | null {
  if (!name) return null
  const wanted = name.trim().toLowerCase()
  return categories.find((category) => category.toLowerCase() === wanted) ?? null
}

export async function parseVoiceExpense(
  request: VoiceExpenseRequest,
  lookupLearned: LearnedCategoryLookup
): Promise<VoiceExpenseResult> {
  return parseVoiceExpenseWith(getVoiceClient(), request, lookupLearned, VOICE_THINKING)
}

// The same parse with a given client and learned lookup — the eval script
// uses this with its own key and a made-up set of learned merchants.
export async function parseVoiceExpenseWith(
  anthropic: Anthropic,
  request: VoiceExpenseRequest,
  lookupLearned: LearnedCategoryLookup,
  thinking: VoiceThinking = VOICE_THINKING
): Promise<VoiceExpenseResult> {
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: VOICE_MODEL,
      max_tokens: 2048,
      ...(thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(request) }],
    })
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("voiceExpense: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceExpense: request failed", error)
    }
    throw new Error("voiceExpense: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceExpense: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceExpense: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceExpense: reply wasn't JSON")
    return EMPTY_RESULT
  }
  // A 0 means "nothing said", not a value to fill.
  for (const key of ["amount", "miles", "parkingAndTolls"]) {
    if (typeof raw[key] === "number" && (raw[key] as number) <= 0) raw[key] = null
  }
  // Parking said once can come back in both boxes; it's one payment.
  if (typeof raw.amount === "number" && raw.amount === raw.parkingAndTolls) raw.amount = null
  const how = raw.categoryHow
  const parsed = VoiceExpenseResultSchema.safeParse({ ...raw, categorySource: null, amountAsWhole: null })
  if (!parsed.success) {
    console.warn("voiceExpense: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }
  const result = parsed.data
  const fixing = Boolean(request.current)
  const vendor = result.vendor?.trim() || null

  // Miles only make sense where mileage can be logged.
  const vehicleCategory = matchCategory(request.vehicleCategory, request.categories)
  const guessed = matchCategory(result.category, request.categories)
  let category: string | null = null
  let categorySource: VoiceExpenseResult["categorySource"] = null
  if (guessed && how === "said") {
    category = guessed
    categorySource = "said"
  } else if (vehicleCategory && result.miles && !result.category) {
    category = vehicleCategory
    categorySource = "said"
  } else if (fixing && !vendor) {
    // A fix that names neither a category nor a vendor leaves the category alone.
  } else {
    const learned = vendor ? matchCategory(await lookupLearned(vendor).catch(() => null), request.categories) : null
    if (learned) {
      category = learned
      categorySource = "learned"
    } else if (guessed && how === "likely") {
      category = guessed
      categorySource = "suggested"
    }
  }

  return { ...result, ...readSpokenCents(request.transcript, result.amount), vendor, category, categorySource }
}
