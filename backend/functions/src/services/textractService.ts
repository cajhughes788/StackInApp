import { createHash, createHmac } from "node:crypto"

import { defineSecret } from "firebase-functions/params"

import { storage } from "../admin"
import { BadRequestError } from "../lib/httpErrors"
import type { BackendProfileTrace } from "../lib/profileTrace"
import type { ReceiptAsset } from "@shared/schemas/receiptAsset"

export const AWS_TEXTRACT_ACCESS_KEY_ID = defineSecret("AWS_TEXTRACT_ACCESS_KEY_ID")
export const AWS_TEXTRACT_SECRET_ACCESS_KEY = defineSecret("AWS_TEXTRACT_SECRET_ACCESS_KEY")
export const AWS_TEXTRACT_REGION = defineSecret("AWS_TEXTRACT_REGION")

type TextractAnalyzeExpenseResponse = {
  ExpenseDocuments?: unknown[]
  DocumentMetadata?: unknown
}

type TextractErrorPayload = {
  __type?: string
  Message?: string
  message?: string
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest()
}

function getAmzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  }
}

async function loadAssetBytes(
  asset: ReceiptAsset,
  trace?: BackendProfileTrace
): Promise<Buffer> {
  const originalDownloadUrl = asset.originalDownloadUrl ?? asset.downloadUrl
  const originalStoragePath = asset.originalStoragePath ?? asset.storagePath

  if (originalStoragePath) {
    trace?.mark("receipt.textract.asset_fetch.begin", {
      source: "originalStoragePath",
      receiptAssetId: asset.id,
      storagePath: originalStoragePath,
    })
    const [buffer] = await storage.bucket().file(originalStoragePath).download()
    if (buffer.length === 0) {
      throw new BadRequestError("Receipt asset is empty")
    }
    trace?.mark("receipt.textract.asset_fetch.complete", {
      source: "originalStoragePath",
      receiptAssetId: asset.id,
      sizeBytes: buffer.length,
    })
    return buffer
  }

  if (originalDownloadUrl) {
    trace?.mark("receipt.textract.asset_fetch.begin", {
      source: "originalDownloadUrl",
      receiptAssetId: asset.id,
      host: new URL(originalDownloadUrl).host,
    })
    const response = await fetch(originalDownloadUrl)
    if (!response.ok) {
      throw new BadRequestError(`Unable to fetch receipt asset bytes: HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) {
      throw new BadRequestError("Receipt asset is empty")
    }
    trace?.mark("receipt.textract.asset_fetch.complete", {
      source: "originalDownloadUrl",
      receiptAssetId: asset.id,
      sizeBytes: buffer.length,
    })
    return buffer
  }

  throw new BadRequestError("Receipt asset has no accessible storage location")
}

function getSecretValue(secret: { value: () => string }, name: string): string {
  const value = secret.value()
  if (!value) {
    throw new BadRequestError(`${name} is not configured`)
  }
  return value
}

export async function analyzeReceiptWithTextract(
  asset: ReceiptAsset,
  trace?: BackendProfileTrace
): Promise<TextractAnalyzeExpenseResponse> {
  const accessKeyId = getSecretValue(AWS_TEXTRACT_ACCESS_KEY_ID, "AWS_TEXTRACT_ACCESS_KEY_ID")
  const secretAccessKey = getSecretValue(
    AWS_TEXTRACT_SECRET_ACCESS_KEY,
    "AWS_TEXTRACT_SECRET_ACCESS_KEY"
  )
  const region = getSecretValue(AWS_TEXTRACT_REGION, "AWS_TEXTRACT_REGION")
  trace?.mark("receipt.textract.config_loaded", {
    receiptAssetId: asset.id,
    region,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  })

  const bytes = await loadAssetBytes(asset, trace)
  const body = JSON.stringify({
    Document: {
      Bytes: bytes.toString("base64"),
    },
  })
  trace?.mark("receipt.textract.request_prepared", {
    receiptAssetId: asset.id,
    region,
    sourceBytes: bytes.length,
    requestBodyBytes: Buffer.byteLength(body),
  })

  const host = `textract.${region}.amazonaws.com`
  const endpoint = `https://${host}/`
  const contentType = "application/x-amz-json-1.1"
  const target = "Textract.AnalyzeExpense"
  const { amzDate, dateStamp } = getAmzDate()

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
  ]
    .sort()
    .join("\n")

  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    "x-amz-target",
  ]
    .sort()
    .join(";")

  const canonicalRequest = [
    "POST",
    "/",
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    sha256Hex(body),
  ].join("\n")

  const credentialScope = `${dateStamp}/${region}/textract/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, "textract")
  const kSigning = hmac(kService, "aws4_request")
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex")

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ")

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-amz-date": amzDate,
      "x-amz-target": target,
      Authorization: authorization,
    },
    body,
  })
  trace?.mark("receipt.textract.response_received", {
    receiptAssetId: asset.id,
    region,
    status: response.status,
    ok: response.ok,
  })

  const rawText = await response.text().catch(() => "")
  let payload: TextractErrorPayload = {}
  if (rawText) {
    payload = JSON.parse(rawText) as TextractErrorPayload
  }

  if (!response.ok) {
    const headerErrorType = response.headers.get("x-amzn-errortype")
    const detail =
      payload.Message ??
      payload.message ??
      headerErrorType ??
      payload.__type ??
      (rawText || undefined) ??
      String(response.status)

    throw new BadRequestError(
      `Textract AnalyzeExpense failed: ${detail}`,
      {
        status: response.status,
        errorType: headerErrorType ?? payload.__type ?? null,
        region,
        receiptAssetId: asset.id,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      }
    )
  }

  const successPayload = payload as TextractAnalyzeExpenseResponse
  trace?.mark("receipt.textract.response_parsed", {
    receiptAssetId: asset.id,
    region,
    expenseDocumentCount: successPayload.ExpenseDocuments?.length ?? 0,
    hasDocumentMetadata: Boolean(successPayload.DocumentMetadata),
  })

  return successPayload
}
