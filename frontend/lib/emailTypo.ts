// Spots a likely typo in the part of an email after the @ ("gmal.com",
// "gmail.con", "yahooo.com", a bare "@gmail") and suggests the fix. Only
// common consumer providers are checked, so business and school addresses
// never get a suggestion. Used by the sign-up form as a hint; it never blocks.

const KNOWN_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "icloud.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "me.com",
  "live.com",
  "msn.com",
  "comcast.net",
  "att.net",
  "verizon.net",
]

// Real providers that sit one or two letters away from a known one
// (mail.com vs gmail.com, mac.com vs me.com). Never "corrected".
const REAL_LOOKALIKES = new Set([
  "mail.com",
  "gmx.com",
  "ymail.com",
  "mac.com",
  "aim.com",
  "mail.ru",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "rocketmail.com",
  "hotmail.co.uk",
  "yahoo.co.uk",
  "outlook.co.uk",
  "live.co.uk",
  "googlemail.com",
])

// Edit distance counting a swap of two neighbouring letters as one edit,
// so "gmial" is as close to "gmail" as "gmal" is.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

// Short domains (me.com, aol.com) only get one-letter fixes, so unrelated
// short domains aren't pulled toward them.
function allowedDistance(known: string): number {
  return known.split(".")[0].length <= 3 ? 1 : 2
}

function closestKnown(candidate: string, compare: (known: string) => string): string | null {
  let best: string | null = null
  let bestDistance = Infinity
  for (const known of KNOWN_DOMAINS) {
    const distance = editDistance(candidate, compare(known))
    if (distance <= allowedDistance(known) && distance < bestDistance) {
      best = known
      bestDistance = distance
    }
  }
  return best
}

// The corrected email, or null when there's nothing to suggest.
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf("@")
  if (at <= 0 || at === trimmed.length - 1) return null

  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1).toLowerCase()

  if (KNOWN_DOMAINS.includes(domain) || REAL_LOOKALIKES.has(domain)) return null

  const fixed = domain.includes(".")
    ? closestKnown(domain, (known) => known)
    : // No ending at all ("@gmail"): match the provider name alone.
      closestKnown(domain, (known) => known.split(".")[0])

  return fixed ? `${local}@${fixed}` : null
}
