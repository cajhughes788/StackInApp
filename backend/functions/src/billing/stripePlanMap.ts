import type { SubscriptionTier } from "@shared/contracts/subscription"

export const STRIPE_PRICE_IDS: Record<SubscriptionTier, string> = {
  w2_basic: "price_1TSKYRFVyV2bNsbdeUKMqpM8",
  independent_basic: "price_1TSKa5FVyV2bNsbddxJfd4Ty",
  hybrid_plus: "price_1TSKUuFVyV2bNsbdby2ymNAu",
}

const LEGACY_STRIPE_PRICE_IDS: Record<SubscriptionTier, string[]> = {
  w2_basic: ["price_1TEaSbFVyV2bNsbdIOlWsONM"],
  independent_basic: ["price_1TEaSwFVyV2bNsbdOPanb758"],
  hybrid_plus: ["price_1TF3MuFVyV2bNsbdib4wiIB5"],
}

const PRICE_ID_TO_TIER = Object.fromEntries(
  Object.entries(STRIPE_PRICE_IDS).flatMap(([tier, priceId]) => {
    const legacyPriceIds = LEGACY_STRIPE_PRICE_IDS[tier as SubscriptionTier] ?? []
    return [[priceId, tier], ...legacyPriceIds.map((legacyPriceId) => [legacyPriceId, tier])]
  })
) as Record<string, SubscriptionTier>

export function getStripePriceIdForTier(tier: SubscriptionTier): string {
  return STRIPE_PRICE_IDS[tier]
}

export function getTierFromStripePriceId(
  priceId: string
): SubscriptionTier | null {
  return PRICE_ID_TO_TIER[priceId] ?? null
}
