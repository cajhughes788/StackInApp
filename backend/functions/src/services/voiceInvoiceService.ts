import Anthropic from "@anthropic-ai/sdk"
import { VoiceInvoiceResultSchema, type VoiceInvoiceRequest, type VoiceInvoiceResult } from "@shared/voiceInvoice"
import { getVoiceClient, VOICE_MODEL, VOICE_THINKING, type VoiceThinking, askedLines } from "./voiceEntryService"

// Turns a spoken invoice or quote ("invoice Jenna 120 for a cut and color,
// due Friday") into invoice form fields. Only the typed-out words and the
// person's saved client names reach this server, and nothing is saved or
// sent here: the app fills the form and the person checks it.
//
// The app does all the money math (line totals, the invoice total) and
// works out due dates from terms; Claude only copies what was said.

const SYSTEM_PROMPT = [
  "You turn what a person said out loud into fields for the invoice or quote form of 521, a bookkeeping app for self-employed service workers (hair stylists, cleaners, photographers, handymen and the like).",
  "Say only what they said. Leave a field null when they didn't say it. Never invent clients, prices or lines, and never add, multiply or split numbers.",
  "",
  "Rules:",
  "- clientName: who it's for, as they said it ('Jenna Morales', 'Bright Smiles Dental', or just 'Jenna'). A first name alone stays just the first name: the app matches it to their saved clients and asks if several fit. When a full name sounds like a saved client's (spelled a little differently), copy the saved spelling. Capitalize names. Never null when they named someone, and never put 'invoice' or 'quote' in it.",
  "- clientEmail: only when they say an email ('jenna at gmail dot com' = 'jenna@gmail.com'). clientPhone: only when they say a phone number, digits as said.",
  "- lines: one per thing billed, in the order said. description = a few words from their words ('Cut and color', 'Gloss treatment', 'Deep clean, 3 bedroom'), capitalized. quantity and rate:",
  "  - A count with a price per one = quantity the count, rate the per-one price, never multiplied: '3 hours at 45' = quantity 3, rate 45; '2 shirts at 20 each' = quantity 2, rate 20; '2 days at 600 a day' = quantity 2, rate 600. The app multiplies.",
  "  - A price for several things with no per-each price ('2 haircuts, 60 total', '3 hours for 150') = quantity 1, rate the price, and the count goes in the description ('2 haircuts', '3 hours').",
  "  - No count said = quantity 1. A line with no price said is left out.",
  "  - Amounts are as said: '1250' = 1250, '1.2k' = 1200, '99.50' = 99.5.",
  "  - category: 'products' for goods sold (retail products, parts, materials); 'tips' for a tip or gratuity line; 'other' for fees like travel or a late fee; otherwise 'services'.",
  "- issueDate: YYYY-MM-DD only when they say the invoice or quote date ('dated Monday', 'for last Friday'). Otherwise null (the form uses today).",
  "- When it's due (an invoice) or how long it's good for (a quote):",
  "  - A day ('due Friday', 'due the 30th', 'good until December 1st') = dueDate YYYY-MM-DD. Work it out from the today date you're given; a weekday means the next one after today ('due Friday' on a Friday = a week later).",
  "  - 'due on receipt', 'due now', 'due today' = dueTerms 'due_on_receipt'. 'net 15' / 'in 15 days' = 'net_15'. 'net 30' / 'in 30 days' = 'net_30'. Other numbers of days on an invoice = dueDate worked out from the issue date.",
  "  - On a quote, 'good for 30 days' / 'valid for two weeks' = validDays (30, 14).",
  "- note: only when they say something for the customer ('add a note: thanks for coming in!', 'tell them parking is in back'). The note text only, as they'd write it.",
  "- isInvoice: false when the words aren't about billing someone or quoting a price.",
  "",
  "Fixing: when you're given 'Already on the form', the person is correcting that form. Return only what the new words change; leave everything else null, and set isInvoice true.",
  "- Any change to lines ('make the gloss 45', 'add a 20 tip', 'remove the gloss', 'make it 2 hours') = return lines as the whole new list: every line on the form, in order, copied exactly, with only that change made. No change to lines = lines null.",
  "- 'it's for Jenna Smith' changes clientName; 'due Friday instead' changes the due date.",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const LINE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    rate: { type: "number" },
    category: { type: "string", enum: ["services", "products", "tips", "other"] },
  },
  required: ["description", "quantity", "rate", "category"],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isInvoice: { type: "boolean" },
    clientName: nullable({ type: "string" }),
    clientEmail: nullable({ type: "string" }),
    clientPhone: nullable({ type: "string" }),
    lines: nullable({ type: "array", items: LINE_SCHEMA }),
    issueDate: nullable({ type: "string" }),
    dueDate: nullable({ type: "string" }),
    dueTerms: nullable({ type: "string", enum: ["due_on_receipt", "net_15", "net_30"] }),
    validDays: nullable({ type: "integer" }),
    note: nullable({ type: "string" }),
  },
  required: [
    "isInvoice", "clientName", "clientEmail", "clientPhone", "lines",
    "issueDate", "dueDate", "dueTerms", "validDays", "note",
  ],
  additionalProperties: false,
}

const EMPTY_RESULT: VoiceInvoiceResult = {
  isInvoice: false,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  lines: null,
  issueDate: null,
  dueDate: null,
  dueTerms: null,
  validDays: null,
  note: null,
}

function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
}

function buildUserContent(request: VoiceInvoiceRequest): string {
  const current = request.current
  return [
    `Form: ${request.document === "quote" ? "a quote (its due date is the last day it can be accepted)" : "an invoice"}`,
    `Today: ${request.today} (${weekdayOf(request.today)})`,
    request.clients.length > 0 ? `Saved clients: ${request.clients.join(" | ")}` : "Saved clients: none yet",
    ...(current
      ? [
          "",
          "Already on the form (they're fixing it):",
          `- client: ${current.clientName ?? "none"}; email: ${current.clientEmail ?? "none"}; phone: ${current.clientPhone ?? "none"}`,
          `- date: ${current.issueDate}; ${request.document === "quote" ? "valid until" : "due"}: ${current.dueDate}`,
          `- note: ${current.note ?? "none"}`,
          `- lines: ${current.lines.length > 0 ? JSON.stringify(current.lines) : "none"}`,
        ]
      : []),
    "",
    ...askedLines(request.asking),
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function parseVoiceInvoice(request: VoiceInvoiceRequest): Promise<VoiceInvoiceResult> {
  return parseVoiceInvoiceWith(getVoiceClient(), request, VOICE_THINKING)
}

// The same parse with a given client — the eval script uses this with its own key.
export async function parseVoiceInvoiceWith(
  anthropic: Anthropic,
  request: VoiceInvoiceRequest,
  thinking: VoiceThinking = VOICE_THINKING
): Promise<VoiceInvoiceResult> {
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: VOICE_MODEL,
      max_tokens: 4096,
      ...(thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(request) }],
    })
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("voiceInvoice: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceInvoice: request failed", error)
    }
    throw new Error("voiceInvoice: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceInvoice: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceInvoice: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceInvoice: reply wasn't JSON")
    return EMPTY_RESULT
  }
  // A line with no real price or count was a mishearing, not a line.
  if (Array.isArray(raw.lines)) {
    raw.lines = (raw.lines as Array<Record<string, unknown>>).filter(
      (line) => typeof line?.rate === "number" && line.rate > 0 && typeof line.quantity === "number" && line.quantity > 0
    )
    if ((raw.lines as unknown[]).length === 0 && !request.current) raw.lines = null
  }
  for (const key of ["clientName", "clientEmail", "clientPhone", "note"]) {
    if (typeof raw[key] === "string" && !(raw[key] as string).trim()) raw[key] = null
  }
  if (typeof raw.validDays === "number" && raw.validDays <= 0) raw.validDays = null
  const parsed = VoiceInvoiceResultSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("voiceInvoice: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }
  const result = parsed.data
  // Only a real-looking email goes in the email box.
  const clientEmail = result.clientEmail && EMAIL.test(result.clientEmail.replace(/\s+/g, "")) ? result.clientEmail.replace(/\s+/g, "").toLowerCase() : null
  // Validity days only mean something on a quote; terms only on an invoice.
  return {
    ...result,
    clientEmail,
    dueTerms: request.document === "invoice" ? result.dueTerms : null,
    validDays: request.document === "quote" ? result.validDays : null,
  }
}
