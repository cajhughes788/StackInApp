// src/db.ts
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";

// Only init once
if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}

export const db = getFirestore();

