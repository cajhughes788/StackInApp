import Anthropic from "@anthropic-ai/sdk"
import {
  VOICE_AMOUNT_TARGETS,
  VOICE_SPLIT_CATEGORIES,
  VoiceEntryResultSchema,
  type VoiceEntryRequest,
  type VoiceEntryResult,
} from "@shared/voiceEntry"
import { ANTHROPIC_API_KEY } from "../secrets"

// Turns a spoken entry ("made 270 today, 9 to 5, 40 in tips") into Add entry
// form fields. Only the typed-out words reach this server — never the audio,
// which goes only to the phone's own speech recognition — and nothing is saved here: the app fills the form
// and the person checks it and taps Add entry.
//
// Claude only sorts words into fields. It never adds anything up; totals the
// app shows come from the person's own records.

// Fast and cheap: a reply has to come back while the person waits.
const MODEL = "claude-haiku-5-5"

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
  "Say only what they said. Leave a field null (or out of amounts) when they didn't say it. Never invent amounts, times or hours, and never add numbers up or work out pay.",
  "",
  "Rules:",
  "- date: YYYY-MM-DD. 'today' or no day mentioned = null (the form already shows today). Work out 'yesterday', 'Monday', 'last Friday' from the today date you're given; a weekday means the most recent one on or before today.",
  "- inTime / outTime: 24-hour HH:MM. Work hours are usually daytime: '9 to 5' = 09:00 to 17:00, '4 to midnight' = 16:00 to 00:00, '11 to 7' = 11:00 to 19:00. Use AM/PM when they say it.",
  "- hours: only when they say a number of hours ('worked 8 hours'). Don't work it out from in/out times.",
  "- positionId: only when they name a position from the list given; use its id.",
  "- amounts: one item per amount said. Pick the target from the fields this form has. A payment method or tips word decides the target. If the amount's kind isn't said, use 'unsure' — don't guess sales vs tips vs cash. Tips with no way to tell which tips field (when more than one fits) = 'tipsUnsure'.",
  "- category: only for venmo, appleCash, zelle, checks, cashApp — 'services', 'tips', 'products' or 'other' when said, else null. Always null for other targets.",
  "- 'tips' with only one tips field on the form goes to that field.",
  "- notes: a short note only when they give extra detail worth keeping (a client name, what the work was). Otherwise null.",
  "- isEntry: false when the words aren't about logging money or work at all.",
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
  },
  required: ["isEntry", "date", "hours", "inTime", "outTime", "positionId", "amounts", "notes"],
  additionalProperties: false,
}

let client: Anthropic | null = null
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
    "",
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
  positionId: null,
  amounts: [],
  notes: null,
}

export async function parseVoiceEntry(request: VoiceEntryRequest): Promise<VoiceEntryResult> {
  const anthropic = getClient()
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
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
  }
}
