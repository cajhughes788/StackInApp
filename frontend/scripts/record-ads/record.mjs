// Drives the real StackIn web app with Playwright to record raw ad-footage
// for the W-2 tip-tracking flow and the Independent income/P&L flow.
//
// Usage:
//   1. npm run dev            (in another terminal — app must be serving on STACKIN_APP_URL)
//   2. cp .env.recording.example .env.recording   (fill in real credentials)
//   3. npm run plan:ads       (generates ad-footage/plan.json — data + narration + timing)
//   4. npm run record:ads
//
// Output: frontend/ad-footage/<random>.webm + ad-footage/markers.json
// Run `npm run cut:ads` afterward to slice the master recording into
// per-moment clips using the markers.

import { chromium, devices } from "@playwright/test";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import {
  OUT_DIR,
  loadState,
  saveState,
  todayMinusDays,
} from "./lib/period-helpers.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.recording") });

const {
  STACKIN_DEMO_EMAIL,
  STACKIN_DEMO_PASSWORD,
  STACKIN_APP_URL = "http://localhost:3000",
  STACKIN_DEMO_W2_WORKSPACE = "Ad Demo (W-2)",
  STACKIN_DEMO_INDEPENDENT_WORKSPACE = "Ad Demo (Independent)",
  RECEIPT_IMAGE_PATH,
} = process.env;

if (!STACKIN_DEMO_EMAIL || !STACKIN_DEMO_PASSWORD) {
  console.error(
    "Missing STACKIN_DEMO_EMAIL / STACKIN_DEMO_PASSWORD.\n" +
      "Copy .env.recording.example to .env.recording and fill in real values."
  );
  process.exit(1);
}

const PLAN_PATH = path.join(OUT_DIR, "plan.json");
if (!fs.existsSync(PLAN_PATH)) {
  console.error(`Missing ${PLAN_PATH}. Run \`npm run plan:ads\` first.`);
  process.exit(1);
}
const PLAN = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));

/** Every "Loading ...…" / "Loading ...." placeholder across the app
 * (IncomeGauge's "Loading pay summary…", EntriesGrid's "Loading your
 * entries…" / "Loading settings…", ExpensesGrid's "Loading expenses…",
 * etc.) matches this one pattern — general on purpose, so it also
 * covers any future loading state without needing the list updated. */
const LOADING_PATTERN = /Loading [^\n]*?(…|\.\.\.)/;

async function waitForLoadingToClear(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!LOADING_PATTERN.test(bodyText)) return;
    await page.waitForTimeout(200);
  }
  console.warn("[warn] loading indicators still present after timeout — continuing anyway");
}

const startedAt = Date.now();
const markers = [];
/** Every mark() waits for loading placeholders to clear first — a mark
 * is always the START of the NEXT clip once cut, so this guarantees no
 * clip ever opens on a spinner/loading-text frame, without needing to
 * remember this at each call site. */
async function mark(page, label) {
  await waitForLoadingToClear(page);
  const t = (Date.now() - startedAt) / 1000;
  markers.push({ label, t });
  console.log(`[mark] ${label} @ ${t.toFixed(2)}s`);
}

/** Polls page.url() until it matches one of `patterns` and stays stable
 * for `stableMs` — the app's post-login/post-save redirect chain hops
 * through several routes before settling. */
async function waitForSettledUrl(page, patterns, { timeout = 20000, stableMs = 500 } = {}) {
  const start = Date.now();
  let lastUrl = null;
  let stableSince = null;
  while (Date.now() - start < timeout) {
    const url = page.url();
    if (patterns.some((p) => p.test(url))) {
      if (url === lastUrl) {
        if (stableSince && Date.now() - stableSince >= stableMs) return url;
        if (!stableSince) stableSince = Date.now();
      } else {
        lastUrl = url;
        stableSince = Date.now();
      }
    } else {
      lastUrl = null;
      stableSince = null;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(
    `Timed out waiting for URL to settle on one of: ${patterns.map(String).join(", ")} (last seen: ${page.url()})`
  );
}

/** .fill() snaps a value in instantly — fine for setup steps, but the
 * hero "watch a number get entered" shots need it to look like someone
 * is actually typing. Clears first since pressSequentially inserts at
 * the cursor rather than replacing existing content. */
async function typeInto(locator, value, delay = 80) {
  await locator.fill("");
  await locator.pressSequentially(String(value), { delay });
}

/** IndependentSettings.tsx toggles have no id/htmlFor pairing — scope by
 * the row div's visible text instead of getByLabel. */
async function toggleSettingsRow(page, labelText) {
  await page
    .locator("div.flex.items-center.justify-between", { hasText: labelText })
    .first()
    .getByRole("switch")
    .click();
}

async function login(page) {
  await page.goto(`${STACKIN_APP_URL}/login`);
  await page.locator("#email").fill(STACKIN_DEMO_EMAIL);
  await page.locator("#password").fill(STACKIN_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();
  await waitForSettledUrl(page, [/\/app\/home/, /\/welcome/, /\/app\/settings/]);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Switches to an existing workspace by name if one exists, without
 * creating anything. Returns true if it found and switched to it. */
async function switchToWorkspaceIfExists(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Open workspace switcher" }).click();
  const item = page.getByRole("menuitem", { name: new RegExp(`^${escapeRegExp(name)}`) });
  if ((await item.count()) === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.first().click();
  // Lands on /app/home, but the app itself immediately redirects to
  // /app/settings if that workspace's settings were never finished.
  await waitForSettledUrl(page, [/\/app\/home/, /\/app\/settings/]);
  return true;
}

/** Creates the named workspace only if it doesn't already exist —
 * running this script twice must never produce duplicate workspaces.
 * Returns { needsSettings } — true if the workspace (new OR reused)
 * still needs its settings configured. A reused workspace can still
 * need this if a prior run created it but crashed before finishing
 * setup: home/page.tsx redirects such a workspace to /app/settings
 * (settings === null), which is what needsSettings detects. */
async function ensureWorkspace(page, name, typeButtonText) {
  if (/\/app\/home/.test(page.url()) && (await switchToWorkspaceIfExists(page, name))) {
    console.log(`[debug] reusing existing workspace "${name}"`);
    // Give the app's own home->settings redirect (for incomplete
    // settings) a moment to fire before checking where we landed.
    await page.waitForTimeout(1500);
    return { needsSettings: /\/app\/settings/.test(page.url()) };
  }
  await createWorkspace(page, name, typeButtonText);
  return { needsSettings: true };
}

async function ensureOnWorkspaceCreationForm(page) {
  if (!/\/welcome/.test(page.url())) {
    await page.goto(`${STACKIN_APP_URL}/welcome?mode=add-workspace`);
  }
  await page.getByPlaceholder("e.g. Main Job, Freelance, Barber Shop").waitFor({ state: "visible" });
}

async function createWorkspace(page, name, typeButtonText) {
  await ensureOnWorkspaceCreationForm(page);
  await page.getByPlaceholder("e.g. Main Job, Freelance, Barber Shop").fill(name);

  // Only clickable if the account is entitled to more than one workspace
  // type; otherwise the type is pre-locked and shown as static text.
  const typeButton = page.getByRole("button", { name: typeButtonText, exact: true });
  if (await typeButton.count()) {
    await typeButton.click();
  }

  await page.getByRole("button", { name: /Create Workspace|Add Workspace/ }).click();
  await waitForSettledUrl(page, [/\/app\/settings\?.*setup=1/]);
  console.log(`[debug] settings URL: ${page.url()}`);

  // The settings page shows a "Preparing your new workspace..." spinner
  // until the workspace store's activeWorkspaceId catches up with the
  // just-created workspace — wait it out before touching any fields.
  // Occasionally that client-side sync just stalls; a reload forces the
  // app to refetch the workspace list fresh and self-recovers.
  const spinner = page.getByText("Preparing your new workspace...");
  for (let i = 0; i < 8; i++) {
    if (!(await spinner.isVisible().catch(() => false))) break;
    console.log(`[debug] still preparing workspace... (${i * 5}s)`);
    await page.waitForTimeout(5000);
  }
  if (await spinner.isVisible().catch(() => false)) {
    console.log("[debug] spinner stalled after 40s — reloading to force a resync");
    await page.reload();
    for (let i = 0; i < 6; i++) {
      if (!(await spinner.isVisible().catch(() => false))) break;
      console.log(`[debug] still preparing workspace after reload... (${i * 5}s)`);
      await page.waitForTimeout(5000);
    }
  }
  if (await spinner.isVisible().catch(() => false)) {
    console.log("[debug] spinner never cleared — dumping visible page text");
    console.log(await page.locator("body").innerText());
  }
}

async function configureW2Settings(page) {
  await page.getByLabel("Do you have hourly income?", { exact: true }).click();
  await page.locator("#defaultHourlyRate").fill("18.50");

  const hourModeSection = page.locator("div", { hasText: "Hour Input Mode" }).last();
  await hourModeSection.getByRole("combobox").click();
  await page.getByRole("option", { name: "Enter hours manually" }).click();

  await page.getByLabel("Do you have tip income?", { exact: true }).click();
  await page.getByLabel("Credit Card Tips", { exact: true }).click();
  await page.getByLabel("Reported Cash", { exact: true }).click();
  await page.getByLabel("Unreported Cash", { exact: true }).click();

  await page.getByLabel("Pay Frequency", { exact: true }).click();
  await page.getByRole("option", { name: "Weekly", exact: true }).click();
  const w2AnchorDate = todayMinusDays(6);
  await page.getByLabel("Pay Period Start Date", { exact: true }).fill(w2AnchorDate);

  await page.getByRole("button", { name: "Save and Continue to Home" }).click();
  await waitForSettledUrl(page, [/\/app\/home/]);
  // Persisted so future runs (which reuse this workspace and skip this
  // setup) can compute the current period's boundaries and keep random
  // shift dates from landing outside it.
  saveState({ w2PayPeriodAnchor: w2AnchorDate });
}

/** Workspaces configured before this anchor-persistence existed have no
 * recorded w2PayPeriodAnchor — scrape it once from the settings page
 * (read-only, no changes saved) so date randomization can stay inside
 * the current pay period without re-running full setup. */
async function backfillW2AnchorIfMissing(page) {
  if (loadState().w2PayPeriodAnchor) return;
  await page.goto(`${STACKIN_APP_URL}/app/settings`);
  const anchor = await page.getByLabel("Pay Period Start Date", { exact: true }).inputValue();
  if (anchor) saveState({ w2PayPeriodAnchor: anchor });
  await page.goto(`${STACKIN_APP_URL}/app/home`);
}

async function configureIndependentSettings(page) {
  await toggleSettingsRow(page, "Track Hours");
  await toggleSettingsRow(page, "Venmo");
  await toggleSettingsRow(page, "POS Sales");
  await toggleSettingsRow(page, "Cash Sales");

  await page.getByRole("button", { name: "Save and Continue to Home" }).click();
  await waitForSettledUrl(page, [/\/app\/home/]);
}

/** Snapshot of each row's text in a grid's <tbody> (excludes the
 * <tfoot> totals row) — call this before submitting a new entry, then
 * pass the result to revealGrid so it can tell which row is new. Rows
 * are keyed by React `key={entry.id}`, not exposed as a DOM attribute,
 * so text-content diffing is the reliable general-purpose way to spot
 * the new one regardless of sort order. */
async function snapshotRows(page, selector) {
  const grid = page.locator(selector);
  await grid.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const rows = grid.locator("tbody tr");
  // The grid can still be mid-hydration (Firestore fetch in flight)
  // right after a workspace switch — snapshotting too early would make
  // already-existing rows look "new" once they finish loading a moment
  // later. Poll until the row count stops changing.
  let prevCount = -1;
  for (let i = 0; i < 10; i++) {
    const count = await rows.count().catch(() => 0);
    if (count === prevCount) break;
    prevCount = count;
    await page.waitForTimeout(300);
  }
  return rows.allTextContents().catch(() => []);
}

/** Scrolls the given grid into view and holds there so the cut always
 * ends on visual proof the new row landed, not on the form collapsing —
 * otherwise the clip cuts away before the viewer ever sees the update.
 * If `beforeRows` (from snapshotRows, taken before the submit) is
 * given, rows not present in that snapshot get a highlight so it's
 * obvious at a glance what's new. Then scrolls back up to hold on the
 * gauge/summary card at the top of the page.
 *
 * `sceneStart` + `targetDuration` (from the plan's measured narration
 * length) size the total hold so the scene's on-screen duration fills
 * however long the narration actually takes to say — the hold, split
 * between grid and gauge, absorbs whatever's left after the real typing
 * time already spent, rather than a fixed guess. */
async function revealGrid(page, selector, { beforeRows = null, sceneStart = null, targetDuration = null } = {}) {
  const grid = page.locator(selector);
  await grid.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await grid.scrollIntoViewIfNeeded().catch(() => {});

  if (beforeRows) {
    // Amber, not the app's own green — StackIn's UI is green almost
    // everywhere (borders, buttons, accents), so a green highlight is
    // invisible against it. Inline styles on each <td> (not just the
    // <tr>) since several cells set their own opaque background class
    // (e.g. the sticky date column) that would otherwise cover it.
    await page
      .evaluate(
        ({ sel, before }) => {
          const rows = Array.from(document.querySelectorAll(`${sel} tbody tr`));
          for (const row of rows) {
            if (before.includes(row.textContent)) continue;
            row.style.outline = "3px solid #f59e0b";
            row.style.outlineOffset = "-2px";
            row.style.position = "relative";
            row.style.zIndex = "5";
            for (const cell of row.querySelectorAll("td")) {
              cell.style.backgroundColor = "rgba(245, 158, 11, 0.4)";
            }
          }
        },
        { sel: selector, before: beforeRows }
      )
      .catch(() => {});
  }

  let remainingMs = 3000;
  if (sceneStart != null && targetDuration != null) {
    const elapsed = Date.now() - sceneStart;
    remainingMs = Math.max(1800, targetDuration * 1000 - elapsed);
  }
  const gridHold = Math.round(remainingMs / 2);
  const gaugeHold = remainingMs - gridHold;

  await page.waitForTimeout(gridHold);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(gaugeHold);
}

async function logW2Shift(page, { date, rate, hours, tips, reportedCash, unreportedCash, targetDuration }) {
  const sceneStart = Date.now();
  const beforeRows = await snapshotRows(page, '[data-entries-grid-root="true"]');
  await page.getByRole("button", { name: "Expand entry form" }).click();
  await page.waitForTimeout(600); // let the form finish opening before typing
  if (date) await page.locator("#date").fill(date);
  await typeInto(page.locator("#rate"), rate);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#hours"), hours);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#tips"), tips);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#reportedCash"), reportedCash);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#unreportedCash"), unreportedCash);
  await page.waitForTimeout(900); // hold on the filled-in form before submitting
  await page.getByRole("button", { name: "Add Entry" }).click();
  await page
    .getByRole("button", { name: "Expand entry form" })
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => console.warn("[warn] entry form did not collapse after submit — check for a validation alert"));
  await revealGrid(page, '[data-entries-grid-root="true"]', { beforeRows, sceneStart, targetDuration });
}

/** The /app/earnings pay-stub view is populated by a backend job
 * (payStubs generation) that a fresh demo workspace won't have run yet —
 * it can't be triggered from the browser. Use the Home page's own
 * entries grid as the "see your real numbers" payoff shot instead. */
async function viewHomeEntriesGrid(page, { targetDuration = null } = {}) {
  const sceneStart = Date.now();
  if (!/\/app\/home/.test(page.url())) {
    await page.goto(`${STACKIN_APP_URL}/app/home`);
  }
  const elapsed = Date.now() - sceneStart;
  const holdMs = targetDuration != null ? Math.max(1200, targetDuration * 1000 - elapsed) : 2000;
  await page.waitForTimeout(holdMs);
}

/** Fills one income channel field. The category-split panel that
 * appears auto-selects "Services" with the full amount by default
 * (rebalanceBreakdownDraft in lib/incomeBreakdown.ts) — no click
 * needed, and clicking it would toggle it back OFF. */
async function fillBreakdownChannel(page, field, label, amount) {
  await typeInto(page.locator(`#${field}`), amount);
  const header = page.getByText(`Split ${label} into categories`, { exact: true });
  await header.waitFor({ state: "visible" });
  await page.locator(`#${field}-services`).waitFor({ state: "visible" });
}

async function logIndependentIncome(page, { date, venmo, posSales, cashSales, targetDuration }) {
  const sceneStart = Date.now();
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.waitForTimeout(500);
  // Snapshot only after the Income tab (and its grid) is actually
  // showing — snapshotting before this would target a grid that isn't
  // even in the DOM yet if we arrived on a different tab.
  const beforeRows = await snapshotRows(page, '[data-entries-grid-root="true"]');
  await page.getByRole("button", { name: "Expand entry form" }).click();
  await page.waitForTimeout(600); // let the form finish opening before typing
  if (date) await page.locator("#date").fill(date);
  if (venmo) {
    await fillBreakdownChannel(page, "venmo", "Venmo", venmo);
    await page.waitForTimeout(700);
  }
  if (posSales) {
    await fillBreakdownChannel(page, "posSales", "POS Sales", posSales);
    await page.waitForTimeout(700);
  }
  if (cashSales) {
    await fillBreakdownChannel(page, "cashSales", "Cash Sales", cashSales);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(900); // hold on the filled-in form before submitting
  await page.getByRole("button", { name: "Add Entry" }).click();
  await page
    .getByRole("button", { name: "Expand entry form" })
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => console.warn("[warn] entry form did not collapse after submit — check for a validation alert"));
  await revealGrid(page, '[data-entries-grid-root="true"]', { beforeRows, sceneStart, targetDuration });
}

async function addExpense(page, { date, amount, vendor, description, category, receiptPath, targetDuration }) {
  const sceneStart = Date.now();
  await page.getByRole("button", { name: "Expenses", exact: true }).click();
  await page.waitForTimeout(500);
  // Snapshot only after the Expenses tab (and its grid) is actually
  // showing — snapshotting before this would target a grid that isn't
  // even in the DOM yet while still on the Income tab.
  const beforeRows = await snapshotRows(page, '[data-expenses-grid-root="true"]');
  await page.getByRole("button", { name: "Expand expense form" }).click();
  await page.waitForTimeout(600); // let the form finish opening before typing

  if (receiptPath && fs.existsSync(receiptPath)) {
    // Works on the hidden <input type="file"> without needing to click
    // the visible "Choose Image" button first.
    await page.locator('input[type="file"]').setInputFiles(receiptPath);
    await page.waitForTimeout(1500);
  }

  if (date) await page.locator("#date").fill(date);

  await page.getByText("Choose an expense category").click();
  // The dialog's open animation can still be settling when we click —
  // this pause is both pacing and a stability fix (avoids the category
  // button shifting under the cursor mid-click).
  await page.waitForTimeout(500);
  await page.getByRole("dialog").getByText(category, { exact: true }).click();
  await page.waitForTimeout(500);

  await typeInto(page.locator("#amount"), amount);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#vendor"), vendor);
  await page.waitForTimeout(300);
  await typeInto(page.locator("#description"), description);

  await page.waitForTimeout(900); // hold on the filled-in form before submitting
  await page.getByRole("button", { name: "Add Expense" }).click();
  await page
    .getByRole("button", { name: "Expand expense form" })
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => console.warn("[warn] expense form did not collapse after submit — check for a validation alert"));
  await revealGrid(page, '[data-expenses-grid-root="true"]', { beforeRows, sceneStart, targetDuration });
}

/** /app/profitloss statements are generated by a backend trigger on
 * entry/expense writes with unpredictable latency (observed anywhere
 * from "ready after several unrelated runs" to "still loading after
 * 20s") — not reliable for a scripted one-shot recording. Same
 * reasoning as the W-2 pay-stub view: use the Home page's live
 * income/expense gauge + grid as the payoff shot instead. */
async function viewIndependentHomeSummary(page, { targetDuration = null } = {}) {
  const sceneStart = Date.now();
  if (!/\/app\/home/.test(page.url())) {
    await page.goto(`${STACKIN_APP_URL}/app/home`);
  }
  await page.getByRole("button", { name: "Expenses", exact: true }).click();
  const elapsed = Date.now() - sceneStart;
  const holdMs = targetDuration != null ? Math.max(1200, targetDuration * 1000 - elapsed) : 2000;
  await page.waitForTimeout(holdMs);
}

async function recordW2(page, w2Plan) {
  const w2Workspace = await ensureWorkspace(page, STACKIN_DEMO_W2_WORKSPACE, "W-2 / Hourly");
  if (w2Workspace.needsSettings) {
    await configureW2Settings(page);
  } else {
    await backfillW2AnchorIfMissing(page);
  }
  await mark(page, "w2-workspace-ready");

  const shift1 = w2Plan.scenes["w2-shift-1-logged"];
  await logW2Shift(page, { ...shift1.data, targetDuration: shift1.narrationDuration });
  await mark(page, "w2-shift-1-logged");

  const shift2 = w2Plan.scenes["w2-shift-2-logged"];
  await logW2Shift(page, { ...shift2.data, targetDuration: shift2.narrationDuration });
  await mark(page, "w2-shift-2-logged");

  const grid = w2Plan.scenes["w2-entries-grid-view"];
  await viewHomeEntriesGrid(page, { targetDuration: grid.narrationDuration });
  await mark(page, "w2-entries-grid-view");
}

async function recordIndependent(page, independentPlan) {
  const independentWorkspace = await ensureWorkspace(
    page,
    STACKIN_DEMO_INDEPENDENT_WORKSPACE,
    "Independent / Self-Employed"
  );
  if (independentWorkspace.needsSettings) {
    await configureIndependentSettings(page);
  }
  await mark(page, "independent-workspace-ready");

  const income = independentPlan.scenes["independent-income-logged"];
  await logIndependentIncome(page, { ...income.data, targetDuration: income.narrationDuration });
  await mark(page, "independent-income-logged");

  const expense = independentPlan.scenes["expense-logged"];
  await addExpense(page, { ...expense.data, receiptPath: RECEIPT_IMAGE_PATH, targetDuration: expense.narrationDuration });
  await mark(page, "expense-logged");

  const summary = independentPlan.scenes["independent-home-summary-view"];
  await viewIndependentHomeSummary(page, { targetDuration: summary.narrationDuration });
  await mark(page, "independent-home-summary-view");
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    recordVideo: { dir: OUT_DIR, size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", async (dialog) => {
    console.log(`[dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[console:${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("response", (res) => {
    if (!res.ok() && res.status() !== 304) {
      console.log(`[http ${res.status()}] ${res.url()}`);
    }
  });

  try {
    await login(page);
    await mark(page, "logged-in");

    {
      await page.evaluate(() => window.scrollTo(0, 0));
      const switcherButton = page.getByRole("button", { name: "Open workspace switcher" });
      await switcherButton.click();
      const items = await page.getByRole("menuitem").allTextContents();
      console.log(`[debug] existing workspaces (${items.length}): ${JSON.stringify(items)}`);
      await page.keyboard.press("Escape");
    }

    if (PLAN.w2) await recordW2(page, PLAN.w2);
    if (PLAN.independent) await recordIndependent(page, PLAN.independent);
  } catch (err) {
    console.error("Recording failed:", err);
    await page.screenshot({ path: path.join(OUT_DIR, "failure.png") }).catch(() => {});
    throw err;
  } finally {
    await context.close();
    await browser.close();
    fs.writeFileSync(path.join(OUT_DIR, "markers.json"), JSON.stringify(markers, null, 2));
    console.log(`\nDone. Video + markers.json written to ${OUT_DIR}`);
    console.log("Run `npm run cut:ads` to slice the recording into per-moment clips.");
  }
}

main();
