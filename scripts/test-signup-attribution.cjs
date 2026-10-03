require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Stub ../admin (firebase-admin needs real credentials) with an in-memory
// Firestore/Auth just big enough for routes/signup.ts.
// ---------------------------------------------------------------------------
const writes = [];
const existingDocs = new Set();

function makeRef(docPath) {
  return {
    path: docPath,
    get: async () => ({ exists: existingDocs.has(docPath) }),
    collection: (name) => ({ doc: (id) => makeRef(`${docPath}/${name}/${id}`) }),
  };
}

const fakeAdmin = {
  auth: {
    verifyIdToken: async () => ({ uid: "user-123", email: "person@example.com" }),
  },
  db: {
    collection: (name) => ({ doc: (id) => makeRef(`${name}/${id}`) }),
    batch: () => {
      const pending = [];
      return {
        set: (ref, data, options) => pending.push({ path: ref.path, data, options }),
        commit: async () => {
          writes.push(...pending);
        },
      };
    },
  },
};

const adminPath = path.join(__dirname, "../backend/functions/src/admin.ts");
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin };

const {
  buildContentLogPayload,
  buildContentLogRow,
  parseSignupAttribution,
  postContentLogRow,
} = require("../backend/functions/src/lib/signupAttribution.ts");
const { signupHandler } = require("../backend/functions/src/routes/signup.ts");

const CONTENT_LOG_FIELDS = [
  "secret",
  "signup_date",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "survey_answer",
  "plan",
].sort();

const validLegalConsent = {
  version: "2026-04-27",
  termsVersion: "2026-04-27",
  privacyVersion: "2026-09-06",
  acceptedAt: "2026-10-02T12:00:00.000Z",
  userAgent: "test-agent",
  source: "web-signup",
};

function makeReq(body) {
  return { method: "POST", body, get: () => null };
}

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function callSignup(extraBody) {
  writes.length = 0;
  const res = makeRes();
  await signupHandler(
    makeReq({
      idToken: "token",
      email: "person@example.com",
      phone: "(555) 123-4567",
      legalConsent: validLegalConsent,
      ...extraBody,
    }),
    res
  );
  return {
    res,
    user: writes.find((write) => write.path === "users/user-123"),
    queued: writes.find((write) => write.path === "contentLogSignups/user-123"),
  };
}

function jsonResponse(status) {
  return { ok: status >= 200 && status < 300, status };
}

async function run(name, fn) {
  await fn();
  process.stdout.write(`ok - ${name}\n`);
}

(async () => {
  // -------------------------------------------------------------------------
  // Attribution parsing
  // -------------------------------------------------------------------------
  await run("parses, trims, and caps UTM values at 100 characters", () => {
    const attribution = parseSignupAttribution({
      utm_source: "  facebook  ",
      utm_medium: "social",
      utm_campaign: "c".repeat(250),
      utm_content: "   ",
    });
    assert.equal(attribution.utm_source, "facebook");
    assert.equal(attribution.utm_campaign.length, 100);
    assert.equal(attribution.utm_content, null);
    assert.equal(attribution.signup_platform, "web");
  });

  await run("drops malformed UTM values instead of failing", () => {
    const attribution = parseSignupAttribution({
      utm_source: { nested: true },
      utm_medium: 42,
      signup_platform: "android",
    });
    assert.equal(attribution.utm_source, null);
    assert.equal(attribution.utm_medium, null);
    assert.equal(attribution.signup_platform, "web");
    assert.equal(parseSignupAttribution({ signup_platform: "ios" }).signup_platform, "ios");
  });

  // -------------------------------------------------------------------------
  // Content Log row/payload
  // -------------------------------------------------------------------------
  await run("a web signup with no UTMs reports utm_source=direct", () => {
    const row = buildContentLogRow(parseSignupAttribution({}), null, new Date("2026-10-02T23:00:00Z"));
    assert.deepEqual(row, {
      signup_date: "2026-10-02",
      utm_source: "direct",
      utm_medium: "",
      utm_campaign: "",
      utm_content: "",
      survey_answer: "",
      plan: "",
    });
  });

  await run("an iOS signup with no UTMs reports utm_source=ios_app", () => {
    const row = buildContentLogRow(
      parseSignupAttribution({ signup_platform: "ios" }),
      "hybrid_plus",
      new Date("2026-10-02T12:00:00Z")
    );
    assert.equal(row.utm_source, "ios_app");
    assert.equal(row.plan, "Hybrid");
  });

  await run("UTM rows keep their source and map plan labels", () => {
    const row = buildContentLogRow(
      parseSignupAttribution({ utm_medium: "bio", utm_campaign: "bio-2026-10-02" }),
      "w2_basic",
      new Date("2026-10-02T12:00:00Z")
    );
    assert.equal(row.utm_source, "", "UTMs present but no source → empty, not 'direct'");
    assert.equal(row.utm_medium, "bio");
    assert.equal(row.plan, "W2 Free");
    assert.equal(buildContentLogRow(parseSignupAttribution({}), "bogus", new Date()).plan, "");
  });

  await run("the webhook payload has exactly the listed fields and no personal data", () => {
    const payload = buildContentLogPayload(
      {
        signup_date: "2026-10-02",
        utm_source: "facebook",
        // Extra fields must never pass through.
        email: "person@example.com",
        uid: "user-123",
      },
      "s3cret"
    );
    assert.deepEqual(Object.keys(payload).sort(), CONTENT_LOG_FIELDS);
    assert.equal(payload.secret, "s3cret");
    assert.equal(payload.survey_answer, "");
    assert.ok(!JSON.stringify(payload).includes("person@example.com"));
    assert.ok(!JSON.stringify(payload).includes("user-123"));
  });

  // -------------------------------------------------------------------------
  // Webhook delivery
  // -------------------------------------------------------------------------
  await run("skips quietly when CONTENT_LOG_WEBHOOK_URL is unset", async () => {
    let called = false;
    const result = await postContentLogRow({
      url: undefined,
      secret: "s3cret",
      row: {},
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200);
      },
    });
    assert.equal(result.status, "skipped");
    assert.equal(called, false);
  });

  await run("posts JSON with the secret and follows redirects", async () => {
    let request;
    const result = await postContentLogRow({
      url: "https://script.google.com/macros/s/x/exec",
      secret: "s3cret",
      row: { signup_date: "2026-10-02", utm_source: "tiktok" },
      fetchImpl: async (url, init) => {
        request = { url, init };
        return jsonResponse(200);
      },
    });
    assert.equal(result.status, "sent");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.redirect, "follow");
    const body = JSON.parse(request.init.body);
    assert.deepEqual(Object.keys(body).sort(), CONTENT_LOG_FIELDS);
    assert.equal(body.utm_source, "tiktok");
  });

  await run("reports (never throws) when the webhook errors", async () => {
    const httpFailure = await postContentLogRow({
      url: "https://example.test/hook",
      secret: "s",
      row: {},
      fetchImpl: async () => jsonResponse(500),
    });
    assert.equal(httpFailure.status, "failed");

    const networkFailure = await postContentLogRow({
      url: "https://example.test/hook",
      secret: "s",
      row: {},
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    assert.deepEqual(networkFailure, { status: "failed", error: "ECONNRESET" });
  });

  await run("gives up on a hung webhook after the timeout", async () => {
    const started = Date.now();
    const result = await postContentLogRow({
      url: "https://example.test/hook",
      secret: "s",
      row: {},
      timeoutMs: 50,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    });
    assert.equal(result.status, "failed");
    assert.ok(Date.now() - started < 2000);
  });

  // -------------------------------------------------------------------------
  // Signup route
  // -------------------------------------------------------------------------
  await run("signup stores trimmed UTM fields on the new user", async () => {
    existingDocs.clear();
    const { res, user, queued } = await callSignup({
      utm_source: "facebook",
      utm_medium: "social",
      utm_campaign: `TEST-W2${"x".repeat(200)}`,
      signup_platform: "web",
      plan: "independent_basic",
    });

    assert.equal(res.statusCode, 200);
    assert.equal(user.data.utm_source, "facebook");
    assert.equal(user.data.utm_medium, "social");
    assert.equal(user.data.utm_campaign.length, 100);
    assert.equal(user.data.utm_content, null);
    assert.equal(user.data.signup_platform, "web");

    // The queued Content Log row carries no personal data.
    assert.equal(queued.data.row.utm_source, "facebook");
    assert.equal(queued.data.row.plan, "Independent");
    assert.ok(!JSON.stringify(queued.data.row).includes("person@example.com"));
    assert.ok(!JSON.stringify(queued.data.row).includes("user-123"));
  });

  await run("signup without UTMs still succeeds and queues a direct/ios_app row", async () => {
    existingDocs.clear();
    const web = await callSignup({});
    assert.equal(web.res.statusCode, 200);
    assert.equal(web.user.data.utm_source, null);
    assert.equal(web.user.data.signup_platform, "web");
    assert.equal(web.queued.data.row.utm_source, "direct");

    const ios = await callSignup({ signup_platform: "ios" });
    assert.equal(ios.user.data.signup_platform, "ios");
    assert.equal(ios.queued.data.row.utm_source, "ios_app");
  });

  await run("signup with malformed attribution still succeeds", async () => {
    existingDocs.clear();
    const { res, user } = await callSignup({ utm_source: ["a"], plan: 7 });
    assert.equal(res.statusCode, 200);
    assert.equal(user.data.utm_source, null);
  });

  await run("attribution is never written for an existing user", async () => {
    existingDocs.clear();
    existingDocs.add("users/user-123");
    const { res, user, queued } = await callSignup({ utm_source: "tiktok", signup_platform: "ios" });
    assert.equal(res.statusCode, 200);
    assert.equal("utm_source" in user.data, false);
    assert.equal("signup_platform" in user.data, false);
    assert.equal(queued, undefined);
  });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
