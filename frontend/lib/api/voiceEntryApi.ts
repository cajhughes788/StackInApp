import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"
import { wakeServer } from "@/lib/api/core/wake"
import type { VoiceEntryRequest, VoiceEntryResult } from "@shared/voiceEntry"
import type { VoiceExpenseRequest, VoiceExpenseResult } from "@shared/voiceExpense"
import type { VoiceInvoiceRequest, VoiceInvoiceResult } from "@shared/voiceInvoice"
import type { VoiceBookingRequest, VoiceBookingResult } from "@shared/voiceBooking"
import type { VoiceClientRequest, VoiceClientResult } from "@shared/voiceClient"
import type { VoiceAskRequest, VoiceAskResult } from "@shared/voiceAsk"

// Sends only the typed-out words (never the recording) and gets back fields
// to fill the Add entry form. Nothing is saved by this call.
export async function parseVoiceEntry(request: VoiceEntryRequest): Promise<VoiceEntryResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceEntryResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}

// Called when the mic opens, so the server is up by the time the person stops talking.
export function wakeVoiceEntry(): void {
  wakeServer(API_ENDPOINTS.voiceEntry.parse)
}

// The same for the Add expense form (shared/voiceExpense.ts): same server,
// same daily voice limit. Nothing is saved by this call.
export async function parseVoiceExpense(request: VoiceExpenseRequest): Promise<VoiceExpenseResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceExpenseResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}

// The same for the invoice/quote form (shared/voiceInvoice.ts): same server,
// same daily voice limit. Nothing is saved or sent by this call.
export async function parseVoiceInvoice(request: VoiceInvoiceRequest): Promise<VoiceInvoiceResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceInvoiceResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}

// The same for booking (shared/voiceBooking.ts): a new appointment, or which
// one to move and where. Same server, same daily voice limit. Nothing is
// booked or moved by this call; appointments never leave the phone.
export async function parseVoiceBooking(request: VoiceBookingRequest): Promise<VoiceBookingResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceBookingResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}

// The same for a new client or a client note (shared/voiceClient.ts). Same
// server, same daily voice limit. Nothing is saved; the client list stays on the phone.
export async function parseVoiceClient(request: VoiceClientRequest): Promise<VoiceClientResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceClientResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}

// Ask 521 on Home (shared/voiceAsk.ts): only what was asked for comes back;
// the app works out every answer from its own data.
export async function parseVoiceAsk(request: VoiceAskRequest): Promise<VoiceAskResult> {
  const response = await apiFetch<{ ok: boolean; result: VoiceAskResult }>(API_ENDPOINTS.voiceEntry.parse, {
    method: "POST",
    body: JSON.stringify(request),
    timeout: 20000,
  })
  return response.result
}
