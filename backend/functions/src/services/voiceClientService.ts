import Anthropic from "@anthropic-ai/sdk"
import { tidyPhone, VoiceClientResultSchema, type VoiceClientRequest, type VoiceClientResult } from "@shared/voiceClient"
import { getVoiceClient, VOICE_MODEL, VOICE_THINKING, type VoiceThinking, askedLines } from "./voiceEntryService"

// Turns a spoken new client ("new client Jenna Morales, 509 555 0142, jenna
// at gmail dot com") or a spoken note for a client's page into fields. Only
// the typed-out words reach this server — not the client list. Nothing is
// saved here: the app fills the form (or the notes box) and the person taps
// Add client or Save notes.

const ADD_PROMPT = [
  "You turn what a person said out loud into the Add client form of 521, a bookkeeping app for self-employed service workers (hair stylists, cleaners, trainers, photographers and the like).",
  "Say only what they said. Leave a field null when they didn't say it. Never invent names, numbers, emails or addresses.",
  "",
  "Rules:",
  "- name: the client's name, capitalized ('Jenna Morales', 'Bright Smiles Dental'). Not 'new client' or 'add'. When they spell it ('Morales, M-O-R-A-L-E-S'), use the spelling. If they name more than one person ('Jenna and her sister Mia Lopez'), name is the first; the others go in others.",
  "- phone: the digits as said ('509 555 0142' = '509 555 0142'; 'five oh nine...' = '509...').",
  "- email: written out as an address, lowercase. 'jenna at gmail dot com' = 'jenna@gmail.com'; 'jenna dot m at yahoo dot com' = 'jenna.m@yahoo.com'; spelled letters are joined ('j e n n a at gmail' = 'jenna@gmail.com'); 'underscore' = '_', 'dash' = '-'. If you can't make a real address of it, give your best try and set emailUnclear true.",
  "- address: a street address or place they say for where the client is ('she lives at 12 Oak Street, Spokane' = '12 Oak Street, Spokane').",
  "- notes: anything else they say about the client, as a short note in their words, written for the person's own records ('Allergic to ammonia. Prefers Tuesdays. Referred by Marcus.'). Not the name, phone, email or address again.",
  "- others: only other people they asked to add as clients too ('add Jenna and her sister Mia'). People merely mentioned about this client (an office manager, who referred them, a spouse) go in notes, not others.",
  "- isClient: false when the words aren't about adding a client at all.",
  "",
  "Fixing: when you're given 'Already on the form', the person is correcting that form. Return only what the new words change; everything else null; isClient true. 'Her last name is spelled M-O-R-A-L-E-S' changes name (keep the first name). 'Remove the email' = remove ['email']. 'Add a note: prefers mornings' = notes with only the new words (the app adds them to what's there).",
].join("\n")

const NOTE_PROMPT = [
  "You turn what a person said out loud into a note for one client's page in 521, a bookkeeping app for self-employed service workers.",
  "notes: what they said, cleaned into a short note for their own records, keeping every detail (colors, formulas, products, times, names) exactly ('She wants to go lighter next time. Used 7N with 20 volume.'). Drop filler like 'add a note that' or 'um'. Never add anything they didn't say.",
  "isClient: true when there's a note; false when the words have nothing to note. Leave every other field null (others and remove empty).",
].join("\n")

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] })

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isClient: { type: "boolean" },
    name: nullable({ type: "string" }),
    phone: nullable({ type: "string" }),
    email: nullable({ type: "string" }),
    emailUnclear: { type: "boolean" },
    address: nullable({ type: "string" }),
    notes: nullable({ type: "string" }),
    remove: { type: "array", items: { type: "string", enum: ["phone", "email", "address", "notes"] } },
    others: { type: "array", items: { type: "string" } },
  },
  required: ["isClient", "name", "phone", "email", "emailUnclear", "address", "notes", "remove", "others"],
  additionalProperties: false,
}

const EMPTY_RESULT: VoiceClientResult = {
  isClient: false,
  name: null,
  phone: null,
  email: null,
  emailUnclear: false,
  address: null,
  notes: null,
  remove: [],
  others: [],
}

function buildUserContent(request: VoiceClientRequest): string {
  const current = request.current
  return [
    ...(current
      ? [
          "Already on the form (they're fixing it):",
          `- name: ${current.name ?? "none"}; phone: ${current.phone ?? "none"}; email: ${current.email ?? "none"}`,
          `- address: ${current.address ?? "none"}`,
          `- notes: ${current.notes ?? "none"}`,
          "",
        ]
      : []),
    ...askedLines(request.asking),
    "What they said:",
    `"""${request.transcript}"""`,
  ].join("\n")
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function parseVoiceClient(request: VoiceClientRequest): Promise<VoiceClientResult> {
  return parseVoiceClientWith(getVoiceClient(), request, VOICE_THINKING)
}

// The same parse with a given client — the eval script uses this with its own key.
export async function parseVoiceClientWith(
  anthropic: Anthropic,
  request: VoiceClientRequest,
  thinking: VoiceThinking = VOICE_THINKING
): Promise<VoiceClientResult> {
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: VOICE_MODEL,
      max_tokens: 2048,
      ...(thinking === "off" ? { thinking: { type: "disabled" as const } } : {}),
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: request.mode === "note" ? NOTE_PROMPT : ADD_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(request) }],
    })
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("voiceClient: API error", { status: error.status, message: error.message })
    } else {
      console.error("voiceClient: request failed", error)
    }
    throw new Error("voiceClient: no usable reply")
  }

  if (response.stop_reason === "refusal") return EMPTY_RESULT
  if (response.stop_reason !== "end_turn") {
    console.warn("voiceClient: unexpected stop reason", { stopReason: response.stop_reason })
    throw new Error("voiceClient: no usable reply")
  }
  const text = response.content.find((block) => block.type === "text")
  if (!text || text.type !== "text") return EMPTY_RESULT

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.text)
  } catch {
    console.warn("voiceClient: reply wasn't JSON")
    return EMPTY_RESULT
  }
  for (const key of ["name", "phone", "email", "address", "notes"]) {
    if (typeof raw[key] === "string" && !(raw[key] as string).trim()) raw[key] = null
  }
  if (Array.isArray(raw.others)) raw.others = (raw.others as unknown[]).filter((name) => typeof name === "string" && name.trim()).slice(0, 5)
  const parsed = VoiceClientResultSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("voiceClient: reply didn't match", parsed.error.flatten())
    return EMPTY_RESULT
  }
  const result = parsed.data
  if (request.mode === "note") {
    return { ...EMPTY_RESULT, isClient: result.isClient && !!result.notes, notes: result.notes }
  }
  // Only a real-looking email goes in the box; a garbled one is flagged instead.
  const email = result.email ? result.email.replace(/\s+/g, "").toLowerCase() : null
  const emailOk = !!email && EMAIL.test(email)
  return {
    ...result,
    phone: tidyPhone(result.phone),
    email: emailOk ? email : null,
    // Flagged only when it didn't come out as a real address; a good one is in the box to check.
    emailUnclear: (!!email && !emailOk) || (!email && result.emailUnclear),
  }
}
