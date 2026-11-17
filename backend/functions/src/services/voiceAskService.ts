import Anthropic from "@anthropic-ai/sdk"
import { VoiceAskResultSchema, type VoiceAskRequest, type VoiceAskResult } from "@shared/voiceAsk"
import { getVoiceClient, VOICE_MODEL, VOICE_THINKING, type VoiceThinking } from "./voiceEntryService"

// Ask 521 (Home's mic): works out only WHAT someone asked for — a question,
// a page to open, or something to log. Claude never sees an amount or a
// record; the app answers from the person's own data with its own math.

const SYSTEM_PROMPT = [
  "You sort what a person said to 521 (a bookkeeping app for self-employed and hourly service workers) into what they want. You never answer with numbers: the app works out every answer itself. You only say which question, page or form.",
  "",
  "intent:",
  "- 'question': they ask about their own money, hours, invoices or appointments.",
  "- 'open': they ask to see / open / go to / show a page ('show my October P&L', 'open invoices', 'go to booking Thursday').",
  "- 'log': they're telling something to record: income or a shift ('made 270 today 9 to 5', 'log 40 in tips'), an expense ('42 on gas at Shell', 'drove 18 miles'), an invoice or quote ('invoice Jenna 120 for a cut', 'quote Marcus 2500 for a deck'), a booking ('book Jenna Thursday at 2', 'move my 3 to 4'), or a new client ('new client Priya Patel, 509 555 0142').",
  "- 'none': anything else, including taxes, settings, sign-up, paying or charging someone, deleting, or anything 521 can't look up.",
  "",
  "topic (questions only):",
  "- income: how much they made / earned / brought in / took home. tips: tips only. hours: hours worked.",
  "- expenses: what they spent (set category when they name one, copied exactly from the category list; 'gas' or 'mileage' = the vehicle category).",
  "- profit: profit / net / what they kept after expenses.",
  "- compare_income: how one period compares to another ('this month vs last month', 'am I doing better than last week'). period = the first, comparePeriod = the other (when they only say 'compared to last month' about this month, period = this_month).",
  "- owed: who owes them, unpaid / outstanding / open invoices, how much they're waiting on.",
  "- overdue: overdue / late invoices.",
  "- appointments: what's on a day ('what's on tomorrow', 'do I have anything Friday', 'my schedule today').",
  "- next_appointment: their next appointment, optionally with one client ('when is Jenna coming in' = client Jenna).",
  "- client_paid: how much one client has paid them (client required).",
  "",
  "period: { kind, month, quarter, year, date } — the time they mean. Leave month/quarter/year/date null unless the kind needs them.",
  "- kinds: today, yesterday, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, all_time,",
  "  month (a named month: month 1–12, year only if they say it), quarter (quarter 1–4, year only if said), year (year), day (date YYYY-MM-DD, worked out from the today date you're given; a weekday alone = the most recent one on or before today for money questions, the next one on or after today for appointments).",
  "- 'in total', 'ever', 'all time', 'altogether', 'so far ever' = all_time.",
  "- No time said: income/tips/hours/expenses/profit = this_month; client_paid = this_year; appointments = today; owed/overdue/next_appointment = null.",
  "- For 'open' with a period ('show my October P&L'), set period too. For booking on a day ('go to booking Thursday'), period kind day with the date.",
  "",
  "page (open only). 'Open' at the start is the verb: 'open invoices' = invoices; 'my open invoices' / 'unpaid invoices' = unpaid. Pages: home, pl (profit and loss / P&L / statement), earnings (earnings / pay / paycheck history), invoices, overdue (overdue invoices), unpaid (open / unpaid invoices), quotes, clients (client list), client (one client's page: set client), booking (calendar / schedule / appointments), receipts, expenses (the expenses list).",
  "",
  "form (log only): entry (income or a shift), expense (spending or miles), invoice, quote, booking (booking or moving an appointment), client (adding a client).",
  "",
  "client: a name they say, copied exactly from the saved clients when it's clearly one of them (a first name alone that matches one saved client = their full saved name; several = the first name as said).",
  "",
  "paymentMethod (income, tips and compare_income questions only): when they ask about money paid one way ('how much did I make on Venmo', 'cash tips this week', 'what came in through Zelle'): cash, card (card / credit card / debit / Square / tap to pay), venmo, apple_cash, zelle, check, cash_app. Otherwise 'none'.",
  "",
  "unsupported (questions only): anything else they narrowed the question by that the fields above can't hold — a payment app not in that list (PayPal), a service ('from haircuts'), a place, a client on an income/tips/expenses/profit question, a payment method on an hours/expenses/profit question. Copy their words for it ('PayPal', 'haircuts'). Otherwise an empty string. Never drop a filter silently.",
  "",
  "hasDetails (log only): true when they said something to fill in (an amount, a name, a time, a vendor, a date). false when they only named what to log ('add an expense', 'log some income', 'new invoice', 'make a quote', 'book an appointment', 'add a client'). For other intents: true.",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const PERIOD_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: [
        "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
        "this_quarter", "last_quarter", "this_year", "last_year", "month", "quarter", "year", "day", "all_time",
      ],
    },
    month: nullable({ type: "integer" }),
    quarter: nullable({ type: "integer" }),
    year: nullable({ type: "integer" }),
    date: nullable({ type: "string" }),
  },
  required: ["kind", "month", "quarter", "year", "date"],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["question", "open", "log", "none"] },
    topic: nullable({
      type: "string",
      enum: ["income", "tips", "hours", "expenses", "profit", "compare_income", "owed", "overdue", "appointments", "next_appointment", "client_paid"],
    }),
    period: nullable(PERIOD_SCHEMA),
    comparePeriod: nullable(PERIOD_SCHEMA),
    category: nullable({ type: "string" }),
    client: nullable({ type: "string" }),
    page: nullable({
      type: "string",
      enum: ["home", "pl", "earnings", "invoices", "overdue", "unpaid", "quotes", "clients", "client", "booking", "receipts", "expenses"],
    }),
    form: nullable({ type: "string", enum: ["entry", "expense", "invoice", "quote", "booking", "client"] }),
    // Plain fields ("none" / "" = not said): the schema allows only 16 nullable ones.
    paymentMethod: { type: "string", enum: ["none", "cash", "card", "venmo", "apple_cash", "zelle", "check", "cash_app"] },
    unsupported: { type: "string" },
    hasDetails: { type: "boolean" },
  },
  required: ["intent", "topic", "period", "comparePeriod", "category", "client", "page", "form", "paymentMethod", "unsupported", "hasDetails"],
  additionalProperties: false,
}

const EMPTY_RESULT: VoiceAskResult = {
  intent: "none",
  topic: null,
  period: null,
  comparePeriod: null,
  category: null,
  client: null,
  page: null,
  form: null,
  paymentMethod: null,
  unsupported: null,
  hasDetails: true,
}

function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
}

function buildUserContent(request: VoiceAskRequest): string {
  return [
    `Today: ${request.today} (${weekdayOf(request.today)})`,
    `Workspace: ${request.workspaceType === "w2" ? "hourly W-2 job (pay, tips and hours)" : "self-employed (income, expenses, invoices, booking, clients)"}`,
    request.clients.length > 0 ? `Saved clients: ${request.clients.join(" | ")}` : "Saved clients: none",
    request.expenseCategories.length > 0 ? `Expense categories: ${request.expenseCategories.join(" | ")}` : "Expense categories: none",
    "",
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

/** A category name exactly as the request spelled it, or null. */
function matchName(name: string | null, names: readonly string[]): string | null {
  if (!name) return null
  const wanted = name.trim().toLowerCase()
  return names.find((item) => item.toLowerCase() === wanted) ?? null
}

export async function parseVoiceAsk(request: VoiceAskRequest): Promise<VoiceAskResult> {
  return parseVoiceAskWith(getVoiceClient(), request, VOICE_THINKING)
}

// The same parse with a given client — the eval script uses this with its own key.
export async function parseVoiceAskWith(
  anthropic: Anthropic,
  request: VoiceAskRequest,
  thinking: VoiceThinking = VOICE_THINKING
): Promise<VoiceAskResult> {
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: VOICE_MODEL,
      max_tokens: 1024,
      ...(thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(request) }],
    })
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("voiceAsk: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceAsk: request failed", error)
    }
    throw new Error("voiceAsk: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceAsk: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceAsk: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceAsk: reply wasn't JSON")
    return EMPTY_RESULT
  }
  // A period that isn't one: leave it for the app's default.
  for (const key of ["period", "comparePeriod"]) {
    const period = raw[key] as Record<string, unknown> | null
    if (!period || typeof period !== "object") continue
    if (typeof period.month === "number" && (period.month < 1 || period.month > 12)) period.month = null
    if (typeof period.quarter === "number" && (period.quarter < 1 || period.quarter > 4)) period.quarter = null
    if (typeof period.year === "number" && (period.year < 2000 || period.year > 2100)) period.year = null
    if (typeof period.date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(period.date)) period.date = null
  }
  if (raw.paymentMethod === "none") raw.paymentMethod = null
  for (const key of ["category", "client", "unsupported"]) {
    if (typeof raw[key] === "string" && !(raw[key] as string).trim()) raw[key] = null
  }
  const parsed = VoiceAskResultSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("voiceAsk: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }
  const result = parsed.data
  // Only what each intent uses: a "log" is just which form (it reads the words itself).
  if (result.intent === "log") return { ...EMPTY_RESULT, intent: "log", form: result.form, hasDetails: result.hasDetails }
  if (result.intent === "none") return EMPTY_RESULT
  return {
    ...result,
    category: matchName(result.category, request.expenseCategories),
    topic: result.intent === "question" ? result.topic : null,
    page: result.intent === "open" ? result.page : null,
    form: null,
    paymentMethod: result.intent === "question" ? result.paymentMethod : null,
    unsupported: result.intent === "question" ? result.unsupported : null,
    hasDetails: true,
  }
}
