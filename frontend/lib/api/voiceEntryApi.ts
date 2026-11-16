import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { apiFetch } from "@/lib/api/core/client"
import { wakeServer } from "@/lib/api/core/wake"
import type { VoiceEntryRequest, VoiceEntryResult } from "@shared/voiceEntry"

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
