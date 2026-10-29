import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

// ---------------------------------------------------------------------------
// Fetches a web address someone typed (a busy calendar's iCal link) without
// letting it reach anything but the public internet: https only, no IP
// addresses or local names, every address the name resolves to must be
// public, redirects are checked the same way, and the body is capped in size
// and time.
// ---------------------------------------------------------------------------

export class SafeFetchError extends Error {}

const MAX_REDIRECTS = 3

function privateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Whether an IP address is local, private or otherwise not the public internet. */
export function privateAddress(address: string): boolean {
  if (isIP(address) === 4) return privateIPv4(address)
  const lower = address.toLowerCase()
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return privateIPv4(mapped[1])
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff")
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new SafeFetchError("Only https:// links can be read.")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host)) throw new SafeFetchError("Use the calendar's web address, not an IP address.")
  if (!host.includes(".") || /\.(local|localhost|internal|lan|home|corp)$/i.test(host)) {
    throw new SafeFetchError("That calendar address isn't on the public internet.")
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new SafeFetchError("That calendar's website couldn't be found.")
  }
  if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) {
    throw new SafeFetchError("That calendar address isn't on the public internet.")
  }
}

/** The text at a public https address, or a SafeFetchError saying why not. */
export async function fetchPublicText(rawUrl: string, options: { maxBytes: number; timeoutMs: number }): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    let url = new URL(rawUrl)
    for (let hop = 0; ; hop += 1) {
      await assertPublicUrl(url)
      let response: Response
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "User-Agent": "521-busy-calendar/1.0" },
        })
      } catch {
        throw new SafeFetchError(controller.signal.aborted ? "The calendar took too long to answer." : "The calendar couldn't be reached.")
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new SafeFetchError("The calendar link redirects too many times.")
        url = new URL(response.headers.get("location")!, url)
        continue
      }
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
        throw new SafeFetchError("The calendar link doesn't work anymore. It may have been reset or unshared.")
      }
      if (!response.ok || !response.body) throw new SafeFetchError(`The calendar answered with an error (${response.status}).`)
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > options.maxBytes) {
          await reader.cancel().catch(() => null)
          throw new SafeFetchError("That calendar is too big to read.")
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks).toString("utf8")
    }
  } finally {
    clearTimeout(timer)
  }
}
