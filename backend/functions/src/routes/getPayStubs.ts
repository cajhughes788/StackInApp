// /functions/src/routes/getPayStubs.ts
// Refactored to unified Firebase v2 + withCorsAuth architecture
// - Split into handler + function export
// - Removed direct verifyAuth usage (handled by withCorsAuth)
// - Preserves validation, settings-based range detection, and pay stub listing logic
import { onRequest } from "firebase-functions/v2/https";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../admin";
import * as payStubsSvc from "../services/payStubsService";
import { getMostRecentlyClosedPayPeriod } from "@shared/payPeriods";
import { SettingsType, SettingsDocSchema } from "@shared/schemas/settings";
// ---------------------------------------------------------------------------
// 🔹 Validation schema for query params
// ---------------------------------------------------------------------------
const QuerySchema = z.object({
    workspaceId: z.string().min(1),
    limit: z.string().optional(),
    cursor: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    forceFull: z
        .union([z.string(), z.boolean()])
        .optional()
        .transform((v) => (v === "true" || v === true ? true : false)),
});
// ---------------------------------------------------------------------------
// 🔹 Plain handler (reusable for tests or withCorsAuth wrapper)
// ---------------------------------------------------------------------------
export async function getPayStubsHandler(req: Request, res: Response): Promise<void> {
    // Method guard
    if (req.method !== "GET") {
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
        // Validate query params
        const parsed = QuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: "Invalid query parameters",
                details: parsed.error.format(),
            });
            return;
        }
        const { workspaceId, limit, cursor, start, end, forceFull } = parsed.data;
        console.log("[getPayStubs] request_received", JSON.stringify({
            uid,
            workspaceId,
            limit,
            cursor,
            start,
            end,
            forceFull,
        }));
        // Determine date range using shared Settings.Schema
        let startDate = start;
        let endDate = end;
        if (!startDate || !endDate) {
            const settingsRef = db.doc(`workspaces/${workspaceId}/settings/current`);
            const settingsSnap = await settingsRef.get();
            const settingsData = settingsSnap.exists ? settingsSnap.data() : null;
            const settingsParsed = settingsData ? SettingsDocSchema.safeParse(settingsData) : null;
            const settings: SettingsType | null = settingsParsed?.success ? settingsParsed.data : null;
            if (settings) {
                const range = getMostRecentlyClosedPayPeriod(settings);
                startDate = startDate || range.start;
                endDate = endDate || range.end;
            }
        }
        // Delegate to service
        const result = await payStubsSvc.listPayStubs(workspaceId, uid, {
            limit: limit ? Number(limit) : 100,
            cursorId: typeof cursor === "string" ? cursor : undefined,
            forceFull,
        });
        // Null-safe fallback for UI parity
        const paystubs = result.paystubs.map((p: any) => ({
            ...p,
            breakdown: p.breakdown ?? null,
            taxes: p.taxes ?? null,
        }));
        console.log("[getPayStubs] response_summary", JSON.stringify({
            uid,
            workspaceId,
            count: paystubs.length,
            nextCursor: result.nextCursor,
            periodIds: paystubs.map((stub: any) => stub.periodId),
            periods: paystubs.map((stub: any) => ({
                periodId: stub.periodId,
                periodStart: stub.periodStart,
                periodEnd: stub.periodEnd,
            })),
        }));
        // modest client-side caching; safe because pay stubs are user-private
        res.setHeader("Cache-Control", "private, max-age=60");
        res.status(200).json({
            ok: true,
            paystubs,
            nextCursor: result.nextCursor,
            period: { start: startDate, end: endDate },
        });
    }
    catch (err: any) {
        res.status(500).json({
            ok: false,
            error: err?.message ?? "Internal Server Error",
        });
    }
}
