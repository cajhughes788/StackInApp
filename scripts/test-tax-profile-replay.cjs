require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
})

const assert = require("node:assert/strict")
const path = require("node:path")
const Module = require("node:module")

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolveFilename(
  request,
  parent,
  isMain,
  options
) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = path.join(process.cwd(), "frontend", request.slice(2))
  }
  if (typeof request === "string" && request.startsWith("@shared/")) {
    request = path.join(process.cwd(), "shared", request.slice("@shared/".length))
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

const { ApiError } = require("../frontend/lib/api/core/errors.ts")
const {
  getTaxProfileReplayFailureFeedback,
} = require("../frontend/lib/domain/taxProfileService.ts")

function testReplayFailureFeedback() {
  assert.deepEqual(
    getTaxProfileReplayFailureFeedback(new ApiError("auth", { status: 401 })),
    {
      title: "Tax profile needs attention",
      description:
        "A queued tax profile change could not sync because your session needs attention. Sign in again, then review your tax profile.",
    }
  )

  assert.deepEqual(
    getTaxProfileReplayFailureFeedback(new ApiError("validation", { status: 400 })),
    {
      title: "Tax profile needs attention",
      description:
        "A queued tax profile change is no longer valid. Review your tax profile and save again.",
    }
  )

  assert.deepEqual(
    getTaxProfileReplayFailureFeedback(new ApiError("conflict", { status: 409 })),
    {
      title: "Tax profile needs attention",
      description:
        "A queued tax profile change conflicted with newer tax data. Review your tax profile and save again.",
    }
  )

  assert.deepEqual(
    getTaxProfileReplayFailureFeedback(new Error("boom")),
    {
      title: "Tax profile needs attention",
      description:
        "A queued tax profile change could not be synced. Review your tax profile and try again.",
    }
  )
}

testReplayFailureFeedback()

console.log("tax profile replay checks passed")
