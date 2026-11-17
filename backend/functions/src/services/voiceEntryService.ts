import Anthropic from "@anthropic-ai/sdk"
import {
  VOICE_AMOUNT_TARGETS,
  VOICE_SPLIT_CATEGORIES,
  VoiceEntryResultSchema,
  type VoiceEntryRequest,
  type VoiceEntryResult,
} from "@shared/voiceEntry"
import { ANTHROPIC_API_KEY } from "../secrets"
import { db } from "../admin"
import { TooManyRequestsError } from "../lib/httpErrors"

// Most voice fill-ins one person can use a day (UTC). Normal use is 1–3; this
// caps what Claude can cost if the feature is misused.
export const MAX_VOICE_FILLS_PER_DAY = 50

// Counts one fill-in for this person, before Claude is asked. Server only:
// the app can't read or write users/{uid}/counters (firestore.rules).
export async function reserveVoiceFill(uid: string): Promise<void> {
  const ref = db.collection("users").doc(uid).collection("counters").doc("voiceEntry")
  const today = new Date().toISOString().slice(0, 10)
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const count = snap.data()?.date === today ? Number(snap.data()?.count ?? 0) : 0
    if (count >= MAX_VOICE_FILLS_PER_DAY) {
      throw new TooManyRequestsError("You've used voice a lot today. Type this one in, and voice is back tomorrow.")
    }
    txn.set(ref, { date: today, count: count + 1 }, { merge: true })
  })
}

/** Gives back one of today's voice fills. Ask 521's "log" hands the words
 * to a form whose own fill is the one counted, so the ask itself shouldn't be. */
export async function releaseVoiceFill(uid: string): Promise<void> {
  const ref = db.collection("users").doc(uid).collection("counters").doc("voiceEntry")
  const today = new Date().toISOString().slice(0, 10)
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (snap.data()?.date !== today) return
    const count = Number(snap.data()?.count ?? 0)
    if (count > 0) txn.set(ref, { count: count - 1 }, { merge: true })
  })
}

// Turns a spoken entry ("made 270 today, 9 to 5, 40 in tips") into Add entry
// form fields. Only the typed-out words reach this server — never the audio,
// which goes only to the phone's own speech recognition — and nothing is saved here: the app fills the form
// and the person checks it and taps Add entry.
//
// Claude only sorts words into fields. It never adds anything up; totals the
// app shows come from the person's own records.

// Fast and cheap: a reply has to come back while the person waits.
// Voice expenses (voiceExpenseService.ts) use the same model and settings.
export const VOICE_MODEL = "claude-haiku-5-5"
const MODEL = VOICE_MODEL

const FIELD_HELP: Record<(typeof VOICE_AMOUNT_TARGETS)[number], string> = {
  venmo: "money received by Venmo",
  appleCash: "money received by Apple Pay / Apple Cash",
  zelle: "money received by Zelle",
  checks: "money received by check",
  cashApp: "money received by Cash App",
  posSales: "card / POS sales (card machine, Square, Clover, etc.), not counting tips",
  cashSales: "cash sales, not counting tips",
  posTips: "tips paid on card / POS",
  cashTips: "tips paid in cash",
  cardTips: "credit card tips from the job",
  reportedCash: "cash tips the person reports to their employer",
  personalCash: "cash the person keeps off the books (only when they clearly say so, e.g. 'personal cash' or 'unreported')",
  tipsUnsure: "tips, when nothing says how they were paid and more than one tips field fits",
  unsure: "an amount with nothing saying what it was (e.g. 'made 270')",
}

const SYSTEM_PROMPT = [
  "You turn what a person said out loud into fields for the Add entry form of 521, a bookkeeping app for self-employed service workers and tipped employees.",
  "Say only what they said. Leave a field null (or out of amounts) when they didn't say it. Never invent amounts, times or hours, and never add numbers up or work out pay (the one exception is splitting a payment, below).",
  "",
  "Rules:",
  "- date: YYYY-MM-DD. 'today' or no day mentioned = null (the form already shows today). Work out 'yesterday', 'Monday', 'last Friday' from the today date you're given; a weekday means the most recent one on or before today.",
  "- inTime / outTime: 24-hour HH:MM. Use AM/PM when they say it. When they don't: a start of 6–11 is morning, 12 is noon, 1–5 is afternoon, and the end is the first time after the start that fits. '9 to 5' = 09:00 to 17:00, '2:47 to 11:21' = 14:47 to 23:21, '11 to 7' = 11:00 to 19:00, '7 to 3:30' = 07:00 to 15:30, '5 to 1' = 17:00 to 01:00, '4 to midnight' = 16:00 to 00:00.",
  "- Speech-to-text often garbles spoken times. When the words are clearly a time range, read 'to' or 'too' right before a minutes number as 2 ('worked to 47 to 1121' = 2:47 to 11:21), 'for' as 4, 'ate' as 8, and run-together digits as hour and minutes ('1121' = 11:21, '247' = 2:47, '930' = 9:30). A number with $ or a money word is money, not a time. Then apply the morning/afternoon rule above to the repaired times: 'in at for 30, out at 1145' = 16:30 to 23:45.",
  "- timesUnclear: true when they seem to give work times but you still can't tell what the times are; then leave inTime and outTime null. Otherwise false.",
  "- hours: only when they say a number of hours ('worked 8 hours'). Don't work it out from in/out times.",
  "- positionId: only when they name a position from the list given; use its id.",
  "- amounts: one item per amount said. Pick the target from the fields this form has. A payment method or tips word decides the target. If the amount's kind isn't said, use 'unsure' — don't guess sales vs tips vs cash. Tips with no way to tell which tips field (when more than one fits) = 'tipsUnsure' — never plain 'unsure' when they said tips ('62 dollars in tips').",
  "- category: only for venmo, appleCash, zelle, checks, cashApp — 'services', 'tips', 'products' or 'other' when said, else null. Always null for other targets.",
  "- A payment word alone is enough: on a self-employed form '300 cash', 'yesterday 180 cash' or 'two seventy in cash' = cashSales, '1.2k card' or 'on Square' = posSales, 'Venmo 85' = venmo. On a W-2 form, cash with no other word = 'unsure' (whether they report it is their call). Use personalCash only when they say personal, unreported or off the books.",
  "- When they say part of one payment was tips ('Venmo 60, and 15 of it was tips'), split that one payment: the tips part with category 'tips' and the rest (60 − 15 = 45) with category null. Never list the whole 60 and the 15 both — that would count the 15 twice. This is the only time you subtract.",
  "- 'tips' with only one tips field on the form goes to that field.",
  "- notes: a short note only when they give extra detail worth keeping (a client name, what the work was). Otherwise null.",
  "- isEntry: false when the words aren't about logging money or work at all.",
  "- remove: [] unless they're fixing the form (below).",
  "",
  "Fixing: when you're given 'Already on the form', the person is correcting that form. Return only what the new words change; leave everything else null and out of amounts, and set isEntry true.",
  "- Times: 'make that PM', 'no, 2:47 to 11:21', 'I got out at 11:30' — always return both inTime and outTime, keeping the one they didn't change from the form.",
  "- An amount they correct ('tips were 313', 'no, 313') replaces the one on the form: use the target it has there. An 'unsure' amount stays 'unsure' unless they now say what it was ('the 331 was tips' = that amount with a tips target).",
  "- More added to an amount already there ('another 20 cash') = return that field's new total (300 + 20 = 320), since what you return replaces the box.",
  "- Taking an amount off ('no cash', 'take off the Venmo') = put its target in remove. Never return an amount of 0.",
  "- Saying where an 'unsure' amount goes ('that was tips') = that amount with its new target.",
  "",
  "Amounts are plain numbers: 'two seventy' = 270, '1.5k' = 1500, 'forty bucks' = 40.",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isEntry: { type: "boolean" },
    date: nullable({ type: "string" }),
    hours: nullable({ type: "number" }),
    inTime: nullable({ type: "string" }),
    outTime: nullable({ type: "string" }),
    timesUnclear: { type: "boolean" },
    positionId: nullable({ type: "string" }),
    amounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: "string", enum: [...VOICE_AMOUNT_TARGETS] },
          category: nullable({ type: "string", enum: [...VOICE_SPLIT_CATEGORIES] }),
          amount: { type: "number" },
        },
        required: ["target", "category", "amount"],
        additionalProperties: false,
      },
    },
    notes: nullable({ type: "string" }),
    remove: { type: "array", items: { type: "string", enum: [...VOICE_AMOUNT_TARGETS] } },
  },
  required: ["isEntry", "date", "hours", "inTime", "outTime", "timesUnclear", "positionId", "amounts", "notes", "remove"],
  additionalProperties: false,
}

let client: Anthropic | null = null
export function getVoiceClient(): Anthropic {
  return getClient()
}
function getClient(): Anthropic {
  if (client) return client
  const apiKey = ANTHROPIC_API_KEY.value()
  if (!apiKey) throw new Error("voiceEntry: ANTHROPIC_API_KEY is not set")
  client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 })
  return client
}

function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
}

/** The voice button asked for something ("Say the client's email"): the answer is that. */
export function askedLines(asking: readonly string[] | undefined): string[] {
  if (!asking || asking.length === 0) return []
  return [
    `They were just asked for: ${asking.join(", ")}. A short answer on its own (just an email, a phone number, a name, an amount, a service) is that; fill those fields from it and leave everything else as it is.`,
    "",
  ]
}

function describeCurrent(current: NonNullable<VoiceEntryRequest["current"]>): string {
  const amounts = current.amounts.map(
    (item) => `${item.target}${item.category ? ` (${item.category})` : ""} ${item.amount}`
  )
  return [
    `- date: ${current.date ?? "today"}`,
    `- inTime: ${current.inTime ?? "none"}, outTime: ${current.outTime ?? "none"}`,
    `- hours: ${current.hours ?? "none"}`,
    `- positionId: ${current.positionId ?? "none"}`,
    `- amounts: ${amounts.length > 0 ? amounts.join("; ") : "none"}`,
  ].join("\n")
}

function buildUserContent(request: VoiceEntryRequest): string {
  const fields = request.fields.length > 0 ? request.fields : (["unsure"] as const)
  return [
    `Today: ${request.today} (${weekdayOf(request.today)})`,
    `Workspace: ${request.workspaceType === "w2" ? "W-2 job (pay comes from hours × hourly rate, so don't record wages as an amount)" : "self-employed"}`,
    "Fields on this form:",
    ...fields.map((field) => `- ${field}: ${FIELD_HELP[field]}`),
    "- unsure: an amount with nothing saying what it was",
    request.positions.length > 0
      ? `Positions: ${request.positions.map((p) => `${p.id} = ${p.title}`).join("; ")}`
      : "Positions: none",
    ...(request.current ? ["", "Already on the form (they're fixing it):", describeCurrent(request.current)] : []),
    "",
    ...askedLines(request.asking),
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

const EMPTY_RESULT: VoiceEntryResult = {
  isEntry: false,
  date: null,
  hours: null,
  inTime: null,
  outTime: null,
  timesUnclear: false,
  positionId: null,
  amounts: [],
  notes: null,
  remove: [],
}

// "adaptive" lets the model think briefly; "off" skips thinking for speed.
// scripts/eval-voice-entry.cjs measures both against real sentences — change
// this only when its pass rate holds.
export type VoiceThinking = "adaptive" | "off"
// 2026-11-16: off passed 40/40 on three runs, ~0.5s faster than adaptive.
const THINKING: VoiceThinking = "off"
export const VOICE_THINKING = THINKING

export async function parseVoiceEntry(request: VoiceEntryRequest): Promise<VoiceEntryResult> {
  return parseVoiceEntryWith(getClient(), request, THINKING)
}

// The same parse with a given client — the eval script uses this with its own key.
export async function parseVoiceEntryWith(
  anthropic: Anthropic,
  request: VoiceEntryRequest,
  thinking: VoiceThinking = THINKING
): Promise<VoiceEntryResult> {
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      ...(thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(request) }],
    })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      console.warn("voiceEntry: rate limited")
    } else if (error instanceof Anthropic.APIError) {
      console.error("voiceEntry: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceEntry: request failed", error)
    }
    throw new Error("voiceEntry: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceEntry: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceEntry: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: unknown
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceEntry: reply wasn't JSON")
    return EMPTY_RESULT
  }
  // An amount of 0 means nothing to fill; drop it rather than lose the whole reply.
  if (raw && typeof raw === "object" && Array.isArray((raw as { amounts?: unknown }).amounts)) {
    const reply = raw as { amounts: Array<{ amount?: unknown }> }
    reply.amounts = reply.amounts.filter((item) => typeof item?.amount !== "number" || item.amount > 0)
  }
  const parsed = VoiceEntryResultSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("voiceEntry: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }

  // Keep only what this form can show, and a position from the person's own list.
  const allowed = new Set<string>([...request.fields, "unsure", "tipsUnsure"])
  const positionIds = new Set(request.positions.map((p) => p.id))
  const result = parsed.data
  return {
    ...result,
    positionId: result.positionId && positionIds.has(result.positionId) ? result.positionId : null,
    amounts: result.amounts.map((item) =>
      allowed.has(item.target) ? item : { ...item, target: "unsure" as const, category: null }
    ),
    // Only a fix can take amounts off, and only ones this form has.
    // ("unsure" isn't a box, so there's nothing to take off.)
    remove: request.current
      ? result.remove.filter((target) => allowed.has(target) && target !== "unsure" && target !== "tipsUnsure")
      : [],
  }
}
