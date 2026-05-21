//shared/schemas/user.ts
import { z } from "zod"

/**
 * User Domain Schema
 * --------------------------------------------------------
 * Defines the minimal identity data cached for authenticated users.
 * Mirrors Firebase Auth essentials but omits unnecessary fields.
 *
 * Used for:
 * - Cached user identity persistence (storage.ts)
 * - Context hydration
 * - Firestore association (uid, email)
 * --------------------------------------------------------
 */

// Base input — matches what can come from Firebase Auth or user updates
export const Input = z.object({
  uid: z.string(),
  email: z.string().email().nullable(),
  phoneNumber: z.string().nullable(),
})

// Full schema — identical here, but allows extension (e.g. roles, metadata)
export const Schema = Input

// Strongly typed schema inference
export type InputType = z.infer<typeof Input>
export type Type = z.infer<typeof Schema>
