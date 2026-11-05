// Wakes a sleeping server ahead of a request someone will wait on. Each
// function runs on its own server, which sleeps after ~15 idle minutes, and
// the first request after that waits out the cold start (usually 3–10s, at
// times over 30s). Screens call this on open, so the server is up by the time
// the button is tapped.
//
// An OPTIONS request is answered before auth or any work (see withCorsAuth's
// preflight shortcut), and its result doesn't matter. Each server is woken at
// most once every few minutes, however many screens ask.

const REWAKE_AFTER_MS = 5 * 60 * 1000
const lastWokeAt = new Map<string, number>()

export function wakeServer(url: string, init: RequestInit = { method: "OPTIONS", mode: "cors" }): void {
  const now = Date.now()
  if (now - (lastWokeAt.get(url) ?? 0) < REWAKE_AFTER_MS) return
  lastWokeAt.set(url, now)
  void fetch(url, { ...init, credentials: "omit" }).catch(() => {})
}
