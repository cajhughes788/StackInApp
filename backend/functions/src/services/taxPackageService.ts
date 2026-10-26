// /functions/src/services/taxPackageService.ts
// The tax-time package for one self-employed workspace and year. Gathers
// the year's records, reads the receipt files (the backend can; the app
// can't fetch bucket files across origins), builds the zip, and saves it
// under the workspace's exports with a private download link. What goes
// in the files is decided in @shared/taxPackage.
import { randomUUID } from "node:crypto";
import { db, storage } from "../admin";
import { assertWorkspaceMembership } from "../lib/workspaceMembership";
import { BadRequestError } from "../lib/httpErrors";
import { generateProfitLossStatement } from "./profitLossService";
import { listTaxPayments } from "./taxEstimateService";
import { EntrySchema, type EntryType } from "@shared/schemas/entry";
import { ExpenseSchema, type ExpenseType } from "@shared/schemas/expense";
import { sumEntryProcessingFees } from "@shared/processingFees";
import { needsReceiptForAuditDefense } from "@shared/receiptRequirements";
import {
    FORM_1099K_THRESHOLD,
    buildTaxPackageFiles,
    computeIncomeByApp,
    receiptZipName,
    scheduleCLine,
    type TaxPackageData,
} from "@shared/taxPackage";
import { buildZip, type ZipEntry } from "@shared/zip";

// Receipt originals are a few MB at most; past this the zip is cut short
// rather than running the function out of memory.
const MAX_RECEIPT_BYTES = 300 * 1024 * 1024;
const RECEIPT_CONCURRENCY = 8;

type ReceiptSource = { expenseIndex: number; storagePath: string; extension: string };

async function loadYear<T>(collection: string, taxYear: number, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): Promise<T[]> {
    const snap = await db
        .collection(collection)
        .where("date", ">=", `${taxYear}-01-01`)
        .where("date", "<=", `${taxYear}-12-31`)
        .get();
    return snap.docs.flatMap((doc) => {
        const parsed = schema.safeParse({ id: doc.id, ...doc.data() });
        return parsed.success && parsed.data ? [parsed.data] : [];
    });
}

function extensionOf(path: string): string {
    const match = /\.([A-Za-z0-9]{2,5})$/.exec(path);
    return match ? match[1].toLowerCase() : "jpg";
}

export async function getTaxPackageData(
    uid: string,
    workspaceId: string,
    taxYear: number
): Promise<{ data: TaxPackageData; receipts: ReceiptSource[] }> {
    await assertWorkspaceMembership(workspaceId, uid);
    const workspace = (await db.doc(`workspaces/${workspaceId}`).get()).data();
    if (workspace?.type !== "independent") {
        throw new BadRequestError("Tax-time packages are for self-employed workspaces.");
    }

    const [statement, entries, expenses, payments] = await Promise.all([
        generateProfitLossStatement(workspaceId, uid, { periodType: "year", periodKey: String(taxYear) }),
        loadYear<EntryType>(`workspaces/${workspaceId}/entries`, taxYear, EntrySchema),
        loadYear<ExpenseType>(`workspaces/${workspaceId}/expenses`, taxYear, ExpenseSchema),
        listTaxPayments(uid, taxYear),
    ]);

    const assetIds = [...new Set(expenses.map((e) => e.receiptAssetId).filter((id): id is string => !!id))];
    const assetSnaps = assetIds.length
        ? await db.getAll(...assetIds.map((id) => db.doc(`workspaces/${workspaceId}/receiptAssets/${id}`)))
        : [];
    const assetPaths = new Map<string, string>();
    for (const snap of assetSnaps) {
        const asset = snap.data();
        const path = asset?.originalStoragePath ?? asset?.storagePath;
        if (snap.exists && typeof path === "string" && path.startsWith(`workspaces/${workspaceId}/`)) assetPaths.set(snap.id, path);
    }

    const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.vendor.localeCompare(b.vendor));
    const usedNames = new Set<string>();
    const receipts: ReceiptSource[] = [];
    const expenseRows = sorted.map((expense, index) => {
        const path = expense.receiptAssetId ? assetPaths.get(expense.receiptAssetId) : undefined;
        let receiptFile: string | null = null;
        if (path) {
            const extension = extensionOf(path);
            receiptFile = receiptZipName({ date: expense.date, vendor: expense.vendor, amount: expense.amount }, extension, usedNames);
            receipts.push({ expenseIndex: index, storagePath: path, extension });
        }
        return {
            date: expense.date,
            vendor: expense.vendor,
            description: expense.description,
            category: expense.account?.trim() || "Uncategorized",
            amount: expense.amount,
            receiptFile,
            receiptMissing: !receiptFile && needsReceiptForAuditDefense(expense.amount, expense.receiptAssetId),
        };
    });

    const grossReceipts = statement.income.grossReceipts ?? statement.income.total + statement.income.refunds;
    const data: TaxPackageData = {
        taxYear,
        workspaceName: String(workspace?.name ?? "My business"),
        generatedAt: new Date().toISOString(),
        scheduleC: {
            grossReceipts,
            returnsAndAllowances: statement.income.refunds,
            netIncomeFromSales: statement.income.total,
            expenseLines: statement.expenses.byCategory.map((category) => ({
                category: category.category,
                line: scheduleCLine(category.category),
                amount: category.amount,
                count: category.count,
            })),
            totalExpenses: statement.expenses.total,
            netProfit: statement.netProfit,
            processingFees: sumEntryProcessingFees(entries),
        },
        incomeByApp: computeIncomeByApp(entries, FORM_1099K_THRESHOLD),
        form1099K: { amountOver: FORM_1099K_THRESHOLD.amountOver, transactionsOver: FORM_1099K_THRESHOLD.transactionsOver },
        mileage: sorted
            .filter((e) => Number(e.businessMiles) > 0)
            .map((e) => ({ date: e.date, description: e.description || e.vendor, businessMiles: Number(e.businessMiles), amount: e.amount })),
        estimatedPayments: [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn)).map((p) => ({ paidOn: p.paidOn, amount: p.amount })),
        expenses: expenseRows,
    };
    return { data, receipts };
}

async function downloadReceipts(receipts: ReceiptSource[]): Promise<Map<number, Uint8Array>> {
    const files = new Map<number, Uint8Array>();
    let total = 0;
    let next = 0;
    let full = false;
    const worker = async () => {
        while (next < receipts.length && !full) {
            const receipt = receipts[next++];
            try {
                const [bytes] = await storage.bucket().file(receipt.storagePath).download();
                if (total + bytes.length > MAX_RECEIPT_BYTES) {
                    full = true;
                    return;
                }
                total += bytes.length;
                files.set(receipt.expenseIndex, new Uint8Array(bytes));
            } catch (error) {
                console.warn("taxPackageService: receipt unreadable, left out", {
                    path: receipt.storagePath,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };
    await Promise.all(Array.from({ length: RECEIPT_CONCURRENCY }, worker));
    return files;
}

export async function buildTaxPackage(uid: string, workspaceId: string, taxYear: number) {
    const { data, receipts } = await getTaxPackageData(uid, workspaceId, taxYear);
    const receiptBytes = await downloadReceipts(receipts);

    // A receipt that couldn't be read (or didn't fit) isn't listed as included.
    data.expenses = data.expenses.map((row, index) =>
        row.receiptFile && !receiptBytes.has(index) ? { ...row, receiptFile: null } : row
    );
    const entries: ZipEntry[] = buildTaxPackageFiles(data);
    data.expenses.forEach((row, index) => {
        const bytes = receiptBytes.get(index);
        if (row.receiptFile && bytes) entries.push({ path: row.receiptFile, data: bytes });
    });
    const zip = buildZip(entries);

    // One package at a time per workspace: older ones are removed.
    const prefix = `workspaces/${workspaceId}/exports/`;
    await storage.bucket().deleteFiles({ prefix }).catch(() => {});
    const path = `${prefix}tax-package-${taxYear}-${Date.now()}.zip`;
    const fileName = `${data.workspaceName.replace(/[^\p{L}\p{N} ]+/gu, "").trim() || "521"} tax records ${taxYear}.zip`;
    const token = randomUUID();
    const bucket = storage.bucket();
    await bucket.file(path).save(Buffer.from(zip), {
        resumable: false,
        contentType: "application/zip",
        metadata: {
            contentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
            // A Firebase download token: the link works without signing in,
            // like the app's own receipt links, and is unguessable.
            metadata: { firebaseStorageDownloadTokens: token },
        },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

    return {
        url,
        fileName,
        sizeBytes: zip.length,
        receiptsIncluded: receiptBytes.size,
        receiptsLeftOut: receipts.length - receiptBytes.size,
    };
}
