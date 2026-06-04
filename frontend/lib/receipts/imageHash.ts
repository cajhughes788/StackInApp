"use client"

import type { DecodedReceiptImage } from "./imagePipeline"

const HASH_SIZE = 8 // 8x8 = 64 bits

/**
 * Computes a 16-character hex average-hash (aHash) of the image.
 * Fast (~1ms), no library required. Good enough for near-duplicate detection
 * of the same physical receipt uploaded multiple times.
 */
export function computeImageHash(decoded: DecodedReceiptImage): string {
  const canvas = document.createElement("canvas")
  canvas.width = HASH_SIZE
  canvas.height = HASH_SIZE
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return ""

  ctx.drawImage(decoded.source as CanvasImageSource, 0, 0, HASH_SIZE, HASH_SIZE)
  const { data } = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE)

  const grayscale = new Array<number>(HASH_SIZE * HASH_SIZE)
  for (let i = 0; i < grayscale.length; i++) {
    const offset = i * 4
    grayscale[i] =
      0.299 * data[offset] +
      0.587 * data[offset + 1] +
      0.114 * data[offset + 2]
  }

  const avg = grayscale.reduce((a, b) => a + b, 0) / grayscale.length

  // Pack 4 bits per hex character (64 bits → 16 chars)
  let hash = ""
  for (let i = 0; i < grayscale.length; i += 4) {
    let nibble = 0
    for (let j = 0; j < 4; j++) {
      if ((grayscale[i + j] ?? 0) > avg) nibble |= 1 << j
    }
    hash += nibble.toString(16)
  }

  return hash
}

/** Hamming distance between two hex image hashes. Returns Infinity for mismatched lengths. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (xor) {
      distance += xor & 1
      xor >>>= 1
    }
  }
  return distance
}

// ── localStorage-backed hash index ─────────────────────────────────────────

const STORAGE_KEY_PREFIX = "receipt-hash-index:"
const MAX_ENTRIES = 300
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

type HashEntry = {
  hash: string
  receiptAssetId: string
  createdAt: number
}

function readIndex(workspaceId: string): HashEntry[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${workspaceId}`)
    if (!raw) return []
    return JSON.parse(raw) as HashEntry[]
  } catch {
    return []
  }
}

function writeIndex(workspaceId: string, entries: HashEntry[]): void {
  try {
    const now = Date.now()
    const pruned = entries
      .filter((e) => now - e.createdAt < MAX_AGE_MS)
      .slice(-MAX_ENTRIES)
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${workspaceId}`, JSON.stringify(pruned))
  } catch {
    // localStorage full — non-fatal
  }
}

export function saveImageHash(
  workspaceId: string,
  receiptAssetId: string,
  hash: string
): void {
  if (!hash) return
  const entries = readIndex(workspaceId)
  entries.push({ hash, receiptAssetId, createdAt: Date.now() })
  writeIndex(workspaceId, entries)
}

/**
 * Returns the first stored entry whose hash is within `threshold` Hamming bits
 * of the candidate hash, or null if no near-match is found.
 * Threshold of 8 (out of 64 bits) catches the same receipt re-uploaded with
 * minor compression differences while avoiding false positives.
 */
export function findNearMatchByHash(
  workspaceId: string,
  candidateHash: string,
  threshold = 8
): HashEntry | null {
  if (!candidateHash) return null
  const entries = readIndex(workspaceId)
  for (const entry of entries) {
    if (hammingDistance(entry.hash, candidateHash) <= threshold) {
      return entry
    }
  }
  return null
}
