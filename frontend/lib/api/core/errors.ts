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

export function shouldQueueOfflineMutation(error: unknown): boolean {
  if (error instanceof ApiError && error.status) {
    return ![400, 401, 403, 404, 409].includes(error.status)
  }

  return true
}
