import type { Request, Response } from "express";
import { z } from "zod";
import * as payStubsSvc from "../services/payStubsService";
import { db } from "../admin";
import { getCurrentPayPeriodAt } from "@shared/payPeriods";
import { SettingsDocSchema, type SettingsType } from "@shared/schemas/settings";

const GenerateCurrentSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

export async function generateCurrentPayStubHandler(
  req: Request,
  res: Response
): Promise<void> {
  console.log("[generateCurrentPayStub] request_received", JSON.stringify({
    method: req.method,
    query: req.query,
    body: req.body ?? null,
  }));

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const parsed = GenerateCurrentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "Invalid request payload",
        details: parsed.error.format(),
      });
      return;
    }

    const workspaceId =
      (req.query.workspaceId as string | undefined) ?? parsed.data.workspaceId;

    if (!workspaceId) {
      res.status(400).json({ ok: false, error: "Missing workspaceId" });
      return;
    }

    console.log("[generateCurrentPayStub] resolved_identity", JSON.stringify({
      uid,
      workspaceId,
      force: parsed.data.force ?? true,
    }));

    const settingsRef = db.doc(`workspaces/${workspaceId}/settings/current`);
    const settingsSnap = await settingsRef.get();
    const settingsData = settingsSnap.exists ? settingsSnap.data() : null;
    const settingsParsed = settingsData
      ? SettingsDocSchema.safeParse(settingsData)
      : null;

    const settings: SettingsType | null = settingsParsed?.success
      ? settingsParsed.data
      : null;

    if (!settings) {
      res.status(400).json({
        ok: false,
        error: "Unable to load workspace settings for current pay period",
      });
      return;
    }

    const currentPeriod = getCurrentPayPeriodAt(settings);
    console.log("[generateCurrentPayStub] current_period", JSON.stringify({
      workspaceId,
      uid,
      currentPeriod,
      payFrequency: settings.w2?.payFrequency ?? null,
      timeZone: settings.common?.timeZone ?? null,
      autoTaxCalculation: settings.w2?.autoTaxCalculation ?? null,
    }));

    const result = await payStubsSvc.generatePayStub(workspaceId, uid, {
      start: currentPeriod.start,
      end: currentPeriod.end,
      periodId: currentPeriod.periodId,
      force: parsed.data.force ?? true,
    });

    const payStubSnap = await db
      .doc(`workspaces/${workspaceId}/payStubs/${currentPeriod.periodId}`)
      .get();

    console.log("[generateCurrentPayStub] generation_complete", JSON.stringify({
      workspaceId,
      uid,
      currentPeriod,
      result,
      payStubExists: payStubSnap.exists,
      persistedSummary: payStubSnap.exists
        ? {
            periodId: payStubSnap.id,
            periodStart: payStubSnap.data()?.periodStart ?? null,
            periodEnd: payStubSnap.data()?.periodEnd ?? null,
            grossIncome: payStubSnap.data()?.grossIncome ?? null,
            netIncome: payStubSnap.data()?.netIncome ?? null,
            updatedAt: payStubSnap.data()?.updatedAt ?? null,
          }
        : null,
    }));

    res.status(201).json({
      ok: true,
      period: currentPeriod,
      payStub: result,
    });
  } catch (err: any) {
    console.error("[generateCurrentPayStub] request_failed", JSON.stringify({
      error: err?.message ?? "Internal Server Error",
      stack: err?.stack ?? null,
    }));
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Internal Server Error",
    });
  }
}
