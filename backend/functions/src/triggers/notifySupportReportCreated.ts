import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { defineSecret } from "firebase-functions/params"

export const SLACK_SUPPORT_WEBHOOK_URL = defineSecret("SLACK_SUPPORT_WEBHOOK_URL")

type SupportReportDoc = {
  kind?: string
  message?: string
  userId?: string
  userEmail?: string | null
  context?: {
    route?: string
    workspaceId?: string | null
    workspaceType?: string | null
    workspaceName?: string | null
    deviceType?: string
    platform?: string
    buildId?: string | null
    capturedAt?: string
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function buildSlackPayload(reportId: string, report: SupportReportDoc) {
  const kind = typeof report.kind === "string" ? report.kind : "support"
  const message = typeof report.message === "string" ? report.message : ""
  const preview = message.trim() ? truncate(message.trim(), 220) : "No message provided."
  const context = report.context ?? {}

  const fields = [
    {
      type: "mrkdwn",
      text: `*Type*\n${kind}`,
    },
    {
      type: "mrkdwn",
      text: `*User*\n${report.userEmail ?? report.userId ?? "unknown"}`,
    },
    {
      type: "mrkdwn",
      text: `*Workspace*\n${context.workspaceName ?? context.workspaceId ?? "none"}`,
    },
    {
      type: "mrkdwn",
      text: `*Route*\n${context.route ?? "unknown"}`,
    },
    {
      type: "mrkdwn",
      text: `*Platform*\n${context.platform ?? "unknown"} / ${context.deviceType ?? "unknown"}`,
    },
    {
      type: "mrkdwn",
      text: `*Report ID*\n${reportId}`,
    },
  ]

  return {
    text: `New support report: ${kind}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "New support report",
        },
      },
      {
        type: "section",
        fields,
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message*\n>${preview.replace(/\n/g, "\n>")}`,
        },
      },
    ],
  }
}

export const notifySupportReportCreated = onDocumentCreated(
  {
    document: "supportReports/{reportId}",
    secrets: [SLACK_SUPPORT_WEBHOOK_URL],
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const report = snapshot.data() as SupportReportDoc
    const reportId = snapshot.id
    const webhookUrl = SLACK_SUPPORT_WEBHOOK_URL.value()

    if (!webhookUrl) {
      await snapshot.ref.set(
        {
          slackNotification: {
            status: "skipped",
            reason: "Missing SLACK_SUPPORT_WEBHOOK_URL",
            updatedAt: Date.now(),
          },
        },
        { merge: true }
      )
      return
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildSlackPayload(reportId, report)),
      })

      const responseText = await response.text()

      if (!response.ok) {
        throw new Error(`Slack webhook failed (${response.status}): ${responseText || "unknown error"}`)
      }

      await snapshot.ref.set(
        {
          slackNotification: {
            status: "sent",
            sentAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        { merge: true }
      )
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Slack notification failed"

      await snapshot.ref.set(
        {
          slackNotification: {
            status: "failed",
            error: truncate(message, 500),
            updatedAt: Date.now(),
          },
        },
        { merge: true }
      )
    }
  }
)
