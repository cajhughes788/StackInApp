import { initializeApp, applicationDefault, getApps } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { getAuth } from "firebase-admin/auth"
import { getStorage } from "firebase-admin/storage"

function resolveStorageBucket(): string | undefined {
  const explicitBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.GCLOUD_STORAGE_BUCKET ||
    process.env.STORAGE_BUCKET

  if (typeof explicitBucket === "string" && explicitBucket.trim().length > 0) {
    return explicitBucket.trim()
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_CONFIG?.match(/"projectId":"([^"]+)"/)?.[1]

  if (typeof projectId === "string" && projectId.trim().length > 0) {
    return `${projectId.trim()}.firebasestorage.app`
  }

  return undefined
}

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    storageBucket: resolveStorageBucket(),
  })
}

export const db = getFirestore()
export const auth = getAuth()
export const storage = getStorage()
