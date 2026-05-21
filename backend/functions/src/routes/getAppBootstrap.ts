import type { Request, Response } from "express"
import { z } from "zod"

import { deriveWorkspaceCapabilities } from "@shared/contracts/capabilities"
import type { AppBootstrapSnapshot } from "@shared/contracts/appBootstrap"
import { getSubscriptionCapabilities, type SubscriptionDoc } from "@shared/contracts/subscription"
import type { WorkspaceDoc, WorkspaceMembership, WorkspaceSummary } from "@shared/contracts/workspace"
import { SettingsDocSchema, type SettingsType } from "@shared/schemas/settings"
import { db } from "../admin"
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace"
import { settingsCache, SETTINGS_TTL_MS } from "../services/settingsCache"
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  sendHttpError,
} from "../lib/httpErrors"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionDoc["status"]>([
  "active",
  "trialing",
])

export async function getAppBootstrapHandler(
  req: Request,
  res: Response
): Promise<void> {
  const trace = createBackendProfileTrace(req, "startup")
  trace.mark("startup.bootstrap_handler_invoked")

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }

  try {
    const uid = (req as any).user?.uid
    trace.mark("startup.auth_checked", {
      hasUser: Boolean(uid),
    })
    if (!uid) {
      sendHttpError(res, new UnauthorizedError(), "getAppBootstrap")
      return
    }

    const parsedQuery = QuerySchema.safeParse({
      workspaceId: req.query.workspaceId,
    })

    if (!parsedQuery.success) {
      sendHttpError(
        res,
        new BadRequestError(
          "Missing or invalid workspaceId",
          parsedQuery.error.format()
        ),
        "getAppBootstrap"
      )
      return
    }

    const { workspaceId } = parsedQuery.data

    const membershipRef = db.doc(`users/${uid}/memberships/${workspaceId}`)
    const workspaceRef = db.doc(`workspaces/${workspaceId}`)
    const subscriptionRef = db.doc(`users/${uid}/subscription/current`)
    const cachedSettingsEntry = settingsCache[workspaceId]
    const canUseCachedSettings =
      cachedSettingsEntry &&
      Date.now() - cachedSettingsEntry.ts <= SETTINGS_TTL_MS

    const [membershipSnap, workspaceSnap, subscriptionSnap, settingsSnap] =
      await withBackendProfileStep(
        trace,
        "startup.firestore_reads",
        () =>
          Promise.all([
            membershipRef.get(),
            workspaceRef.get(),
            subscriptionRef.get(),
            canUseCachedSettings
              ? Promise.resolve(null)
              : db.doc(`workspaces/${workspaceId}/settings/current`).get(),
          ]),
        { uid, workspaceId }
      )

    if (!membershipSnap.exists) {
      throw new ForbiddenError("Forbidden")
    }

    if (!workspaceSnap.exists) {
      throw new NotFoundError("Workspace not found")
    }

    const workspaceData = workspaceSnap.data() as WorkspaceDoc
    const membership = membershipSnap.data() as WorkspaceMembership

    const workspace: WorkspaceSummary = {
      id: workspaceSnap.id,
      name: workspaceData.name,
      type: workspaceData.type,
      status: workspaceData.status,
    }

    let settings: SettingsType | null = null
    if (canUseCachedSettings) {
      settings = cachedSettingsEntry.data
    } else if (settingsSnap?.exists) {
      const parsedSettings = SettingsDocSchema.safeParse(settingsSnap.data())
      if (parsedSettings.success) {
        settings = parsedSettings.data
        settingsCache[workspaceId] = {
          data: parsedSettings.data,
          ts: Date.now(),
        }
      }
    }

    const subscription = subscriptionSnap.exists
      ? (subscriptionSnap.data() as SubscriptionDoc)
      : null
    const isSubscriptionActive = subscription
      ? ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
      : false
    const subscriptionCapabilities =
      subscription && isSubscriptionActive
        ? getSubscriptionCapabilities(subscription)
        : null

    const snapshot: AppBootstrapSnapshot = {
      workspace,
      membershipRole: membership.role,
      settings,
      workspaceCapabilities: deriveWorkspaceCapabilities(workspace.type),
      subscription,
      subscriptionCapabilities,
      isSubscriptionActive,
    }

    res.status(200).json({
      ok: true,
      snapshot,
    })
    trace.mark("startup.response_sent", {
      workspaceId,
      hasSettings: settings !== null,
    })
  } catch (error: any) {
    trace.error("startup.failed", error)
    sendHttpError(res, error, "getAppBootstrap")
  }
}
