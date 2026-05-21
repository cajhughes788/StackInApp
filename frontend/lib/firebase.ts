// /lib/firebase.ts (Static Build + Capacitor Safe)

import { Capacitor } from "@capacitor/core"
import { initializeApp, getApps, type FirebaseApp } from "firebase/app"
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from "firebase/auth"
import { getFirestore, type Firestore } from "firebase/firestore"
import { getStorage, type FirebaseStorage } from "firebase/storage"

let app: FirebaseApp | undefined
let auth: Auth | undefined
let db: Firestore | undefined
let storage: FirebaseStorage | undefined

function initializeAuthForEnvironment(app: FirebaseApp): Auth {
  const isNativeCapacitor = Capacitor.isNativePlatform()

  try {
    if (isNativeCapacitor) {
      // Hybrid webviews are more sensitive to persistence backends than regular browsers.
      return initializeAuth(app, {
        persistence: [browserLocalPersistence, inMemoryPersistence],
      })
    }

    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        inMemoryPersistence,
      ],
    })
  } catch {
    return getAuth(app)
  }
}

// Only initialize Firebase in the browser
if (typeof window !== "undefined") {
  // Next.js replaces these at build time, so they are safe to reference
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  }

  // Initialize once
  app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0]

  auth = initializeAuthForEnvironment(app)
  db = getFirestore(app)
  storage = getStorage(app)
}

// Safe getters for components that run before hydration
export function getAuthSafe(): Auth {
  if (!auth) throw new Error("[getAuthSafe] Firebase Auth not initialized yet.")
  return auth
}

export function getDbSafe(): Firestore {
  if (!db) throw new Error("[getDbSafe] Firestore not initialized yet.")
  return db
}

export function getStorageSafe(): FirebaseStorage {
  if (!storage) throw new Error("[getStorageSafe] Firebase Storage not initialized yet.")
  return storage
}

export { app, auth, db, storage }
