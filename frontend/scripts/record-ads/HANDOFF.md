# Handoff: automated ad-video pipeline

Session continuity doc — read this first in a fresh conversation before
touching this feature again. For how each script actually works, see
[README.md](./README.md) in this same folder; this doc is about *where
things stand* and *what's next*, not usage instructions.

## Status: content pipeline done and tested. Daily-automation NOT started.

**Nothing in this feature is committed to git yet.** Everything under
`frontend/scripts/record-ads/`, plus `frontend/.env.recording.example`,
the `frontend/package.json` script entries, and the `.gitignore`
additions (`ad-footage/`, `!.env.recording.example`), is untracked. First
thing to do before any CI work: commit all of it.

## What's built and working

A full local pipeline that produces two finished, narrated, captioned
ad videos from the real StackIn app:

```
npm run plan:ads       # generate today's data + narration + captions + measure durations
npm run record:ads     # drive the real app in Playwright, record video
npm run cut:ads        # slice into per-scene clips
npm run caption:ads    # composite captions into the gray letterbox band
npm run narrate:ads    # mux the pre-synthesized narration into each clip
npm run make:cta       # render the branded CTA end-card (per audience, with its own narration)
npm run assemble:ads   # concatenate into ad-footage/roughcuts/w2-ad.mp4 + independent-ad.mp4
```

**Content diversity engine** (`plan-ad.mjs` + `lib/narration-templates.mjs`):
every run picks new narration/caption phrasing from a template pool and
interpolates the actual randomized numbers into it — narration
genuinely describes what's on screen (e.g. "Sally Beauty Supply, $64.24
— one photo, and it's already categorized"), not a fixed line. Add more
variety by appending template pairs to `lib/narration-templates.mjs` —
nothing else needs to change.

**Duration-matched pacing**: `plan-ad.mjs` synthesizes narration and
measures its *real* duration via `ffprobe` before any recording happens.
`record.mjs` then holds on each payoff shot for exactly that long (live
elapsed-time tracking in `revealGrid()`), so payoff scenes match their
narration exactly. For scenes with real typing, if narration is shorter
than the typing naturally takes, the video just runs a touch longer with
trailing silence — never truncates a line.

Verified end-to-end multiple times, most recently with real ElevenLabs
narration (paid plan) and reviewed visually via the Ad Footage Review
artifact (see below).

## Key decisions already made (don't re-litigate these)

- **TTS provider: ElevenLabs**, paid plan (upgraded specifically for
  this). Voice ID is in `.env.recording` (`ELEVENLABS_VOICE_ID`). OpenAI
  TTS was tried as a stopgap and works, but ElevenLabs is the intended
  provider — don't switch back without asking.
- **Scheduling mechanism: GitHub Actions**, not Claude-hosted cloud
  scheduling (tried previously, failed — don't revisit that path without
  the user raising it first).
- **Repo stays private.** CI cost was estimated at 8-15 min/day
  (Playwright/Chromium install + Next.js build + recording + ffmpeg),
  well inside the 2,000 min/month free tier for private repos — not a
  concern at this volume.
- **Daily output: one ad per day**, alternating W-2 / Independent (not
  both every day). `plan-ad.mjs` already supports this —
  `npm run plan:ads -- w2` or `npm run plan:ads -- independent` plans a
  single audience.
- **Auto-post: fully autonomous**, no human review gate before posting
  to Buffer. (Flagged the risk of this once — a bad take going out
  unreviewed — user chose autonomous anyway. Don't re-ask unless asked.)
- **Buffer org/channels** (already queried via the Buffer MCP connector):
  org "My Organization" (`6a4090c197647411a6ae36b6`), channels "StackIn
  App" Facebook page (`6a47acce5ab6d2f1069db02f`) and "stackinapp"
  Instagram business (`6a47bb175ab6d2f1069dfc98`). **Which channel(s) to
  post to was never confirmed** — I defaulted to recommending Instagram
  Reels but this needs an explicit answer before wiring up auto-posting.

## What's NOT built yet (the actual remaining work)

1. **Commit everything to git first.** Nothing above is in version
   control yet.
2. **GitHub Actions workflow** (`.github/workflows/daily-ad.yml`, doesn't
   exist yet): cron trigger + `workflow_dispatch` for manual testing.
3. **Self-contained CI app**: the runner can't reach `localhost:3000` on
   anyone's Mac, so the workflow needs to `npm run build && npm run
   start` (or `dev`) the actual Next.js frontend *inside* the job itself,
   talking to the real Firebase backend (same as local — Firebase is
   cloud-hosted regardless of where the frontend runs).
4. **Migrate secrets to GitHub encrypted secrets** — none of this exists
   as GH secrets yet:
   - Firebase client config (6 values, currently in gitignored
     `frontend/.env.local` — check that file locally for the exact keys)
   - `STACKIN_DEMO_EMAIL` / `STACKIN_DEMO_PASSWORD`
   - `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`
   - A new Buffer API key (publish.buffer.com/settings/api) — **the
     Buffer MCP connector used in this chat session will NOT work from a
     GitHub Actions workflow**, it's tied to this conversation. A
     workflow needs a direct API call (Buffer's API is GraphQL-based,
     based on the MCP tool's `introspect_schema`/`execute_mutation`
     escape hatches — the exact mutation shape for `create_post` hasn't
     been reverse-engineered yet; do that via the MCP tools' introspection
     before writing the raw HTTP call).
5. **Alternating-audience logic** in the workflow (e.g. day-of-year
   parity → `w2` or `independent`), calling `plan:ads -- <audience>`
   accordingly, then only assembling/posting that one ad.
6. **Direct Buffer posting step** in the workflow (curl/fetch call, not
   MCP) — upload the finished mp4 wherever it needs to be publicly
   hosted first if Buffer's API requires a URL rather than accepting a
   direct file upload (this constraint was confirmed true for the MCP
   tool; verify whether Buffer's raw API differs).

## Known gotchas worth remembering

- **Pay-stub (`/app/earnings`) and P&L (`/app/profitloss`) views can't be
  used in footage** — both are populated by backend jobs with
  unpredictable latency, not derivable live. The pipeline uses the Home
  page's live gauges/grids as the payoff shot instead. Don't re-attempt
  wiring these in without solving that latency problem first (would need
  Firebase Admin credentials to force-generate, which nothing here has).
- **ElevenLabs free tier blocks API access to library voices entirely**
  — paid plan required, confirmed by direct API error.
- **OpenAI API billing is separate from a ChatGPT subscription** — if
  ever falling back to OpenAI TTS, a fresh key needs billing added at
  platform.openai.com/account/billing or it 403s with `insufficient_quota`.
- **The StackIn demo account has a workspace-count cap** — hit a 403
  from `createWorkspace` once already this session. The two demo
  workspaces ("Ad Demo (W-2)", "Ad Demo (Independent)") already exist and
  get reused, so this shouldn't recur, but don't casually create more
  workspaces on this account.
- **Never add `-shortest` to the narration mux command** — truncates
  video to match shorter audio instead of the reverse. Real bug hit and
  fixed once already; the fix is in `narrate-clips.mjs`, don't reintroduce it.
- **A macOS `say` (Samantha) fallback path was explored** for fully
  offline/free narration if cloud TTS ever becomes impractical — low
  quality, not currently wired up anywhere, but known to work as a last resort.

## Where to look

- [README.md](./README.md) — full usage docs, one section per script.
- `ad-footage/plan.json` — inspect after `plan:ads` to see exactly what
  a given run decided (data, narration, captions, measured durations).
- The Ad Footage Review artifact (published earlier this session,
  updated in place across iterations) — check the user's Claude
  artifacts list if the link's been lost; it was republished to the same
  URL every time so there's only one to find.
