// /functions/src/services/recurringRulesService.ts
import { db } from "../admin";
import { z } from "zod";
import {
    RecurringRuleInput,
    RecurringRulePatch,
    RecurringRuleSchema,
    type RecurringIncomeSource,
    type RecurringRuleType,
} from "@shared/schemas/recurringRule";
import { computeNextOccurrence } from "@shared/recurringSchedule";
import { BadRequestError, ForbiddenError, NotFoundError } from "../lib/httpErrors";
import * as expensesService from "./expensesService";
import * as entriesService from "./entriesService";

const RecurringRuleArraySchema = z.array(RecurringRuleSchema);

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((entry) => stripUndefinedDeep(entry)) as T;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
        return Object.fromEntries(entries) as T;
    }
    return value;
}

async function assertWorkspaceMembership(workspaceId: string, uid: string): Promise<void> {
    const memberSnap = await db.doc(`users/${uid}/memberships/${workspaceId}`).get();
    if (!memberSnap.exists) {
        throw new ForbiddenError("Forbidden");
    }
}

function recurringRulesCollection(workspaceId: string) {
    return db.collection("workspaces").doc(workspaceId).collection("recurringRules");
}

const SOURCE_TO_PAYMENT_METHOD: Record<RecurringIncomeSource, string> = {
    venmo: "venmo",
    appleCash: "apple_cash",
    zelle: "zelle",
    posSales: "pos",
    cashSales: "cash",
    custom: "other",
};

// Generates the actual expense/entry for one occurrence, reusing the same
// createExpense/createEntry paths used by manual creation — inherits
// periodId resolution, category validation, and P&L sync for free instead
// of reimplementing them. clientMutationId is deterministic per
// (ruleId, occurrenceDate) so retries can never double-create a record.
async function generateOccurrence(
    workspaceId: string,
    uid: string,
    rule: RecurringRuleType,
    occurrenceDate: string
): Promise<{ generatedExpense?: any; generatedEntry?: any }> {
    const clientMutationId = `recurring:${rule.id}:${occurrenceDate}`;
    if (rule.type === "expense" && rule.expenseTemplate) {
        const { expense } = await expensesService.createExpense(workspaceId, uid, {
            ...rule.expenseTemplate,
            date: occurrenceDate,
            periodId: occurrenceDate.slice(0, 7),
            clientMutationId,
        });
        return { generatedExpense: expense };
    }
    if (rule.type === "income" && rule.incomeTemplate) {
        const { source, category, amount, label } = rule.incomeTemplate;
        const paymentMethod = SOURCE_TO_PAYMENT_METHOD[source];
        const result = await entriesService.createEntry(workspaceId, uid, {
            workspace: "independent",
            date: occurrenceDate,
            notes: rule.notes ?? "",
            independent: {
                hours: 0,
                // computeEntry/getIndependentCategorizedIncomeTotals only sums
                // incomeBreakdowns, not customIncome — mirror what entry-form.tsx's
                // manual submit path does for every payment field (and for custom
                // income specifically, also push into customIncome for parity with
                // the manual entry flow), or dayTotal/taxableTotal silently compute
                // to 0 despite a populated amount.
                incomeBreakdowns: [
                    {
                        paymentMethod: paymentMethod as any,
                        [category]: amount,
                    },
                ],
                unreportedCash: 0,
                unreportedCashTips: 0,
                customIncome: source === "custom" && label
                    ? [{ label, amount, category }]
                    : [],
            },
            clientMutationId,
        });
        // entriesService.createEntry (unlike expensesService.createExpense) does
        // NOT embed id inside the returned entry object — attach it explicitly so
        // the frontend can key/edit/delete this record like any other entry.
        return { generatedEntry: { ...result.entry, id: result.id } };
    }
    return {};
}

// ------------------------------------------------------------
// CREATE
// ------------------------------------------------------------
export async function createRecurringRule(workspaceId: string, uid: string, raw: any) {
    await assertWorkspaceMembership(workspaceId, uid);
    const input = RecurringRuleInput.parse(raw);
    const docRef = recurringRulesCollection(workspaceId).doc();
    const nowIso = new Date().toISOString();

    const isDueNow = input.anchorDate <= todayIso();
    const nextOccurrence = isDueNow
        ? computeNextOccurrence(input.anchorDate, input.cadence, input.anchorDate)
        : input.anchorDate;

    const canonical: RecurringRuleType = RecurringRuleSchema.parse({
        ...input,
        id: docRef.id,
        workspaceId,
        endDate: input.endDate ?? null,
        nextOccurrence,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
    });

    await docRef.set(stripUndefinedDeep(canonical));

    // Atomic first-occurrence generation: if the rule is due today or
    // earlier, create the real record in this same request instead of
    // waiting up to 24h for the cron. nextOccurrence above is already
    // advanced past it, so the cron won't regenerate it.
    const generated = isDueNow
        ? await generateOccurrence(workspaceId, uid, canonical, input.anchorDate)
        : {};

    return { id: docRef.id, rule: canonical, ...generated };
}

// ------------------------------------------------------------
// UPDATE (pause/resume, edit cadence/template/endDate)
// ------------------------------------------------------------
export async function updateRecurringRule(
    workspaceId: string,
    uid: string,
    ruleId: string,
    patch: any
) {
    await assertWorkspaceMembership(workspaceId, uid);
    const parsedPatch = RecurringRulePatch.parse(patch);
    const ref = recurringRulesCollection(workspaceId).doc(ruleId);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundError("Recurring rule not found");
    const existing = snap.data() as RecurringRuleType;
    const nowIso = new Date().toISOString();

    const canonical = RecurringRuleSchema.parse({
        ...existing,
        ...parsedPatch,
        id: ruleId,
        workspaceId,
        updatedAt: nowIso,
        version: (existing.version ?? 1) + 1,
    });
    await ref.set(stripUndefinedDeep(canonical));
    return { id: ruleId, rule: canonical };
}

// ------------------------------------------------------------
// DELETE — removes the rule only; previously generated expenses/entries
// are ordinary records now and are never touched.
// ------------------------------------------------------------
export async function deleteRecurringRule(workspaceId: string, uid: string, ruleId: string) {
    await assertWorkspaceMembership(workspaceId, uid);
    const ref = recurringRulesCollection(workspaceId).doc(ruleId);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundError("Recurring rule not found");
    await ref.delete();
}

// ------------------------------------------------------------
// LIST — no period scoping, unlike expenses/entries.
// ------------------------------------------------------------
export async function getRecurringRules(workspaceId: string, uid: string): Promise<RecurringRuleType[]> {
    await assertWorkspaceMembership(workspaceId, uid);
    const snap = await recurringRulesCollection(workspaceId).get();
    const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const parsed = RecurringRuleArraySchema.safeParse(raw);
    if (!parsed.success) {
        throw new BadRequestError("Invalid recurring rule data in Firestore");
    }
    return parsed.data;
}

// ------------------------------------------------------------
// Called by the daily cron for one due rule. Exported separately from the
// route layer since the scheduled function calls it in-process.
// ------------------------------------------------------------
export async function generateDueOccurrence(
    workspaceId: string,
    ownerId: string,
    rule: RecurringRuleType
): Promise<{ generatedExpense?: any; generatedEntry?: any } | null> {
    if (!rule.active) return null;
    const today = todayIso();
    if (rule.nextOccurrence > today) return null;

    const ref = recurringRulesCollection(workspaceId).doc(rule.id);
    const nowIso = new Date().toISOString();

    if (rule.endDate && rule.nextOccurrence > rule.endDate) {
        await ref.set(
            { active: false, updatedAt: nowIso, version: (rule.version ?? 1) + 1 },
            { merge: true }
        );
        return null;
    }

    const generated = await generateOccurrence(workspaceId, ownerId, rule, rule.nextOccurrence);
    const nextOccurrence = computeNextOccurrence(rule.nextOccurrence, rule.cadence, rule.anchorDate);
    const stillActive = !rule.endDate || nextOccurrence <= rule.endDate;

    await ref.set(
        {
            nextOccurrence,
            active: stillActive,
            updatedAt: nowIso,
            version: (rule.version ?? 1) + 1,
        },
        { merge: true }
    );

    return generated;
}
