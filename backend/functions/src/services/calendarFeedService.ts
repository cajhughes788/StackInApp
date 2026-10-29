import { randomBytes } from "node:crypto"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { appointmentsCol, parseAppointment } from "./appointmentsService"
import { assertIndependentWorkspace, readBookingSettings } from "./bookingService"
import { invoicesCol, readInvoiceSettings } from "./invoicesService"
import { buildCalendarFeed, calendarFeedUrl, type CalendarFeedMoney } from "@shared/calendarFeed"
import { InvoiceSchema } from "@shared/schemas/invoice"

// ---------------------------------------------------------------------------
// The owner's calendar sync link (shared/calendarFeed.ts). One private link
// per workspace: calendarFeeds/{token} points at the workspace, and
// workspaces/{id}/private/calendarFeed holds the current token. Resetting
// makes a new token and deletes the old one, so the old link stops working.
// ---------------------------------------------------------------------------

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,64}$/
const LOOKBACK_MS = 30 * 86_400_000

function feedsCol() {
  return db.collection("calendarFeeds")
}

function currentDoc(workspaceId: string) {
  return db.doc(`workspaces/${workspaceId}/private/calendarFeed`)
}

/** The workspace's link, made the first time (or anew when resetting). */
export async function calendarFeedLink(workspaceId: string, uid: string, reset: boolean): Promise<{ token: string; url: string }> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const token = await db.runTransaction(async (txn) => {
    const current = await txn.get(currentDoc(workspaceId))
    const existing = current.data()?.token as string | undefined
    if (existing && !reset) return existing
    const next = randomBytes(24).toString("base64url")
    const nowIso = new Date().toISOString()
    if (existing) txn.delete(feedsCol().doc(existing))
    txn.create(feedsCol().doc(next), { workspaceId, createdAt: nowIso })
    txn.set(currentDoc(workspaceId), { token: next, createdAt: nowIso })
    return next
  })
  return { token, url: calendarFeedUrl(token) }
}

/** The calendar file for a link, or null if the link isn't (or is no longer) valid. */
export async function calendarFeedFile(token: string): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null
  const link = await feedsCol().doc(token).get()
  const workspaceId = link.data()?.workspaceId
  if (typeof workspaceId !== "string") return null
  // Only the current link works (a reset retires the old one).
  if ((await currentDoc(workspaceId).get()).data()?.token !== token) return null

  const nowIso = new Date().toISOString()
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString()
  const [snap, booking, settings] = await Promise.all([
    appointmentsCol(workspaceId).where("startAt", ">=", since).orderBy("startAt", "asc").limit(1000).get(),
    readBookingSettings(workspaceId),
    readInvoiceSettings(workspaceId),
  ])
  const appointments = snap.docs.flatMap((doc) => parseAppointment(doc.data()) ?? [])

  // Paid deposits, from each appointment's invoice.
  const withInvoice = appointments.filter((appointment) => appointment.invoiceId)
  const invoiceSnaps = withInvoice.length
    ? await db.getAll(...withInvoice.map((appointment) => invoicesCol(workspaceId).doc(appointment.invoiceId!)))
    : []
  const deposits: Record<string, CalendarFeedMoney> = {}
  invoiceSnaps.forEach((invoiceSnap, index) => {
    const invoice = InvoiceSchema.safeParse(invoiceSnap.data())
    if (invoice.success && invoice.data.payments.length > 0) deposits[withInvoice[index].id] = "paid"
  })

  return buildCalendarFeed({
    appointments,
    deposits,
    businessName: settings.businessName ?? "",
    timeZone: booking.timeZone,
    nowIso,
  })
}
