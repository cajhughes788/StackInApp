import { z } from "zod"

// -------------------------------------------------------------
// DeviceToken
// One per registered push-notification device. Firestore path:
// users/{uid}/deviceTokens/{tokenId} — user-scoped like
// users/{uid}/subscription/current, since a phone isn't tied to one
// workspace.
// -------------------------------------------------------------
export const DeviceTokenSchema = z.object({
  id: z.string(),
  uid: z.string(),
  fcmToken: z.string(),
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DeviceTokenType = z.infer<typeof DeviceTokenSchema>
