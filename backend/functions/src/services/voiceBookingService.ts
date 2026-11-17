import Anthropic from "@anthropic-ai/sdk"
import { VoiceBookingResultSchema, type VoiceBookingRequest, type VoiceBookingResult } from "@shared/voiceBooking"
import { getVoiceClient, VOICE_MODEL, VOICE_THINKING, type VoiceThinking, askedLines } from "./voiceEntryService"

// Turns a spoken booking ("book Jenna Thursday at 2 for a cut") or move
// ("move my 3 to 4") into fields. Only the typed-out words and the person's
// saved client and service names reach this server — never their
// appointments. Nothing is booked or moved here: the app fills the form
// (or Change time) and the person taps Book or Move it.
//
// Times come back as said; the app picks AM or PM from the booking hours.

const SYSTEM_PROMPT = [
  "You turn what a person said out loud into fields for booking or moving an appointment in 521, an app for self-employed service workers (hair stylists, cleaners, trainers, photographers and the like).",
  "Say only what they said. Leave a field null when they didn't say it. Never invent clients, services, prices, days or times, and never do math on prices.",
  "",
  "action:",
  "- 'book': making a new appointment ('book Jenna Thursday at 2', 'Jenna for a cut tomorrow at 10', 'put Marcus down for Friday at 9').",
  "- 'move': changing the time of one already booked ('move my 3 to 4', 'move Jenna to Friday at 10', 'push Marcus to Wednesday', 'reschedule Jenna to next Tuesday'). Something relative like 'an hour later' can't be worked out: give fromClient and leave date and time null.",
  "- 'none': anything else. When the form is the New appointment form, it's always 'book' (or 'none').",
  "",
  "Booking fields:",
  "- clientName: who it's for, as they said it ('Jenna Morales', or just 'Jenna'). A first name alone stays just the first name: the app matches it to saved clients and asks if several fit. When a full name sounds like a saved client's (spelled a little differently), copy the saved spelling. Capitalize names.",
  "- clientEmail: only an email they say ('jenna at gmail dot com' = 'jenna@gmail.com'). clientPhone: only a phone number they say, digits as said.",
  "- serviceName: the service, copied exactly from the saved services when only one fits ('a cut' = 'Haircut' when that's the only cut). When the words fit two or more saved services ('color' with both 'Root color' and 'Full color' saved), give just the words they used ('Color') — the app asks which; never pick one. When none fits, the words they used ('Kids trim'), capitalized.",
  "- price: only a price they say for this appointment ('50 this time'). minutes: only a length they say ('90 minutes' = 90, 'an hour and a half' = 90, 'two hours' = 120).",
  "- location: only an address or place they say for this appointment ('at her house on 5th Street').",
  "- confirmNow: true for 'already confirmed', 'it's confirmed', 'book it now', 'no need to confirm'; false for 'ask her to confirm'; otherwise null.",
  "",
  "Days and times (both actions):",
  "- date: YYYY-MM-DD from the today date you're given. 'today', 'tomorrow', 'the 24th' (this month, or next month if that's passed), 'next Monday'. A weekday alone means the next one after today ('Thursday' on a Thursday = a week later).",
  "- time: { hour, minute, meridiem }. hour as said, 1–12 ('2' = 2, 'two thirty' = 2 and 30, 'quarter to 4' = 3 and 45, 'noon' = 12 pm). meridiem 'am' or 'pm' only when they say it, or say morning ('am'), afternoon / evening / tonight ('pm'); otherwise null — the app decides. A 24-hour time ('14:00') = hour 14.",
  "- Speech-to-text can write '2:30' as '230' or '2 30': read those as 2 and 30.",
  "",
  "Moving fields:",
  "- fromDate / fromTime / fromClient: which appointment, from their words ('my 3' = fromTime 3:00; 'Thursday's 3' = fromDate Thursday, fromTime 3:00; 'Jenna' or 'Jenna's appointment' = fromClient 'Jenna'). 'Today's' = today's date.",
  "- date / time: where it moves to (the words after 'to'). Always fill date when a day comes after 'to' ('to Wednesday' = date Wednesday; 'to next Tuesday at 1' = date next Tuesday, time 1). 'to 4' = time 4:00 (date null: same day). 'to Friday' = date Friday (time null: same time). 'to Friday at 10' = both. 'move Olivia's appointment tomorrow to 2 pm' = fromClient Olivia, fromDate tomorrow, time 2 pm (date null).",
  "- Leave the booking fields (client, service, price, minutes, location, confirmNow) null when moving.",
  "",
  "Fixing: when you're given 'Already on the form', the person is correcting a new appointment. Return only what the new words change; everything else null. action 'book'.",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const TIME_SCHEMA = {
  type: "object",
  properties: {
    hour: { type: "integer" },
    minute: { type: "integer" },
    meridiem: nullable({ type: "string", enum: ["am", "pm"] }),
  },
  required: ["hour", "minute", "meridiem"],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["book", "move", "none"] },
    clientName: nullable({ type: "string" }),
    clientEmail: nullable({ type: "string" }),
    clientPhone: nullable({ type: "string" }),
    serviceName: nullable({ type: "string" }),
    price: nullable({ type: "number" }),
    minutes: nullable({ type: "integer" }),
    date: nullable({ type: "string" }),
    time: nullable(TIME_SCHEMA),
    location: nullable({ type: "string" }),
    confirmNow: nullable({ type: "boolean" }),
    fromDate: nullable({ type: "string" }),
    fromTime: nullable(TIME_SCHEMA),
    fromClient: nullable({ type: "string" }),
  },
  required: [
    "action", "clientName", "clientEmail", "clientPhone", "serviceName", "price", "minutes",
    "date", "time", "location", "confirmNow", "fromDate", "fromTime", "fromClient",
  ],
  additionalProperties: false,
}

const EMPTY_RESULT: VoiceBookingResult = {
  action: "none",
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  serviceName: null,
  price: null,
  minutes: null,
  date: null,
  time: null,
  location: null,
  confirmNow: null,
  fromDate: null,
  fromTime: null,
  fromClient: null,
}

function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
}

function buildUserContent(request: VoiceBookingRequest): string {
  const current = request.current
  return [
    request.mode === "book"
      ? "Form: New appointment (they're booking a new one)"
      : "Where: the Booking page (they may book a new appointment or move one)",
    `Today: ${request.today} (${weekdayOf(request.today)})`,
    request.clients.length > 0 ? `Saved clients: ${request.clients.join(" | ")}` : "Saved clients: none yet",
    request.services.length > 0 ? `Saved services: ${request.services.join(" | ")}` : "Saved services: none",
    ...(current
      ? [
          "",
          "Already on the form (they're fixing it):",
          `- client: ${current.clientName ?? "none"}; email: ${current.clientEmail ?? "none"}; phone: ${current.clientPhone ?? "none"}`,
          `- service: ${current.serviceName ?? "none"}; price: ${current.price ?? "none"}; length: ${current.minutes} min`,
          `- date: ${current.date ?? "none"}; start: ${current.startTime ?? "none"} (24-hour); location: ${current.location ?? "usual"}`,
        ]
      : []),
    "",
    ...askedLines(request.asking),
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

/** "Monday" said on a Monday means next Monday, not today (unless they
 * also said today or tonight). */
export function weekdayMeansNextWeek(request: Pick<VoiceBookingRequest, "today" | "transcript">, date: string | null): string | null {
  if (date !== request.today) return date
  const weekday = weekdayOf(request.today).toLowerCase()
  const words = request.transcript.toLowerCase()
  if (!new RegExp(`\\b${weekday}\\b`).test(words) || /\b(today|tonight|this morning|this afternoon|this evening)\b/.test(words)) return date
  const [y, m, d] = request.today.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Words that say morning or afternoon out loud.
const SAID_MERIDIEM = /\d\s*[ap]\.?\s?m\b|\b(?:morning|afternoon|evening|tonight|night|noon|midnight)\b/i

export async function parseVoiceBooking(request: VoiceBookingRequest): Promise<VoiceBookingResult> {
  return parseVoiceBookingWith(getVoiceClient(), request, VOICE_THINKING)
}

// The same parse with a given client — the eval script uses this with its own key.
export async function parseVoiceBookingWith(
  anthropic: Anthropic,
  request: VoiceBookingRequest,
  thinking: VoiceThinking = VOICE_THINKING
): Promise<VoiceBookingResult> {
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
      console.error("voiceBooking: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceBooking: request failed", error)
    }
    throw new Error("voiceBooking: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceBooking: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceBooking: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceBooking: reply wasn't JSON")
    return EMPTY_RESULT
  }
  for (const key of ["price", "minutes"]) {
    if (typeof raw[key] === "number" && (raw[key] as number) <= 0) raw[key] = null
  }
  for (const key of ["clientName", "clientEmail", "clientPhone", "serviceName", "location", "fromClient"]) {
    if (typeof raw[key] === "string" && !(raw[key] as string).trim()) raw[key] = null
  }
  // A time that isn't a real clock time is a mishearing: leave it for the person.
  for (const key of ["time", "fromTime"]) {
    const time = raw[key] as { hour?: unknown; minute?: unknown } | null
    if (time && (typeof time.hour !== "number" || time.hour < 0 || time.hour > 23 || typeof time.minute !== "number" || time.minute < 0 || time.minute > 59)) {
      raw[key] = null
    }
  }
  // AM/PM only counts when it was said: otherwise the app picks it from the
  // booking hours ("8" on a Saturday-evening shift means 8 PM).
  if (!SAID_MERIDIEM.test(request.transcript)) {
    for (const key of ["time", "fromTime"]) {
      const time = raw[key] as { meridiem?: unknown } | null
      if (time && typeof time === "object") time.meridiem = null
    }
  }
  const parsed = VoiceBookingResultSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("voiceBooking: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }
  const result = parsed.data
  const clientEmail =
    result.clientEmail && EMAIL.test(result.clientEmail.replace(/\s+/g, "")) ? result.clientEmail.replace(/\s+/g, "").toLowerCase() : null
  // The New appointment form only books.
  const action = request.mode === "book" && result.action === "move" ? "book" : result.action
  return { ...result, action, clientEmail, date: action === "book" ? weekdayMeansNextWeek(request, result.date) : result.date }
}
