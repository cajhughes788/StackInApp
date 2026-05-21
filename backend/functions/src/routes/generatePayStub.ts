// /functions/src/routes/generatePayStub.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct UID extraction logic (handled by withCorsAuth)
// - Preserves pay period computation, validation, and pay stub generation logic
import { onRequest } from "firebase-functions/v2/https";
import type { Request, Response } from "express";
import { z } from "zod";
import * as payStubsSvc from "../services/payStubsService";
import { getMostRecentlyClosedPayPeriod } from "@shared/payPeriods";
import { db } from "../admin";
import { SettingsDocSchema, SettingsType } from "@shared/schemas/settings";
// ---------------------------------------------------------------------------
// 🔹 Validation schema
// ---------------------------------------------------------------------------
const GenerateSchema = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    force: z.boolean().optional(),
    workspaceId: z.string().min(1).optional(),
});
// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function generatePayStubHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        // NOTE: Authentication handled by withCorsAuth
        const uid = (req as any).user?.uid;
        if (!uid) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        // Validate payload
        const parsed = GenerateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: "Invalid request payload",
                details: parsed.error.format(),
            });
            return;
        }
        const workspaceId = (req.query.workspaceId as string | undefined) ??
            parsed.data.workspaceId;
        if (!workspaceId) {
            res.status(400).json({ ok: false, error: "Missing workspaceId" });
            return;
        }
        const { start, end, force } = parsed.data;
        // Compute default pay period if not provided
        let startDate = start;
        let endDate = end;
        if (!startDate || !endDate) {
            const settingsRef = db.doc(`workspaces/${workspaceId}/settings/current`);
            const settingsSnap = await settingsRef.get();
            const settingsData = settingsSnap.exists ? settingsSnap.data() : null;
            // Validate and parse settings using shared namespaced schema
            const settingsParsed = settingsData ? SettingsDocSchema.safeParse(settingsData) : null;
            // ADD: Settings validation outcome
            if (settingsParsed && !settingsParsed.success) {
            }
            else {
            }
            const settings: SettingsType | null = settingsParsed?.success ? settingsParsed.data : null;
            if (settings) {
                const range = getMostRecentlyClosedPayPeriod(settings);
                startDate = startDate || range.start;
                endDate = endDate || range.end;
            }
        }
        if (!startDate || !endDate) {
            res.status(400).json({ ok: false, error: "Unable to determine pay period range" });
            return;
        }
        // Delegate generation logic
        const stub = await payStubsSvc.generatePayStub(workspaceId, uid, {
            start: startDate,
            end: endDate,
            periodId: `${startDate}_${endDate}`,
            force: !!force,
        });
        res.status(201).json({ ok: true, payStub: stub });
    }
    catch (err: any) {
        res.status(500).json({
            ok: false,
            error: err?.message ?? "Internal Server Error",
        });
    }
}
