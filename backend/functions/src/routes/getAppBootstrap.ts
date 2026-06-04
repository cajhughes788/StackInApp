import type { Request, Response } from "express"
import { z } from "zod"

import { deriveWorkspaceCapabilities } from "@shared/contracts/capabilities"
import type { AppBootstrapSnapshot } from "@shared/contracts/appBootstrap"
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
import { buildAccountAuthorityFromSubscriptionSnapshot } from "../services/accountAuthority"

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

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

    // All four reads run in parallel. The settings read is skipped only when
    // the in-process cache is warm — same behaviour as before.
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

    // Check whether the workspace doc carries a fresh embedded settings
    // snapshot (written atomically on every settings save). Used as a
    // fallback when the settings doc is empty (new workspace, migration) and
    // to prime the in-process cache immediately on cold function instances so
    // the next request within 5 min hits the cache instead of Firestore.
    const EMBEDDED_SETTINGS_TTL_MS = SETTINGS_TTL_MS * 2 // 10 min
    const workspaceRaw = workspaceSnap.data() as Record<string, unknown>
    const embedded = workspaceRaw?.settingsSnapshot as
      | { data: unknown; version: number; at: number }
      | undefined
    const embeddedIsFresh =
      embedded &&
      typeof embedded.at === "number" &&
      Date.now() - embedded.at < EMBEDDED_SETTINGS_TTL_MS

    if (!membershipSnap.exists) {
      throw new ForbiddenError("Forbidden")
    }

    if (!workspaceSnap.exists) {
      throw new NotFoundError("Workspace not found")
    }

    const workspaceData = workspaceSnap.data() as WorkspaceDoc
    const membership = membershipSnap.data() as WorkspaceMembership

    if (workspaceData.status !== "active") {
      throw new ForbiddenError("Workspace is not active")
    }

    const workspace: WorkspaceSummary = {
      id: workspaceSnap.id,
      name: workspaceData.name,
      type: workspaceData.type,
      status: workspaceData.status,
    }

    let settings: SettingsType | null = null
    let settingsMeta: import("@shared/contracts/settingsSync").SettingsDocumentMeta | null = null

    if (canUseCachedSettings && cachedSettingsEntry) {
      // 1. In-process cache hit — warm function instance, no Firestore read needed.
      settings = cachedSettingsEntry.data
      settingsMeta = cachedSettingsEntry.meta ?? null
    } else if (settingsSnap?.exists) {
      // 2. Settings subcollection read (all cold-start cases).
      const loadedSettings = await withBackendProfileStep(
        trace,
        "startup.settings_snapshot_parse",
        () => Promise.resolve(settingsSnap.data()),
        { workspaceId }
      )
      const parsedSettings = SettingsDocSchema.safeParse(loadedSettings)
      const parsedMeta =
        loadedSettings &&
        typeof loadedSettings === "object" &&
        typeof (loadedSettings as Record<string, unknown>).version === "number" &&
        typeof (loadedSettings as Record<string, unknown>).updatedAt === "string"
          ? {
              version: (loadedSettings as Record<string, unknown>).version as number,
              updatedAt: (loadedSettings as Record<string, unknown>).updatedAt as string,
            }
          : null
      if (parsedSettings.success) {
        settings = parsedSettings.data
        settingsMeta = parsedMeta
        settingsCache[workspaceId] = {
          data: parsedSettings.data,
          meta: parsedMeta ?? { version: 0, updatedAt: new Date(0).toISOString() },
          ts: Date.now(),
        }
      }
    } else if (embeddedIsFresh && embedded) {
      // 3. Workspace doc embedded snapshot — fallback when the settings
      //    subcollection doc doesn't exist yet (new workspace before first
      //    settings save, or migration gap). Also primes the in-process cache
      //    so the next request within 5 min is a guaranteed cache hit.
      const parsedEmbedded = SettingsDocSchema.safeParse(embedded.data)
      if (parsedEmbedded.success) {
        settings = parsedEmbedded.data
        settingsMeta = {
          version: embedded.version,
          updatedAt: new Date(embedded.at).toISOString(),
        }
        settingsCache[workspaceId] = {
          data: parsedEmbedded.data,
          meta: settingsMeta,
          ts: Date.now(),
        }
      }
    }

    const accountAuthority = await buildAccountAuthorityFromSubscriptionSnapshot(
      subscriptionRef,
      subscriptionSnap
    )

    const snapshot: AppBootstrapSnapshot = {
      workspace,
      membershipRole: membership.role,
      settings,
      settingsMeta: settingsMeta ?? null,
      workspaceCapabilities: deriveWorkspaceCapabilities(workspace.type),
      subscription: accountAuthority.subscription,
      subscriptionCapabilities: accountAuthority.subscriptionCapabilities,
      isSubscriptionActive: accountAuthority.isSubscriptionActive,
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
