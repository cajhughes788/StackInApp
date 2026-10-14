import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "crypto"
import { db } from "../admin"
import { EXPENSE_CATEGORY_GUIDE } from "@shared/expenseCategories"
import { ANTHROPIC_API_KEY } from "../secrets"

// Last-resort category guess for a bank charge nothing else could place —
// no merchant memory, no mappable Plaid category, no keyword hit (see
// upsertPendingTransactionFromPlaid). Answers are cached per merchant
// across all workspaces in aiMerchantCategories, so each merchant is
// classified once, ever, rather than once per user.
//
// Only Plaid's enriched merchant name (a business, e.g. "Sally Beauty") is
// ever sent — never the raw bank descriptor, amounts, dates, or anything
// tied to a user or workspace. The caller enforces this (and skips
// payment-app transfers, whose names are people).

const MODEL = "claude-opus-5-5"
// Bump when the prompt or category list changes meaningfully, so cached
// answers from the old prompt are re-asked instead of reused.
const PROMPT_VERSION = 1
// Bounds the time and spend a single sync can add — a first sync of a
// newly linked account can surface well over a hundred new merchants.
// Merchants past the cap stay unsuggested this time and are tried again
// the next time one of their charges comes in.
const MAX_LOOKUPS_PER_RUN = 30
const CONCURRENCY = 5
const NO_CATEGORY = "none"

const CATEGORIES = EXPENSE_CATEGORY_GUIDE.map((entry) => entry.category)

const SYSTEM_PROMPT = [
  "You categorize business expenses for 521, a bookkeeping app for self-employed service workers (hair stylists, barbers, nail techs, estheticians, massage therapists, tattoo artists and similar).",
  "You'll get the name of a merchant from a bank transaction, plus the bank's own category when it has one. Pick the expense category a self-employed service worker would most likely book a charge from this merchant under, assuming the charge is a business expense.",
  `Answer "${NO_CATEGORY}" when you don't recognize the merchant well enough to say what it sells, or when it's almost always a personal purchase with no business use (groceries, restaurants, streaming entertainment, personal shopping) — a wrong guess costs the user more than a blank one.`,
  "",
  "Categories:",
  ...EXPENSE_CATEGORY_GUIDE.map(
    (entry) => `- ${entry.category}: ${entry.simpleDefinition} Examples: ${entry.examples.join("; ")}.`
  ),
].join("\n")

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES, NO_CATEGORY] },
  },
  required: ["category"],
  additionalProperties: false,
}

export type AiCategoryRequest = {
  merchantKey: string
  merchantName: string
  personalFinanceCategoryPrimary: string | null
  personalFinanceCategoryDetailed: string | null
}

type CachedAnswer = {
  merchantKey: string
  merchantName: string
  category: string | null
  model: string
  promptVersion: number
  createdAt: string
}

function cacheRef(merchantKey: string) {
  const id = createHash("sha256").update(merchantKey).digest("hex")
  return db.collection("aiMerchantCategories").doc(id)
}

let client: Anthropic | null = null
function getClient(): Anthropic | null {
  if (client) return client
  // An unset secret reads as empty — treat that as "feature off" rather
  // than failing the sync it runs inside.
  const apiKey = ANTHROPIC_API_KEY.value()
  if (!apiKey) return null
  client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 })
  return client
}

/**
 * Category suggestions keyed by merchantKey. A merchant missing from the
 * result has no suggestion (unrecognized, personal, capped, or the call
 * failed). Never throws — the caller is a bank sync that must not fail
 * over a missing guess.
 */
export async function suggestCategoriesWithAi(requests: AiCategoryRequest[]): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const unique = new Map<string, AiCategoryRequest>()
  for (const request of requests) {
    if (request.merchantKey && !unique.has(request.merchantKey)) unique.set(request.merchantKey, request)
  }
  if (unique.size === 0) return results

  const uncached: AiCategoryRequest[] = []
  try {
    const pending = [...unique.values()]
    // getAll returns snapshots in the order the refs were passed.
    const snaps = await db.getAll(...pending.map((request) => cacheRef(request.merchantKey)))
    snaps.forEach((snap, index) => {
      const request = pending[index]
      const cached = snap.exists ? (snap.data() as CachedAnswer) : null
      if (!cached || cached.promptVersion !== PROMPT_VERSION) {
        uncached.push(request)
      } else if (cached.category) {
        results.set(request.merchantKey, cached.category)
      }
    })
  } catch (error) {
    console.error("aiCategorySuggestion: cache read failed", error)
    return results
  }

  const anthropic = uncached.length > 0 ? getClient() : null
  if (!anthropic) return results

  const queue = uncached.slice(0, MAX_LOOKUPS_PER_RUN)
  if (uncached.length > queue.length) {
    console.info("aiCategorySuggestion: lookup cap reached", { requested: uncached.length, cap: MAX_LOOKUPS_PER_RUN })
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let request = queue.shift(); request; request = queue.shift()) {
      const category = await classifyMerchant(anthropic, request)
      if (category === undefined) continue
      if (category) results.set(request.merchantKey, category)
      const answer: CachedAnswer = {
        merchantKey: request.merchantKey,
        merchantName: request.merchantName,
        category,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        createdAt: new Date().toISOString(),
      }
      await cacheRef(request.merchantKey).set(answer).catch((error) => {
        console.error("aiCategorySuggestion: cache write failed", error)
      })
    }
  })
  await Promise.all(workers)
  return results
}

// A category, null for a definite "no category" (cached so it isn't asked
// again), or undefined when there's no usable answer this time (not cached,
// so a later charge from the merchant retries).
async function classifyMerchant(anthropic: Anthropic, request: AiCategoryRequest): Promise<string | null | undefined> {
  const plaidCategory = request.personalFinanceCategoryDetailed ?? request.personalFinanceCategoryPrimary
  const userContent = [
    `Merchant: ${request.merchantName}`,
    plaidCategory ? `Bank category: ${plaidCategory}` : "Bank category: none",
  ].join("\n")

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    })
    if (response.stop_reason === "refusal") return null
    if (response.stop_reason !== "end_turn") {
      console.warn("aiCategorySuggestion: unexpected stop reason", { stopReason: response.stop_reason })
      return undefined
    }
    const text = response.content.find((block) => block.type === "text")
    if (!text || text.type !== "text") return undefined
    const parsed = JSON.parse(text.text) as { category?: unknown }
    if (typeof parsed.category !== "string") return undefined
    if (parsed.category === NO_CATEGORY) return null
    return CATEGORIES.includes(parsed.category) ? parsed.category : undefined
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      console.warn("aiCategorySuggestion: rate limited", { merchantKey: request.merchantKey })
    } else if (error instanceof Anthropic.APIError) {
      console.error("aiCategorySuggestion: API error", { status: error.status, message: error.message })
    } else {
      console.error("aiCategorySuggestion: classification failed", error)
    }
    return undefined
  }
}
