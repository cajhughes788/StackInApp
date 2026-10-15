// Weekly summary push for independent workspaces (sendWeeklyDigest.ts).
// Pure so the wording can be checked without sending anything.

export type WeeklyDigestInput = {
  income: number
  expenses: number
  // Bank transactions waiting for review ("Needs you").
  pendingReviewCount: number
  // Expenses from the week over the receipt threshold with no receipt.
  missingReceiptCount: number
}

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

// Null when there's nothing worth a notification (a quiet week with nothing
// to review) — better no push than "You earned $0".
export function buildWeeklyDigest(input: WeeklyDigestInput): { title: string; body: string } | null {
  const { income, expenses, pendingReviewCount, missingReceiptCount } = input
  const needsYou = pendingReviewCount + missingReceiptCount
  if (income <= 0 && expenses <= 0 && needsYou === 0) return null

  const title = income > 0 ? `Your week: ${wholeDollars.format(income)} earned` : "Your week in 521"

  const parts: string[] = []
  if (income > 0 && expenses <= 0) {
    parts.push("No expenses logged.")
  } else if (income > 0 && expenses > income) {
    parts.push(`Expenses were ${wholeDollars.format(expenses)}, ${wholeDollars.format(expenses - income)} more than you earned.`)
  } else if (income > 0) {
    parts.push(`You kept ${wholeDollars.format(income - expenses)} after ${wholeDollars.format(expenses)} in expenses.`)
  } else if (expenses > 0) {
    parts.push(`${wholeDollars.format(expenses)} in expenses this week.`)
  }
  if (needsYou > 0) {
    parts.push(needsYou === 1 ? "1 item needs you." : `${needsYou} items need you.`)
  } else {
    parts.push("You're all caught up.")
  }

  return { title, body: parts.join(" ") }
}
