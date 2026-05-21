"use client"

let authSessionVersion = 0

export function getAuthSessionVersion(): number {
  return authSessionVersion
}

export function bumpAuthSessionVersion(): number {
  authSessionVersion += 1
  return authSessionVersion
}

export function isAuthSessionCurrent(version: number): boolean {
  return authSessionVersion === version
}
