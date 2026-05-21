// /functions/src/routes/saveSettings.ts
import type { Request, Response } from "express";
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
        // Extract PATCH body directly — never nested
        const patch = req.body;
        // Strict input must be: non-null, object, not array
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
            sendHttpError(res, new BadRequestError("Invalid payload: expected non-null object patch"), "saveSettings");
            return;
        }
        // PATCH → validated + merged inside service
        const updated = await withBackendProfileStep(trace, "settings_save.patch_settings", () => settingsSvc.patchSettings(workspaceId, uid, patch, trace), {
            workspaceId,
        });
        res.status(200).json({
            ok: true,
            settings: updated,
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
