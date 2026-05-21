// /functions/src/routes/getSettings.ts
import type { Request, Response } from "express";
import { BadRequestError, sendHttpError, UnauthorizedError } from "../lib/httpErrors";
import * as settingsSvc from "../services/settingsService";
export async function getSettingsHandler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    const uid = (req as any).user?.uid;
    if (!uid) {
        sendHttpError(res, new UnauthorizedError(), "getSettings");
        return;
    }
    const workspaceId = req.query.workspaceId as string | undefined;
    if (!workspaceId) {
        sendHttpError(res, new BadRequestError("Missing workspaceId"), "getSettings");
        return;
    }
    try {
        const settingsData = await settingsSvc.getSettings(workspaceId, uid);
        if (!settingsData) {
            res.status(200).json({ ok: true, settings: null });
            return;
        }
        res.setHeader("Cache-Control", "private, max-age=300");
        res.status(200).json({
            ok: true,
            settings: settingsData,
        });
    }
    catch (err: any) {
        sendHttpError(res, err, "getSettings");
    }
}
