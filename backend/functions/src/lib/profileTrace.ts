import type { Request } from "express"

type Primitive = string | number | boolean | null
type TraceMetadata = Record<string, Primitive | Primitive[] | undefined>

type BackendProfileEvent = {
  traceId: string
  flow: string
  step: string
  phase: "instant" | "start" | "end" | "error"
  seq: number
  ts: number
  wallTime: string
  elapsedMs: number
  deltaMs: number
  durationMs?: number
  metadata?: TraceMetadata
}

export type BackendProfileTrace = {
  traceId: string
  flow: string
  mark: (step: string, metadata?: TraceMetadata) => void
  start: (step: string, metadata?: TraceMetadata) => void
  end: (step: string, metadata?: TraceMetadata) => void
  error: (step: string, error: unknown, metadata?: TraceMetadata) => void
}

function sanitizeError(error: unknown): TraceMetadata {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    }
  }

  return {
    errorMessage: String(error),
  }
}

function emit(event: BackendProfileEvent): void {
  console.log("[profile-trace]", JSON.stringify(event))
}

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function createBackendProfileTrace(
  req: Request,
  fallbackFlow: string,
  metadata: TraceMetadata = {}
): BackendProfileTrace {
  const traceId =
    normalizeHeader(req.header("x-stackin-trace-id")) ??
    `${fallbackFlow}-${Date.now()}`
  const flow =
    normalizeHeader(req.header("x-stackin-flow")) ??
    fallbackFlow

  const baseMetadata: TraceMetadata = {
    method: req.method,
    path: req.path,
    queryWorkspaceId:
      typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined,
    ...metadata,
  }

  const traceCreatedAt = Date.now()
  let lastEventAt = traceCreatedAt
  let seq = 0
  const startedSteps = new Map<string, number>()

  const send = (
    step: string,
    phase: BackendProfileEvent["phase"],
    extra: TraceMetadata = {}
  ) => {
    const eventTs = Date.now()
    const durationMs =
      phase === "end" || phase === "error"
        ? startedSteps.has(step)
          ? eventTs - (startedSteps.get(step) ?? eventTs)
          : undefined
        : undefined

    if (phase === "start") {
      startedSteps.set(step, eventTs)
    } else if (phase === "end" || phase === "error") {
      startedSteps.delete(step)
    }

    seq += 1

    emit({
      traceId,
      flow,
      step,
      phase,
      seq,
      ts: eventTs,
      wallTime: new Date().toISOString(),
      elapsedMs: eventTs - traceCreatedAt,
      deltaMs: eventTs - lastEventAt,
      ...(durationMs !== undefined ? { durationMs } : {}),
      metadata: {
        ...baseMetadata,
        ...extra,
      },
    })

    lastEventAt = eventTs
  }

  return {
    traceId,
    flow,
    mark(step, extra = {}) {
      send(step, "instant", extra)
    },
    start(step, extra = {}) {
      send(step, "start", extra)
    },
    end(step, extra = {}) {
      send(step, "end", extra)
    },
    error(step, error, extra = {}) {
      send(step, "error", {
        ...sanitizeError(error),
        ...extra,
      })
    },
  }
}

export async function withBackendProfileStep<T>(
  trace: BackendProfileTrace,
  step: string,
  fn: () => Promise<T>,
  metadata: TraceMetadata = {}
): Promise<T> {
  trace.start(step, metadata)

  try {
    const result = await fn()
    trace.end(step, metadata)
    return result
  } catch (error) {
    trace.error(step, error, metadata)
    throw error
  }
}
