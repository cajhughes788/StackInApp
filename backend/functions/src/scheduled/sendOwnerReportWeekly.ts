import { onSchedule } from "firebase-functions/v2/scheduler"
import sgMail from "@sendgrid/mail"
import { db } from "../admin"
import { SENDGRID_API_KEY } from "../utils/sendEmail"

// Weekly product numbers for the app's owner, computed from Firestore — no
// client-side tracking. Read-only: counts workspaces, activity, bank links,
// review backlog, push reach and paid plans, then emails one summary.
// Loops every workspace with a few small queries each; fine at today's size,
// worth revisiting (counters or an export) past a few thousand workspaces.
const OWNER_REPORT_TO = "cajetanhughes@gmail.com"
const REPORT_FROM = "invoices@the521app.com" // domain-authenticated in SendGrid

const DAY_MS = 24 * 60 * 60 * 1000
// Logged anything within this long of creating the workspace = activated.
const ACTIVATION_WINDOW_MS = 7 * DAY_MS
// Pending bank items older than this count as a stale review backlog.
const STALE_REVIEW_DAYS = 7

type WorkspaceStats = {
  type: string
  createdAt: number
  activeLast7: boolean
  activeLast28: boolean
  activated: boolean
  hasBank: boolean
  bankErrors: number
  pendingReview: number
  stalePendingReview: number
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"
}

// Earliest and latest activity timestamps (ISO strings) across entries and
// expenses. Entries carry createdAtLocal; expenses carry createdAt.
async function getActivityBounds(workspaceId: string): Promise<{ first: string | null; last: string | null }> {
  const entries = db.collection(`workspaces/${workspaceId}/entries`)
  const expenses = db.collection(`workspaces/${workspaceId}/expenses`)
  const [firstEntry, lastEntry, firstExpense, lastExpense] = await Promise.all([
    entries.orderBy("createdAtLocal", "asc").limit(1).get(),
    entries.orderBy("updatedAtLocal", "desc").limit(1).get(),
    expenses.orderBy("createdAt", "asc").limit(1).get(),
    expenses.orderBy("updatedAt", "desc").limit(1).get(),
  ])
  const pick = (snap: FirebaseFirestore.QuerySnapshot, field: string) =>
    snap.empty ? null : (snap.docs[0].get(field) as string | undefined) ?? null
  const firsts = [pick(firstEntry, "createdAtLocal"), pick(firstExpense, "createdAt")].filter(Boolean) as string[]
  const lasts = [pick(lastEntry, "updatedAtLocal"), pick(lastExpense, "updatedAt")].filter(Boolean) as string[]
  return {
    first: firsts.length ? firsts.sort()[0] : null,
    last: lasts.length ? lasts.sort().reverse()[0] : null,
  }
}

async function collectWorkspaceStats(workspaceDoc: FirebaseFirestore.QueryDocumentSnapshot, now: number): Promise<WorkspaceStats> {
  const data = workspaceDoc.data()
  const workspaceId = workspaceDoc.id
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0
  const isIndependent = data.type === "independent"
  const staleCutoffDate = new Date(now - STALE_REVIEW_DAYS * DAY_MS).toISOString().slice(0, 10)

  const [activity, plaidItems, pending, stalePending] = await Promise.all([
    getActivityBounds(workspaceId),
    isIndependent ? db.collection(`workspaces/${workspaceId}/plaidItems`).get() : null,
    isIndependent
      ? db.collection(`workspaces/${workspaceId}/plaidPendingTransactions`).where("status", "==", "pending").count().get()
      : null,
    isIndependent
      ? db
          .collection(`workspaces/${workspaceId}/plaidPendingTransactions`)
          .where("status", "==", "pending")
          .where("date", "<", staleCutoffDate)
          .count()
          .get()
      : null,
  ])

  const lastMs = activity.last ? Date.parse(activity.last) : NaN
  const firstMs = activity.first ? Date.parse(activity.first) : NaN
  return {
    type: String(data.type ?? "unknown"),
    createdAt,
    activeLast7: Number.isFinite(lastMs) && now - lastMs <= 7 * DAY_MS,
    activeLast28: Number.isFinite(lastMs) && now - lastMs <= 28 * DAY_MS,
    activated: Number.isFinite(firstMs) && createdAt > 0 && firstMs - createdAt <= ACTIVATION_WINDOW_MS,
    hasBank: (plaidItems?.size ?? 0) > 0,
    bankErrors: plaidItems?.docs.filter((doc) => doc.get("status") === "error").length ?? 0,
    pendingReview: pending?.data().count ?? 0,
    stalePendingReview: stalePending?.data().count ?? 0,
  }
}

export function buildOwnerReport(
  stats: WorkspaceStats[],
  people: { withPush: number; paying: number; trialing: number },
  now: number
): { subject: string; rows: Array<[string, string]> } {
  const independent = stats.filter((s) => s.type === "independent")
  const newThisWeek = stats.filter((s) => now - s.createdAt <= 7 * DAY_MS)
  // Cohort that has had a full week to activate: created 8–35 days ago.
  const cohort = stats.filter((s) => now - s.createdAt > 7 * DAY_MS && now - s.createdAt <= 35 * DAY_MS)
  const active7 = stats.filter((s) => s.activeLast7).length
  const active28 = stats.filter((s) => s.activeLast28).length
  const withBank = independent.filter((s) => s.hasBank)
  const backlogWorkspaces = withBank.filter((s) => s.pendingReview > 0).length

  const rows: Array<[string, string]> = [
    ["Active workspaces", `${stats.length} (${independent.length} self-employed, ${stats.length - independent.length} W-2)`],
    ["New this week", String(newThisWeek.length)],
    ["Active last 7 days", `${active7} (${pct(active7, stats.length)})`],
    ["Active last 28 days", `${active28} (${pct(active28, stats.length)})`],
    [
      "Logged something in week one",
      `${cohort.filter((s) => s.activated).length} of ${cohort.length} (${pct(cohort.filter((s) => s.activated).length, cohort.length)}) — signups 8–35 days ago`,
    ],
    ["Self-employed with a bank connected", `${withBank.length} (${pct(withBank.length, independent.length)})`],
    ["Bank connections in error", String(independent.reduce((sum, s) => sum + s.bankErrors, 0))],
    [
      "“Needs you” backlog",
      `${backlogWorkspaces} of ${withBank.length} bank-connected workspaces have items waiting · ${withBank.reduce((sum, s) => sum + s.pendingReview, 0)} items, ${withBank.reduce((sum, s) => sum + s.stalePendingReview, 0)} older than ${STALE_REVIEW_DAYS} days`,
    ],
    ["People who can get notifications", String(people.withPush)],
    ["Paying / trialing", `${people.paying} / ${people.trialing}`],
  ]
  const weekOf = new Date(now).toISOString().slice(0, 10)
  return { subject: `521 weekly numbers — ${weekOf}: ${active7} active, ${newThisWeek.length} new`, rows }
}

export const sendOwnerReportWeekly = onSchedule(
  {
    schedule: "0 8 * * 1", // Mondays 8:00 Pacific
    timeZone: "America/Los_Angeles",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
    timeoutSeconds: 540,
  },
  async () => {
    const now = Date.now()
    const workspacesSnap = await db.collection("workspaces").where("status", "==", "active").get()

    const stats: WorkspaceStats[] = []
    for (const workspaceDoc of workspacesSnap.docs) {
      try {
        stats.push(await collectWorkspaceStats(workspaceDoc, now))
      } catch (err) {
        console.warn("sendOwnerReportWeekly: skipped workspace", {
          workspaceId: workspaceDoc.id,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const [deviceTokensSnap, subscriptionsSnap] = await Promise.all([
      db.collectionGroup("deviceTokens").select().get(),
      db.collectionGroup("subscription").select("status").get(),
    ])
    const usersWithPush = new Set(deviceTokensSnap.docs.map((doc) => doc.ref.parent.parent?.id).filter(Boolean))
    const statuses = subscriptionsSnap.docs.filter((doc) => doc.id === "current").map((doc) => doc.get("status"))
    const report = buildOwnerReport(
      stats,
      {
        withPush: usersWithPush.size,
        paying: statuses.filter((status) => status === "active").length,
        trialing: statuses.filter((status) => status === "trialing").length,
      },
      now
    )

    const text = report.rows.map(([label, value]) => `${label}: ${value}`).join("\n")
    const html = `<h2>521 — weekly numbers</h2><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">${report.rows
      .map(([label, value]) => `<tr><td><b>${label}</b></td><td>${value}</td></tr>`)
      .join("")}</table><p style="color:#666">Computed from Firestore. "Active" = created or edited an entry or expense.</p>`

    sgMail.setApiKey(SENDGRID_API_KEY.value())
    await sgMail.send({ to: OWNER_REPORT_TO, from: REPORT_FROM, subject: report.subject, text, html })
  }
)
