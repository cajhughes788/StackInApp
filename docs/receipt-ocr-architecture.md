# Receipt OCR Architecture — Point-in-Time Reference

Captured before simplification, June 2026.

---

## Overview

The receipt capture flow allowed users to photograph receipts. The image was uploaded to Firebase Storage, sent to AWS Textract for OCR/expense extraction, and the structured result was written to Firestore as a `ReceiptAnalysis` document. A `ReceiptDraft` was then created or updated from that analysis, which the user reviewed and committed as an `Expense`.

---

## End-to-End Flow

```
User taps camera / picks image
        |
        v
[Frontend] receipt-capture-panel.tsx
  1. captureReceiptImage() — native camera (Capacitor) or <input type=file>
  2. loadReceiptImage() + normalizeExifOrientation() — EXIF-correct decode
  3. analyzeReceiptImageQuality() — blur / contrast pre-check
  4. computeImageHash() + findNearMatchByHash() — duplicate image detection
  5. Resize/compress → prepareReceiptUploadFile() (upload), prepareReceiptPreviewFile(), prepareReceiptThumbnailFile()
  6. createReceiptAsset() → POST /api/receiptAssets  → Firestore receiptAssets/{id}
  7. uploadReceiptAssetToStorage() → Firebase Storage (original + preview + thumbnail paths)
  8. analyzeReceiptApi() → POST /api/analyzeReceipt?workspaceId=...
        |
        v
[Backend] analyzeReceiptHandler  (routes/analyzeReceipt.ts)
  - Accepts imageBase64 in body (skips GCS round-trip) OR receiptAssetId only
  - Calls receiptAnalysisSvc.analyzeReceipt()
        |
        v
[Backend] receiptAnalysisService.ts
  - buildAnalysisRecord() — reserves Firestore doc ID, sets status placeholder
  - analyzeReceiptWithTextract() or analyzeReceiptBytesWithTextract() (textractService.ts)
  - normalizeTextractExpense() — maps Textract SummaryFields / LineItemGroups → typed struct
  - Writes ReceiptAnalysis to Firestore (workspaces/{wid}/receiptAnalyses/{id})
  - upsertReceiptDraftForAsset() → creates/updates ReceiptDraft in Firestore
  - Returns { analysis, draft }
        |
        v
[Frontend] receipt-capture-panel.tsx (continued)
  9. Receives { analysis, draft } → patches local draft state
  10. checkDuplicateExpense() — server-side duplicate detection by amount/date/counterparty
  11. User reviews draft (date, amount, merchant, category)
  12. commitReceiptDraftApi() → POST /api/commitReceiptDraft
  13. Expense written to Firestore
```

---

## AWS Textract Integration

**Service:** `backend/functions/src/services/textractService.ts`

- Hand-rolled AWS Signature Version 4 signing (no SDK dependency).
- Calls `Textract.AnalyzeExpense` via HTTPS POST to `https://textract.{region}.amazonaws.com/`.
- Secrets: `AWS_TEXTRACT_ACCESS_KEY_ID`, `AWS_TEXTRACT_SECRET_ACCESS_KEY`, `AWS_TEXTRACT_REGION` (Firebase Secrets).
- Can accept raw bytes from the request body (skipping a GCS download) or fetch from `originalStoragePath` on the `ReceiptAsset`.

**Normalization:** `backend/functions/src/utils/normalizeTextractExpense.ts`

- Reads `SummaryFields` for merchant, date, subtotal, tax, tip, total, currency.
- Reads `LineItemGroups[].LineItems[].LineItemExpenseFields` for line items.
- Stores raw Textract output in `summaryFieldsRaw` / `lineItemsRaw` for debugging.
- Confidence scores per field stored in `fieldConfidence`.

---

## Key Routes (deleted/simplified in refactor)

| Route file | Method | Purpose |
|---|---|---|
| `routes/analyzeReceipt.ts` | POST | Trigger Textract analysis |
| `routes/getReceiptAnalysis.ts` | GET | Fetch analysis by ID *(deleted)* |
| `routes/finalizeReceiptAnalysis.ts` | POST | Separate finalization step *(deleted)* |
| `routes/updateReceiptAsset.ts` | PATCH | Update asset metadata *(deleted)* |
| `routes/getReceiptDrafts.ts` | GET | List drafts for workspace |
| `routes/commitReceiptDraft.ts` | POST | Commit draft → expense *(new)* |
| `routes/deleteReceiptAsset.ts` | DELETE | Delete asset + storage *(new)* |
| `routes/checkDuplicateExpense.ts` | POST | Duplicate expense check *(new)* |

---

## Firestore Data Model

### `workspaces/{workspaceId}/receiptAssets/{assetId}`
Schema: `shared/schemas/receiptAsset.ts`
- `storagePath` — Firebase Storage path for the original image.
- `originalStoragePath` — fallback if `storagePath` was rewritten.
- `previewStoragePath`, `thumbnailStoragePath` — compressed variants.

### `workspaces/{workspaceId}/receiptAnalyses/{analysisId}`
Schema: `shared/schemas/receiptAnalysis.ts`
- `provider: "aws_textract"`, `providerVersion: "analyze-expense-2018-06-27"`
- `status: "succeeded" | "failed"` — never written as `"analyzing"` (build-in-memory pattern).
- `summaryFieldsRaw`, `lineItemsRaw`, `normalized` — raw Textract payload retained.
- `lineItems[]` — structured line items with description, quantity, unitPrice, amount, confidence.
- `fieldConfidence` — per-field confidence map (0–1).

### `workspaces/{workspaceId}/receiptDrafts/{draftId}`
Schema: `shared/schemas/receiptDraft.ts`
- `status: "draft" | "ready_to_review" | "committed" | "dismissed"`
- `receiptAssetId`, `receiptAnalysisId` — links to above collections.
- `allocationMode: "single" | "multiple"` — single expense vs. split by line item.
- `allocations[]` — for multi-expense splits keyed by category.
- `committedExpenseId` — set on commit.
- `completion.missingFields[]` — UX helper: which required fields are unfilled.
- `version` — optimistic concurrency integer.

---

## Frontend Receipt Pipeline

**Key files:**
- `frontend/components/receipt-capture-panel.tsx` — full capture/review/commit UI
- `frontend/lib/receipts/imagePipeline.ts` — EXIF orientation normalization, image decode
- `frontend/lib/receipts/imageQuality.ts` — blur/contrast pre-flight checks
- `frontend/lib/receipts/imageHash.ts` — perceptual hash for near-duplicate detection
- `frontend/lib/receipts/receiptAssetStorage.ts` — upload helpers, path builders
- `frontend/lib/receipts/receiptDraft.ts` — draft construction helpers
- `frontend/lib/api/receiptAnalysisApi.ts` — `analyzeReceipt()` call
- `frontend/lib/api/receiptAssetsApi.ts` — `createReceiptAsset()`, `deleteReceiptAsset()`
- `frontend/lib/api/receiptDraftsApi.ts` — `commitReceiptDraftApi()`
- `frontend/lib/api/expensesApi.ts` — `checkDuplicateExpense()`

**Local OCR path (`frontend/lib/imports/ocr.ts`):**
`recognizeReceiptText()` was available as a client-side OCR fallback (called before the Textract round-trip in some flows). This used a local JS OCR library (not Textract).

---

## Image Upload Architecture

1. **Resize before upload** — `prepareReceiptUploadFile()` downscales to a max dimension to reduce Textract latency.
2. **Three storage variants** — original (full-res), preview (medium), thumbnail (small for lists).
3. **Paths** — `buildClientReceiptStoragePath()` and `buildClientReceiptDerivedPath()` construct Firebase Storage paths under `workspaces/{wid}/receipts/`.
4. **Offline queue** — assets are queued in `offlineQueue` if uploaded while offline and replayed on reconnect.
5. **Local cache** — `saveReceiptMediaFromFile()` caches the raw file bytes in IndexedDB (`receiptAssetsCache`) so the image is available immediately without a Storage round-trip.

---

## Known Issues at Time of Archival

- **Textract cold-start latency** — first request after idle period added 2–5 s.
- **Textract cost** — per-page pricing made high-volume scanning expensive.
- **GCS → Textract round-trip** — even with `imageBase64` shortcut, serialization overhead existed.
- **Legacy `status` values** — `"queued"` and `"analysis_complete_draft_pending"` appear in old Firestore documents; schema uses `.catch()` to passthrough rather than throw.
- `finalizeReceiptAnalysis` and `updateReceiptAsset` routes were removed because the single `analyzeReceipt` + `commitReceiptDraft` round-trip made them redundant.

---

## Reasons for Simplification

- Reduce backend surface area and cold-start exposure.
- Remove AWS dependency and associated secret management.
- Simplify the receipt → expense commit path to fewer round-trips.
- Reduce per-receipt cost at scale.

---

## Future Reactivation Plan

To reintroduce OCR/Textract:

1. Restore `AWS_TEXTRACT_*` secrets in Firebase project.
2. Re-add `textractService.ts` and `normalizeTextractExpense.ts` (unchanged from archive).
3. Re-add `receiptAnalysisService.ts` or a lighter wrapper around it.
4. Re-wire `analyzeReceipt` route to call the service.
5. Frontend: restore `analyzeReceiptApi()` call in `receipt-capture-panel.tsx` after asset upload.

Alternatively, swap Textract for a local OCR approach by replacing `analyzeReceiptBytesWithTextract()` with a call to an on-device or self-hosted OCR service — the `ReceiptAnalysis` schema and `normalizeTextractExpense` normalization layer are provider-agnostic enough to accommodate this.

---

## Archive Reference

- **Branch:** `receipt-ocr-archive`
- **Tag:** `receipt-ocr-v1`
- **Committed:** 2026-06-04
