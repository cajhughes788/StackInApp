# Ad footage recorder

Drives the real app in a headless browser (Playwright) and records raw
screen video of the two core "aha moment" flows, for cutting into ad
creative:

- **W-2**: log two shifts (hourly rate + card/cash tips) → view the
  running Home page entries grid (day-by-day tips/hours/totals).
- **Independent**: log income across Venmo/POS/Cash channels, add an
  expense (with an optional receipt photo) → view the Home page's live
  income/expense gauge + grid.

Every run varies the data, the narration, and the captions — see
"Content diversity engine" below — so this isn't the same two videos on
repeat.

Note: both `/app/earnings` (pay stubs) and `/app/profitloss` (P&L
statements) are populated by backend generation jobs, not derived live
from entries — a fresh demo workspace won't have one ready in time for a
scripted recording (observed latency ranged from "ready after several
unrelated runs" to "still loading after 20s"), and triggering pay stubs
manually requires Firebase Admin credentials this script doesn't have.
Both flows use the Home page's live gauges/grids as their payoff shot
instead. If you want the real pay-stub or P&L view in footage, either
point the script at an existing workspace that already has them
generated from real usage, or wire up Admin credentials and call
`generatePayStub` the way `scripts/generate-current-paycheck.cjs` (repo
root) does — there's no equivalent script for P&L statements currently.

## One-time setup

1. `npm install` (installs `@playwright/test` + `dotenv`, already added to
   `devDependencies`) and `npx playwright install chromium` if you haven't
   already.
2. `cp .env.recording.example .env.recording` and fill in:
   - `STACKIN_DEMO_EMAIL` / `STACKIN_DEMO_PASSWORD` — an existing StackIn
     account with an **active subscription** (workspace creation is
     gated on this) and at least 2 free workspace slots.
   - Optionally `RECEIPT_IMAGE_PATH` — an absolute path to a real receipt
     photo. If omitted, the expense is logged with no attachment.
3. Make sure the app is actually running at `STACKIN_APP_URL`
   (default `http://localhost:3000`, i.e. `npm run dev` in another
   terminal).

**Never commit `.env.recording`** — it's already covered by the repo's
`.env.*` gitignore rule.

## Content diversity engine

Every run generates genuinely different footage — not just different
random numbers, but different narration/caption *phrasing* that actually
describes those numbers. This lives in `plan-ad.mjs` plus two library
modules:

- **`lib/narration-templates.mjs`** — a pool of narration/caption
  template *pairs* per scene "kind" (`w2-hook`, `w2-shift-2`,
  `w2-grid-payoff`, `w2-cta`, `independent-hook`, `expense-logged`,
  `independent-summary-payoff`, `independent-cta`). Each template is a
  function of the scene's actual data — `renderScene()` picks one
  variant per kind per run and interpolates the real randomized amounts
  in, so the line genuinely matches what's about to be typed on screen
  instead of a fixed caption playing over unrelated numbers. Add a new
  variant by appending a `{ narration, caption }` pair to the relevant
  array in that file — nothing else needs to change.
- **`plan-ad.mjs`** — orchestrates all of this *before* any recording
  happens: generates the data (dates/amounts, same period-safety rules
  as before), renders narration + caption text from the template pools,
  synthesizes each narration line via ElevenLabs, measures its **real**
  duration via `ffprobe`, and writes everything to `ad-footage/plan.json`
  (plus the `narration-*.mp3` files themselves). `record.mjs`,
  `caption-clips.mjs`, and `narrate-clips.mjs` all read from this one
  file rather than generating their own data or hardcoding copy.

**Why generate narration before recording, not after:** a narration
line needs "enough to say" to fill its scene without either cutting the
line off or leaving the video stretched by artificial slow-motion. The
right fix isn't changing voice speed after the fact — it's knowing how
long the line takes to actually say, and pacing the *visual* hold to
match, live, during recording. `revealGrid()` in `record.mjs` tracks
elapsed time since the scene started and holds on the grid/gauge for
however long is left to reach the plan's measured `narrationDuration` —
so for the payoff-only scenes (no typing, just a view+hold) the on
-screen duration matches the narration length exactly. For scenes with
real typing, if the narration line is *shorter* than the typing itself
naturally takes, the video simply runs a little past the narration
(trailing silence) rather than truncating anything — never cuts a line
off, per the same principle documented below in `narrate-clips.mjs`.

```
npm run plan:ads              # both audiences
npm run plan:ads -- w2        # one audience only (for daily-alternating use)
```

Run this **first**, before `record:ads` — everything downstream expects
`ad-footage/plan.json` to already exist.

## Running it

```
npm run record:ads
```

The first run creates two throwaway workspaces under your account ("Ad
Demo (W-2)" and "Ad Demo (Independent)" by default — rename via env
vars), so nothing from your real workspaces ends up in the recording.
Every run after that **reuses the same two workspaces** rather than
creating duplicates — no manual cleanup needed. Because of that, the
shift/income/expense data is randomized (dates, amounts, vendor) each
run instead of fixed values, so repeated runs build up what looks like a
natural multi-day history rather than identical duplicate rows. If you
want a truly pristine single-shift dataset for a specific recording,
delete the two workspaces once beforehand — but that's optional now, not
required.

Output goes to `ad-footage/` (gitignored):
- one `.webm` recording of the whole session
- `markers.json` — named timestamps for each milestone (shift logged,
  entries grid viewed, income logged, expense logged, etc.)
- `state.json` — the W-2 workspace's pay-period anchor date, so random
  shift dates can be kept inside the currently-displayed period across
  runs (see below)
- `failure.png` if the script threw partway through, for debugging

**Randomized dates are constrained to the currently-visible period.**
The Home page's entries/expenses grid only shows the CURRENT rolling
weekly pay period (W-2) or CURRENT calendar month (Independent) —
`shared/payPeriods.ts`. A date outside that window is saved successfully
but never appears anywhere in the UI, which looks exactly like "the
entry didn't register." `record.mjs` computes the real period boundary
(`currentWeeklyPeriodStartDaysAgo` / `currentMonthMaxDaysBack`) and only
randomizes within it — that's what `state.json`'s `w2PayPeriodAnchor` is
for, since the pay-period start date is set once and then persists
server-side across every future run that reuses the workspace.

Then:

```
npm run cut:ads
```

Slices the master recording into one clip per marker in
`ad-footage/clips/` (`.mp4` with a system `ffmpeg` on `PATH`, `.webm`
with Playwright's bundled fallback — see below).

```
npm run caption:ads
```

Composites a caption into the gray letterboxed band beneath the
recorded phone screen, for each scene that has a `caption` in
`ad-footage/plan.json` (generated by `plan:ads` — see "Content diversity
engine" above; nothing hardcoded here anymore). That gray band isn't app
content — the iPhone 13 device descriptor's real viewport is 390×664,
but `recordVideo.size` is 390×844, so Playwright pads the extra 180px at
the bottom with solid `rgb(126,126,126)`. Because that's outside the
live DOM, captions can't be injected into it during recording; instead
this renders each caption as its own PNG (Chromium, so real fonts/CSS,
matched to the exact band color so it looks native rather than pasted
on) and composites it onto that exact region with ffmpeg's `overlay`
filter — which only blends pixels, so it works without the font
-rendering support `drawtext` would need. The app UI itself, including
the `revealGrid()` highlight, is never touched.

```
npm run narrate:ads
```

Muxes the narration audio `plan-ads` already synthesized (and measured
the real duration of, before recording) into each clip — doesn't call
ElevenLabs itself, that already happened during planning specifically so
`record.mjs` could size each scene's pacing to match. This step's
`atempo`/`tpad` logic is now just a safety net for small drift between
the plan's estimate and what actually got recorded, not the primary
mechanism for matching lengths:
- up to 15% faster (`atempo`) absorbs small overruns without sounding sped up.
- beyond that, the clip's last frame is frozen (`tpad`) to extend it rather than cutting the line off.

**Needs a paid ElevenLabs plan.** The free tier blocks API access to
library voices entirely ("Free users cannot use library voices via the
API") — those same voices work fine in their web app, the block is API
-only. Any paid tier removes the restriction; check elevenlabs.io/pricing
for current plans/pricing rather than trusting a cached number here.
(OpenAI's TTS API was used briefly as a fallback while sorting this out
— no such restriction there, but it's billed separately from a ChatGPT
subscription, so a fresh key with no payment method gets
`insufficient_quota` until one's added. If ElevenLabs ever becomes
impractical, `ttsToMp3()` in `narrate-clips.mjs` would need rewriting
back to OpenAI's `/v1/audio/speech` endpoint — nothing's committed to
git yet, so there's no prior version to restore from, just the reasoning
above.)

The CTA's own `narration-cta-<ad>.mp3` was already produced by
`plan:ads` too (there's no clip for the CTA to mux into until `make:cta`
runs, so it just sits in `ad-footage/` until then).

**Important**: never add `-shortest` to the final mux command for the
per-scene clips. Video duration is the pre-tuned visual pacing and must
win — if narration is shorter, the video should play out with trailing
silence, not get truncated to match the shorter audio track. (Hit this
exactly once: it silently chopped several clips down to their narration
length before the `tpad`/`atempo` extension logic even mattered.)

```
npm run make:cta
```

Renders a branded CTA end-card (`public/icon-512.png` + headline +
download pill) in Chromium and turns it into one 3-second clip per ad —
`ad-footage/clips/cta-w2-ad.mp4` / `cta-independent-ad.mp4` — same visual,
different narration audio. If `narrate:ads` hasn't produced that ad's
`narration-cta-<ad>.mp3` yet, falls back to silent audio instead of
skipping the audio track entirely — every clip needs a consistent audio
stream for `assemble:ads`' `-c copy` concat to work, and a mix of
silent/narrated clips would still work but a mix of *no-audio-track* and
*has-audio-track* clips would not. Same reasoning as captions for the
text itself: rendered by the browser, not ffmpeg. Re-run any time you
want to change the CTA copy/design (edit the `html` template in
`make-cta.mjs`).

```
npm run assemble:ads
```

Concatenates the relevant clips (skipping login/settings) plus that ad's
own CTA card into one finished ad per audience in `ad-footage/roughcuts/`
— `w2-ad` and `independent-ad`.

**Requires a full ffmpeg**: `brew install ffmpeg`. Playwright's bundled
fallback can trim clips (`cut:ads`) but has no concat demuxer or overlay
filter, so `caption:ads`, `narrate:ads`, `make:cta`, and `assemble:ads`
all need the real one.

## Posting to Buffer

Buffer's `create_post` (via the Buffer MCP connector) needs a **public
URL** to the video — it can't take a local file. Upload the finished
`ad-footage/roughcuts/*.mp4` to Firebase Storage (or wherever you host
public assets) first, then call `create_post` with that URL as a
`video` asset and the target channel ID (`get_account` → `list_channels`
to find it). Not scripted yet — ask Claude to do this once you're happy
with a specific rough cut, since it's a real posting action worth
confirming per-video rather than automating blind.

## Pacing and reveal conventions

These apply to every entry-logging step in the script (not just the ones
that exist today) — follow them for anything added later:

- **Type, don't `.fill()`.** Any field the viewer should watch fill in
  uses `typeInto()` (character-by-character via `pressSequentially`),
  not `.fill()` — the latter snaps the value in instantly and reads as a
  blank flash in the recording. Beats: ~600ms after a form opens before
  typing starts, ~300ms between fields, ~900ms holding the completed
  form before submitting.
- **After every submit, call `revealGrid()`.** It does four things in
  order: scroll to the grid, highlight whichever row wasn't present in
  a `snapshotRows()` taken before the submit (amber, not the app's own
  green — StackIn's UI is green almost everywhere, so a green highlight
  is invisible), hold, then scroll back up and hold on the
  gauge/summary card. The grid alone only proves the row saved; the
  gauge is what shows the running totals actually changed.
- **Snapshot after switching tabs, not before.** `snapshotRows()` must
  run after the relevant tab (Income/Expenses) is showing and after its
  grid has finished hydrating (it polls until the row count stabilizes)
  — snapshotting earlier targets a grid that may not even be in the DOM
  yet, which makes every row look "new" once it loads.
- **Compare `textContent`, not `innerText`.** `snapshotRows()` uses
  Playwright's `allTextContents()` (which reads `textContent`) — the
  highlight logic inside `revealGrid()`'s `page.evaluate()` must compare
  against `row.textContent` too, or the two will never match and every
  row ends up highlighted.
- **No clip starts on a loading state.** Every `mark()` call blocks on
  `waitForLoadingToClear()` first, which polls the whole page for any
  text matching `Loading ...…` / `Loading ....` (IncomeGauge's "Loading
  pay summary…", EntriesGrid's "Loading your entries…" / "Loading
  settings…", ExpensesGrid's "Loading expenses…", etc.) and only returns
  once none remain. A `mark()` is always the START boundary of the next
  clip once `cut-clips.mjs` slices the recording, so this guarantees
  every clip opens on the real, loaded content — never a spinner or
  placeholder text — without needing to remember it at each call site.
  The pattern is intentionally generic (matches any "Loading X…" text)
  so it also covers loading states added later without edits here.

## If a step breaks

Field visibility on the entry form depends on per-workspace settings
(`shared/entryVisibility.ts`), and the settings-page UI has no defaults —
`configureW2Settings`/`configureIndependentSettings` in `record.mjs` flip
the specific toggles needed before logging any entries. If StackIn's UI
changes (new field, renamed button, etc.), the failing step will show up
as a Playwright timeout naming the exact selector it couldn't find —
check `ad-footage/failure.png` and adjust the corresponding selector in
`record.mjs`.

Native `alert()` validation errors (e.g. mismatched income category
splits) are auto-dismissed by the `page.on('dialog', ...)` handler and
logged to the console — if a "form did not collapse after submit"
warning shows up, that almost always means one of these fired and the
entry wasn't actually saved.
