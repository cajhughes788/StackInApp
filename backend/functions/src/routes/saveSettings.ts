// /functions/src/routes/saveSettings.ts
import type { Request, Response } from "express";
import { SettingsPatch } from "@shared/schemas/settings";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
import { createBackendProfileTrace, withBackendProfileStep } from "../lib/profileTrace";
import * as settingsSvc from "../services/settingsService";
export async function saveSettingsHandler(req: Request, res: Response): Promise<void> {
    const trace = createBackendProfileTrace(req, "settings_save");
    trace.mark("settings_save.handler_invoked");
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const uid = (req as any).user?.uid;
        trace.mark("settings_save.auth_checked", {
            hasUser: Boolean(uid),
        });
        if (!uid) {
            sendHttpError(res, new UnauthorizedError(), "saveSettings");
            return;
        }
        const workspaceId = req.query.workspaceId as string | undefined;
        if (!workspaceId) {
            sendHttpError(res, new BadRequestError("Missing workspaceId"), "saveSettings");
            return;
        }
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            sendHttpError(res, new BadRequestError("Invalid payload: expected non-null object patch"), "saveSettings");
            return;
        }
        const hasNestedPatch = "patch" in body;
        const payload = hasNestedPatch
            ? {
                patch: body.patch,
                expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : null,
            }
            : {
                patch: body,
                expectedVersion: null,
            };
        if (!payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch)) {
            sendHttpError(res, new BadRequestError("Invalid payload: expected patch object"), "saveSettings");
            return;
        }
        SettingsPatch.parse(payload.patch);
        const updated = await withBackendProfileStep(trace, "settings_save.patch_settings", () => settingsSvc.patchSettings(workspaceId, uid, payload.patch, {
            expectedVersion: payload.expectedVersion,
        }, trace), {
            workspaceId,
        });
        res.status(200).json({
            ok: true,
            settings: updated.settings,
            meta: updated.meta,
        });
        trace.mark("settings_save.response_sent", {
            workspaceId,
        });
    }
    catch (err: any) {
        trace.error("settings_save.failed", err);
        sendHttpError(res, err, "saveSettings");
    }
}
