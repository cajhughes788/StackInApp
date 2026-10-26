import type { TaxEstimateResponse } from "@shared/estimatedTax/response"
import type {
  TaxEstimateProfile,
  TaxEstimateProfilePatch,
  TaxPayment,
  TaxPaymentInput,
} from "@shared/schemas/taxEstimateProfile"

import { apiFetch, tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function getTaxEstimate(): Promise<TaxEstimateResponse> {
  const data = await apiFetch<{ estimate: TaxEstimateResponse }>(API_ENDPOINTS.taxEstimate.get, { method: "GET" })
  return data.estimate
}

export async function saveTaxEstimateProfile(patch: TaxEstimateProfilePatch): Promise<TaxEstimateProfile> {
  const data = await tryWrite<{ profile: TaxEstimateProfile }>(API_ENDPOINTS.taxEstimate.saveProfile, "POST", patch)
  return data.profile
}

export async function saveTaxPayment(input: TaxPaymentInput): Promise<TaxPayment> {
  const data = await tryWrite<{ payment: TaxPayment }>(API_ENDPOINTS.taxEstimate.savePayment, "POST", input)
  return data.payment
}

export async function deleteTaxPayment(id: string): Promise<void> {
  await tryWrite(API_ENDPOINTS.taxEstimate.deletePayment, "POST", { id })
}
