import { z } from "zod"

// -------------------------------------------------------------
// Client
// A saved client: contact details, notes and the other spellings of their
// name. Firestore path: workspaces/{workspaceId}/clients/{clientId}
//
// Invoices link to one with clientId and keep their own copy of the name and
// contact details as printed. Payments outside invoices (Venmo, cash, "Other
// income") count toward a client when the payer's name matches the client's
// nameKey or one of its aliases — see shared/clients.ts.
// -------------------------------------------------------------
export const ClientSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().min(1),
  // clientKey(name) — case- and space-insensitive.
  nameKey: z.string().min(1),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  notes: z.string().default(""),
  // Other name keys that mean this client (a merged duplicate's name, a
  // Venmo name), as clientKey() output.
  aliases: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const ContactFields = {
  email: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
}

export const ClientCreateInputSchema = z.object({
  // Made by the app (random) so it can show the client before the server
  // answers; a retry with the same id returns that client. Left out, the
  // server makes one.
  id: z.string().regex(/^[A-Za-z0-9]{20,40}$/).optional(),
  name: z.string().trim().min(1).max(80),
  ...ContactFields,
})

export const ClientPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  ...ContactFields,
  archived: z.boolean().optional(),
})

// Money from outside invoices that counts toward a client.
export const ClientPaymentSchema = z.object({
  entryId: z.string(),
  date: z.string(),
  // Negative for a refund.
  amount: z.number(),
  // The name it matched on, as written on the entry.
  label: z.string(),
})

export const ClientPaymentSummarySchema = z.object({
  total: z.number(),
  thisYear: z.number(),
  // Payments counted (refunds excluded) — "visits" for the repeat badge.
  count: z.number().int().nonnegative(),
  lastDate: z.string().nullable(),
})

export type ClientType = z.infer<typeof ClientSchema>
export type ClientCreateInput = z.infer<typeof ClientCreateInputSchema>
export type ClientPatch = z.infer<typeof ClientPatchSchema>
export type ClientPayment = z.infer<typeof ClientPaymentSchema>
export type ClientPaymentSummary = z.infer<typeof ClientPaymentSummarySchema>
