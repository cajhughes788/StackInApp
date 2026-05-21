"use client"

const ENABLE_STORAGE_KEY = "stackin-diagnostics-enabled"

function isNonProductionBuild(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production"
}

export function isDiagnosticsEnabled(): boolean {
  if (isNonProductionBuild()) {
    return true
  }

  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ENABLE_DIAGNOSTICS === "true"
  ) {
    return true
  }

  if (typeof window === "undefined") {
    return false
  }

  try {
    if (window.localStorage.getItem(ENABLE_STORAGE_KEY) === "true") {
      return true
    }
  } catch {}

  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get("debug") === "1") {
      return true
    }
  } catch {}

  return false
}
