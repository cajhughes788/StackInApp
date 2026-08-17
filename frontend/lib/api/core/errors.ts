export class ApiError extends Error {
  readonly status?: number
  readonly details?: unknown

  constructor(message: string, options: { status?: number; details?: unknown } = {}) {
    super(message)
    this.name = "ApiError"
    this.status = options.status
    this.details = options.details
  }
}

export function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError"
  }

  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === "AbortError" || error.name === "CanceledError") {
    return true
  }

  return /abort|canceled|cancelled/i.test(error.message)
}

// apiFetch tags the error it throws with isTimeout=true when ITS OWN request
// timer fired the abort (see client.ts) — as opposed to an external signal
// the caller supplied to deliberately cancel the request. That distinction
// matters here: a request our client gave up waiting on may well have
// finished successfully server-side (Cloud Functions don't stop executing
// just because the client's connection dropped), so it's safe — and
// necessary — to queue it for a deduped retry via clientMutationId rather
// than rolling back and forcing the user to resubmit with a new one, which
// produces a genuine duplicate if the original request actually landed.
export function isTimeoutError(error: unknown): boolean {
  return isAbortError(error) && Boolean((error as { isTimeout?: boolean } | null | undefined)?.isTimeout)
}

export function shouldQueueOfflineMutation(error: unknown): boolean {
  if (isAbortError(error)) {
    return isTimeoutError(error)
  }

  if (error instanceof ApiError && error.status) {
    return ![400, 401, 403, 404, 409].includes(error.status)
  }

  return true
}
