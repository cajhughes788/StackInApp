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

export function shouldQueueOfflineMutation(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }

  if (error instanceof ApiError && error.status) {
    return ![400, 401, 403, 404, 409].includes(error.status)
  }

  return true
}
