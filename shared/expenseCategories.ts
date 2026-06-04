import type { WorkspaceType } from "./contracts/workspace"
import type { IndependentSettingsType } from "./schemas/settings"
import {
  VEHICLE_EXPENSE_CATEGORY_KEY,
  VEHICLE_EXPENSE_CATEGORY_LABEL,
  isVehicleExpenseTrackingEnabled,
} from "./vehicleExpenses"

export type CpaExpenseCategory =
  | "Advertising"
  | "Car and truck expenses"
  | "Commissions and fees"
  | "Insurance"
  | "Legal and professional services"
  | "Office expense"
  | "Rent or lease - other business property"
  | "Supplies"
  | "Taxes and licenses"
  | "Travel"
  | "Utilities"
  | "Other expenses"
  | "Equipment / depreciation review"

export type ExpenseCategoryGuideEntry = {
  category: string
  simpleDefinition: string
  includes: string
  examples: string[]
  ruleOfThumb: string
  shortSummary: string
  cpaCategory: CpaExpenseCategory
}

export type ExpenseCategoryVisibilityContext = {
  workspaceType?: WorkspaceType | null
  independentSettings?: Partial<IndependentSettingsType> | null
}

export type ExpenseCategoryRuntimeConfig = {
  key: string
  isVisible?: (context?: ExpenseCategoryVisibilityContext) => boolean
}

const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  "travel & transportation": "Vehicle & Transportation",
}

export const EXPENSE_CATEGORY_GUIDE: ExpenseCategoryGuideEntry[] = [
  {
    category: "Supplies",
    simpleDefinition:
      "Everyday items you regularly use up while serving clients or doing your work.",
    includes:
      "Disposable and refillable working materials that get used during services or client prep.",
    examples: [
      "Hair color, developer, bleach, foils, gloves",
      "Massage oils, creams, sheets, face cradle covers",
      "Nail files, buffers, polish, acetone, tips",
      "Tattoo ink caps, razors, grip wrap, stencil paper",
    ],
    ruleOfThumb:
      "If it gets consumed, replaced often, or is part of delivering the service itself, start with Supplies.",
    shortSummary:
      "Use for everyday service materials and consumables you go through while working with clients.",
    cpaCategory: "Supplies",
  },
  {
    category: "Rent / Booth Rent",
    simpleDefinition:
      "What you pay for the space where you run your business.",
    includes:
      "Booth rental, studio rent, suite rent, treatment room rent, chair rent, and space-related lease payments.",
    examples: [
      "Weekly salon booth rent",
      "Monthly massage room rental",
      "Private studio suite payment",
      "Shared tattoo station rent",
    ],
    ruleOfThumb:
      "If the payment is mainly for access to your physical workspace, it belongs here.",
    shortSummary:
      "Use for booth rent, studio rent, suite rent, and other payments for your working space.",
    cpaCategory: "Rent or lease - other business property",
  },
  {
    category: "Equipment",
    simpleDefinition:
      "Tools, machines, and durable items you expect to use repeatedly over time.",
    includes:
      "Larger or longer-lasting business tools and gear used to perform services or run operations.",
    examples: [
      "Hair dryer, shears, clippers, salon chair",
      "Massage table, hot towel cabinet, table warmer",
      "UV lamp, nail drill, pedicure chair",
      "Tattoo machine, power supply, ring light",
    ],
    ruleOfThumb:
      "If it is a reusable work tool you are not quickly using up, it usually fits Equipment.",
    shortSummary:
      "Use for reusable tools, machines, and durable gear that support your work long term.",
    cpaCategory: "Equipment / depreciation review",
  },
  {
    category: "Marketing & Advertising",
    simpleDefinition:
      "Money spent to attract new clients or stay visible to existing ones.",
    includes:
      "Promotions, ads, branding, content creation, and paid visibility for your business.",
    examples: [
      "Instagram or Facebook ads",
      "Business cards and flyers",
      "Website promo campaigns",
      "Branded photo shoot for your service menu",
    ],
    ruleOfThumb:
      "If the goal is getting noticed, booked, or remembered by clients, use Marketing & Advertising.",
    shortSummary:
      "Use for ads, promos, branding, and other spending meant to bring in or retain clients.",
    cpaCategory: "Advertising",
  },
  {
    category: "Software & Subscriptions",
    simpleDefinition:
      "Recurring digital tools and apps that help you run your business.",
    includes:
      "Booking software, client management tools, website subscriptions, design apps, music services used for the business, and productivity subscriptions.",
    examples: [
      "GlossGenius, Square, Vagaro, Fresha",
      "QuickBooks or bookkeeping software",
      "Canva Pro or Adobe subscription",
      "Website hosting or online booking add-ons",
    ],
    ruleOfThumb:
      "If you pay monthly or yearly for a digital service that helps operate the business, it likely goes here.",
    shortSummary:
      "Use for recurring apps, software, and digital subscriptions you use to operate the business.",
    cpaCategory: "Other expenses",
  },
  {
    category: "Insurance",
    simpleDefinition:
      "Business-related coverage that protects you, your work, or your equipment.",
    includes:
      "Liability, malpractice, equipment, renters, and business insurance premiums tied to the work.",
    examples: [
      "Professional liability insurance",
      "General business insurance policy",
      "Equipment coverage rider",
      "Massage malpractice insurance",
    ],
    ruleOfThumb:
      "If the payment is for coverage or protection against business risk, use Insurance.",
    shortSummary:
      "Use for business insurance premiums and coverage that protects your services, tools, or liability.",
    cpaCategory: "Insurance",
  },
  {
    category: "Interest on Loan",
    simpleDefinition:
      "The extra cost you pay when you borrow money for your business.",
    includes:
      "Interest charges on business loans, equipment financing, business credit cards, payment plans, and other borrowing costs tied to the business.",
    examples: [
      "Interest charged on a business credit card used for supplies",
      "Interest portion of an equipment financing payment for a massage table",
      "Financing charge on a salon chair or tattoo machine bought on a payment plan",
      "Interest on a loan used to cover business startup or operating costs",
    ],
    ruleOfThumb:
      "Put only the interest or finance charge here, not the part of the payment that pays back what you borrowed.",
    shortSummary:
      "Use for interest and finance charges tied to business borrowing, loans, credit cards, and payment plans.",
    cpaCategory: "Other expenses",
  },
  {
    category: "Travel",
    simpleDefinition:
      "Business trips or travel away from your normal work area for work-related reasons.",
    includes:
      "Airfare, hotels, work travel meals where appropriate, conference travel, and out-of-town or overnight business trips.",
    examples: [
      "Hotel for a beauty convention",
      "Flight to an advanced training course",
      "Train ticket to an out-of-town client event",
      "Work trip lodging for a pop-up or guest spot",
    ],
    ruleOfThumb:
      "Use Travel when the expense is tied to a business trip, event, or overnight work-related travel rather than day-to-day driving.",
    shortSummary:
      "Use for work trips, hotels, airfare, and similar business travel away from your normal local routine.",
    cpaCategory: "Travel",
  },
  {
    category: "Vehicle & Transportation",
    simpleDefinition:
      "Local transportation costs tied to getting yourself or your materials where the work happens.",
    includes:
      "Business mileage, parking, tolls, rideshare, fuel tied to business driving, and local transportation for appointments or errands. It does not include your normal commute from home to your regular salon, studio, booth, or main workspace.",
    examples: [
      "Driving to a mobile styling appointment",
      "Parking for a client visit",
      "Tolls on a business trip across town",
      "Rideshare to a same-day work event",
      "Driving between two work locations in the same day",
    ],
    ruleOfThumb:
      "Use Vehicle & Transportation for local business driving and trips between clients, errands, or work locations. Do not use it for your regular commute from home to your main place of work.",
    shortSummary:
      "Use for mileage-related driving costs, parking, tolls, and local transportation connected to work, but not your normal commute.",
    cpaCategory: "Car and truck expenses",
  },
  {
    category: "Utilities",
    simpleDefinition:
      "Basic service bills that keep your work environment functioning.",
    includes:
      "Electricity, water, gas, internet, phone line, and other service utilities used for the business.",
    examples: [
      "Internet for your studio",
      "Electric bill for your salon suite",
      "Business phone line",
      "Water service tied to your workspace",
    ],
    ruleOfThumb:
      "If it is an ongoing service bill that powers or connects your workspace, start with Utilities.",
    shortSummary:
      "Use for internet, power, water, phone, and similar service bills that keep the business running.",
    cpaCategory: "Utilities",
  },
  {
    category: "Professional Fees",
    simpleDefinition:
      "Payments to experts who help you legally, financially, or strategically run the business.",
    includes:
      "Accountants, bookkeepers, attorneys, consultants, tax preparers, and similar professional services.",
    examples: [
      "CPA tax preparation fee",
      "Bookkeeping support",
      "Attorney review of a lease or contract",
      "Business consultant session",
    ],
    ruleOfThumb:
      "If you paid a qualified professional for advice or a specialized service, it belongs here.",
    shortSummary:
      "Use for accountants, legal help, consulting, bookkeeping, and similar expert business services.",
    cpaCategory: "Legal and professional services",
  },
  {
    category: "Subcontractor Work",
    simpleDefinition:
      "Payments to non-employees you hire to help with client work or business tasks.",
    includes:
      "Independent contractors, freelancers, assistants, outsourced labor, guest artists, and specialists hired to help complete services or support business operations.",
    examples: [
      "Freelance assistant helping with a large bridal styling job",
      "Guest artist payout for shared client work",
      "Independent contractor paid to cover overflow appointments",
      "Virtual assistant hired to help with scheduling and client messages",
    ],
    ruleOfThumb:
      "If you paid another non-employee person to help do the work or keep the business running, start here.",
    shortSummary:
      "Use for freelancers, contractors, assistants, and other non-employees you pay to help with the business.",
    cpaCategory: "Commissions and fees",
  },
  {
    category: "Cleaning & Sanitation",
    simpleDefinition:
      "Products and services used to keep your tools, station, and space clean and compliant.",
    includes:
      "Disinfectants, sanitizers, laundry, sanitation supplies, PPE, and cleaning services for the business.",
    examples: [
      "Barbicide, disinfectant wipes, and sprays",
      "Paper towels and disposable table covers",
      "Laundry service for massage linens",
      "Sanitation bags and surface cleaner",
    ],
    ruleOfThumb:
      "If the expense is mainly about cleanliness, hygiene, or safety in your workspace, use Cleaning & Sanitation.",
    shortSummary:
      "Use for cleaning products, sanitation items, and hygiene-related costs tied to your work setup.",
    cpaCategory: "Supplies",
  },
  {
    category: "Education & Training",
    simpleDefinition:
      "Learning expenses that help you improve your skills or stay current in your field.",
    includes:
      "Classes, workshops, certifications, seminars, business education, and training materials related to your work.",
    examples: [
      "Advanced balayage course",
      "Continuing education for massage licensure",
      "Nail art workshop",
      "Tattoo convention seminar ticket",
    ],
    ruleOfThumb:
      "If you spent money to build your skills, renew knowledge, or grow professionally, use Education & Training.",
    shortSummary:
      "Use for classes, workshops, certifications, and training that improve your business skills or services.",
    cpaCategory: "Other expenses",
  },
  {
    category: "Work Clothing",
    simpleDefinition:
      "Clothing or gear bought specifically for the job and not mainly for everyday personal use.",
    includes:
      "Aprons, scrubs, branded uniforms, protective footwear, and role-specific garments or accessories.",
    examples: [
      "Branded salon apron",
      "Massage scrubs",
      "Protective shoes for long shifts",
      "Tattoo sleeves or protective workwear",
    ],
    ruleOfThumb:
      "If the item is clearly for work use and tied to your professional role, use Work Clothing. If it is ordinary streetwear, it usually does not belong here.",
    shortSummary:
      "Use for work-specific clothing, aprons, scrubs, or protective wear bought for the job.",
    cpaCategory: "Other expenses",
  },
  {
    category: "Payment Processing Fees",
    simpleDefinition:
      "Fees charged to collect money from clients electronically.",
    includes:
      "Card processing fees, transaction fees, instant transfer fees, booking-platform payment fees, and similar charges.",
    examples: [
      "Square processing fees",
      "Stripe transaction fees",
      "Booking app payment processing deduction",
      "Instant payout fee from your payment processor",
    ],
    ruleOfThumb:
      "If the fee happened because you accepted or moved client payments, put it here.",
    shortSummary:
      "Use for card fees, transaction fees, payout fees, and other charges tied to receiving payments.",
    cpaCategory: "Commissions and fees",
  },
  {
    category: "Taxes & Licenses",
    simpleDefinition:
      "Required government or regulatory costs connected to legally operating your business.",
    includes:
      "Business licenses, permits, professional renewals, registration fees, and business-related tax payments or filing fees.",
    examples: [
      "Cosmetology license renewal",
      "Local business license fee",
      "Seller permit renewal",
      "Tattoo permit or inspection fee",
    ],
    ruleOfThumb:
      "If it is a required fee to stay registered, compliant, or authorized to operate, use Taxes & Licenses.",
    shortSummary:
      "Use for required licenses, permits, renewals, and business tax-related government fees.",
    cpaCategory: "Taxes and licenses",
  },
  {
    category: "Office Expenses",
    simpleDefinition:
      "General admin supplies and small business-use items for paperwork or organization.",
    includes:
      "Printer supplies, notebooks, labels, mailing materials, filing tools, and desk-related business supplies.",
    examples: [
      "Printer paper and ink",
      "Receipt folders and labels",
      "Pens, notebooks, clipboards",
      "Shipping envelopes for product orders",
    ],
    ruleOfThumb:
      "If it supports the admin side of running your business rather than the service itself, it often fits Office Expenses.",
    shortSummary:
      "Use for admin and desk supplies like paper, ink, labels, folders, and similar office materials.",
    cpaCategory: "Office expense",
  },
  {
    category: "Miscellaneous/ Other",
    simpleDefinition:
      "A fallback category for legitimate business expenses that do not clearly fit anywhere else.",
    includes:
      "Uncommon or one-off business purchases that are still work-related but not well matched to another category.",
    examples: [
      "A unique one-time vendor fee",
      "Small business purchase that does not match the standard list",
      "Unexpected operational cost",
      "Special event support item with no cleaner category match",
    ],
    ruleOfThumb:
      "Use this only after checking the other categories first. If a more specific category fits, use the specific one instead.",
    shortSummary:
      "Use only as a last resort for real business expenses that do not clearly belong in a more specific category.",
    cpaCategory: "Other expenses",
  },
]

export const EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORY_GUIDE.map(
  (entry) => entry.category
)

const EXPENSE_CATEGORY_CONFIG_BY_NORMALIZED_LABEL = new Map<
  string,
  ExpenseCategoryRuntimeConfig
>(
  EXPENSE_CATEGORY_GUIDE.map((entry) => [
    normalizeExpenseCategory(entry.category),
    {
      key: createExpenseCategoryKey(entry.category),
      isVisible:
        entry.category === VEHICLE_EXPENSE_CATEGORY_LABEL
          ? (context?: ExpenseCategoryVisibilityContext) =>
              isVehicleExpenseTrackingEnabled(context?.independentSettings)
          : undefined,
    },
  ])
)

function createExpenseCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function sanitizeExpenseCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function normalizeExpenseCategory(value: string): string {
  return sanitizeExpenseCategoryName(value).toLowerCase()
}

function resolveCategoryAlias(value: string): string {
  const normalized = normalizeExpenseCategory(value)
  return LEGACY_CATEGORY_ALIASES[normalized] ?? value.trim()
}

export function getExpenseCategoryRuntimeConfig(
  value: string
): ExpenseCategoryRuntimeConfig | null {
  const aliased = resolveCategoryAlias(value)
  const normalized = normalizeExpenseCategory(aliased)
  if (!normalized) return null

  return EXPENSE_CATEGORY_CONFIG_BY_NORMALIZED_LABEL.get(normalized) ?? null
}

export function getExpenseCategoryKey(value: string): string | null {
  return getExpenseCategoryRuntimeConfig(value)?.key ?? null
}

export function isExpenseCategoryVisible(
  value: string,
  context?: ExpenseCategoryVisibilityContext
): boolean {
  const config = getExpenseCategoryRuntimeConfig(value)
  if (!config?.isVisible) return true
  return config.isVisible(context)
}

export function findExpenseCategoryGuideEntry(
  value: string
): ExpenseCategoryGuideEntry | null {
  const aliased = resolveCategoryAlias(value)
  const normalized = normalizeExpenseCategory(aliased)
  if (!normalized) return null

  return (
    EXPENSE_CATEGORY_GUIDE.find(
      (entry) => normalizeExpenseCategory(entry.category) === normalized
    ) ?? null
  )
}

export function getCustomExpenseCategoryOptions(
  categories?: readonly string[] | null
): string[] {
  const next: string[] = []
  const seen = new Set<string>()

  for (const category of categories ?? []) {
    const sanitized = sanitizeExpenseCategoryName(category)
    const normalized = normalizeExpenseCategory(sanitized)

    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    next.push(sanitized)
  }

  return next
}

export function getExpenseCategoryOptions(
  customCategories?: readonly string[] | null
): string[] {
  const custom = getCustomExpenseCategoryOptions(customCategories)
  const seen = new Set(custom.map((category) => normalizeExpenseCategory(category)))
  const builtIn = EXPENSE_CATEGORY_OPTIONS.filter((category) => {
    const normalized = normalizeExpenseCategory(category)
    return !seen.has(normalized)
  })

  return [...custom, ...builtIn]
}

export function getVisibleExpenseCategoryOptions(
  customCategories?: readonly string[] | null,
  context?: ExpenseCategoryVisibilityContext,
  options: {
    includeCategories?: readonly string[] | null
  } = {}
): string[] {
  const custom = getCustomExpenseCategoryOptions(customCategories)
  const seen = new Set(custom.map((category) => normalizeExpenseCategory(category)))
  const visibleBuiltIn = EXPENSE_CATEGORY_OPTIONS.filter((category) => {
    if (!isExpenseCategoryVisible(category, context)) {
      return false
    }

    const normalized = normalizeExpenseCategory(category)
    return !seen.has(normalized)
  })
  const next = [...custom, ...visibleBuiltIn]

  for (const category of options.includeCategories ?? []) {
    const resolved = resolveExpenseCategoryLabel(category, customCategories)
    const normalized = normalizeExpenseCategory(resolved ?? category)
    if (!normalized || next.some((entry) => normalizeExpenseCategory(entry) === normalized)) {
      continue
    }

    next.push(resolved ?? sanitizeExpenseCategoryName(category))
  }

  return next
}

export function isExpenseCategorySelectable(
  value: string,
  customCategories?: readonly string[] | null,
  context?: ExpenseCategoryVisibilityContext
): boolean {
  const resolved = resolveExpenseCategoryLabel(value, customCategories)
  if (!resolved) return false

  const entry = findExpenseCategoryGuideEntry(resolved)
  if (!entry) return true

  return isExpenseCategoryVisible(entry.category, context)
}

export function resolveExpenseCategoryLabel(
  value: string,
  customCategories?: readonly string[] | null
): string | null {
  const entry = findExpenseCategoryGuideEntry(value)
  if (entry) return entry.category

  const normalized = normalizeExpenseCategory(value)
  if (!normalized) return null

  return (
    getCustomExpenseCategoryOptions(customCategories).find(
      (category) => normalizeExpenseCategory(category) === normalized
    ) ?? null
  )
}

export function isExpenseCategoryNameTaken(
  value: string,
  customCategories?: readonly string[] | null
): boolean {
  const normalized = normalizeExpenseCategory(value)
  if (!normalized) return false

  return getExpenseCategoryOptions(customCategories).some(
    (category) => normalizeExpenseCategory(category) === normalized
  )
}

export function normalizeExpenseCategoryLabel(
  value: string,
  customCategories?: readonly string[] | null
): string {
  return (
    resolveExpenseCategoryLabel(value, customCategories) ??
    (sanitizeExpenseCategoryName(value) || "Uncategorized")
  )
}

export function getCpaExpenseCategory(value: string): CpaExpenseCategory {
  const entry = findExpenseCategoryGuideEntry(value)
  return entry?.cpaCategory ?? "Other expenses"
}

export { VEHICLE_EXPENSE_CATEGORY_KEY, VEHICLE_EXPENSE_CATEGORY_LABEL }
