// Content-diversity core: for each scene "kind" that appears in the ad,
// a pool of narration + caption template PAIRS (same index = thematically
// matched, so narration and caption never contradict each other, but
// they're not required to be verbatim copies). plan-ad.mjs picks one
// pair per kind per day and interpolates the actual randomized data
// (amounts, vendor, etc.) into it, so the line genuinely describes what
// the viewer is about to watch — not a generic caption that happens to
// play over unrelated numbers.
//
// Narration reads fuller/more natural; captions stay short/punchy for
// the on-screen band. Add a new variant by appending a { narration,
// caption } pair to the relevant array — nothing else needs to change,
// plan-ad.mjs picks from whatever's here.

import { randomInt } from "./random-helpers.mjs";

export function money(amountStr, { cents = false } = {}) {
  const n = Number(amountStr);
  return cents ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

const KINDS = {
  "w2-hook": [
    {
      narration: (d) =>
        `Just logged ${money(d.tips)} in tips — if your paycheck's ever been short, you'd have no way to know. Until now.`,
      caption: () => "Your paycheck could be wrong — and you'd never know.",
    },
    {
      narration: (d) =>
        `${d.hours} hours, ${money(d.tips)} in tips — logged the second the shift ends, not whenever you get around to it.`,
      caption: () => "Log every shift the moment it ends.",
    },
    {
      narration: () =>
        `Most servers have zero record of what they actually made. This shift just got logged in seconds.`,
      caption: () => "Most servers track nothing. This takes seconds.",
    },
    {
      narration: (d) => `${money(d.tips)} in tips, ${d.hours} hours — verified, not guessed.`,
      caption: () => "Verified pay. Not guesswork.",
    },
  ],
  "w2-shift-2": [
    {
      narration: (d) => `Another shift down — ${money(d.tips)} in tips, logged in a few seconds flat.`,
      caption: () => "Log every shift in seconds.",
    },
    {
      narration: (d) => `${d.hours} hours, ${money(d.tips)} in tips — no spreadsheet, no math, just tap and done.`,
      caption: () => "No spreadsheet. No math. Just tap.",
    },
    {
      narration: (d) => `Second shift, same few seconds — ${money(d.tips)} tracked automatically.`,
      caption: () => "Every shift, tracked automatically.",
    },
    {
      narration: () => `This is what logging tips is supposed to feel like — instant, not a chore.`,
      caption: () => "Logging tips shouldn't be a chore.",
    },
  ],
  "w2-grid-payoff": [
    {
      narration: (d) => `Two shifts, ${money(d.combinedTips)} in tips — and it's all sitting right here, automatically.`,
      caption: () => "See your real numbers. Instantly.",
    },
    {
      narration: (d) => `That's ${money(d.combinedTips)} in tips this week — updating the moment you log it, not at the end of the month.`,
      caption: () => "Updates the moment you log it.",
    },
    {
      narration: () => `No more wondering what you made. It's all right here, every shift, every dollar.`,
      caption: () => "No more wondering what you made.",
    },
    {
      narration: (d) => `${money(d.combinedTips)} in tips, ${d.combinedHours} hours — your whole week, at a glance.`,
      caption: () => "Your whole week, at a glance.",
    },
  ],
  "w2-cta": [
    { narration: () => `Download StackIn, and finally know what you actually made.` },
    { narration: () => `Your paycheck, verified. Download StackIn today.` },
    { narration: () => `Stop guessing your tips. Download StackIn — free to start.` },
    { narration: () => `Every shift, every dollar — download StackIn and see for yourself.` },
  ],
  "independent-hook": [
    {
      narration: (d) => `Just brought in ${money(d.totalIncome)} across three payment types — still guessing what you'll owe at tax time?`,
      caption: () => "Still guessing your cash tips at tax time?",
    },
    {
      narration: (d) => `Venmo, POS, cash — ${money(d.totalIncome)} logged across every channel, automatically.`,
      caption: () => "Every channel, tracked automatically.",
    },
    {
      narration: () => `Most independent workers piece their income together in April. This happens the day it comes in.`,
      caption: () => "Don't piece it together in April.",
    },
    {
      narration: (d) => `${money(d.totalIncome)} in today alone — Venmo, card, and cash, unified instantly.`,
      caption: () => "Every payment type, unified instantly.",
    },
  ],
  "expense-logged": [
    {
      narration: (d) => `A ${money(d.amount, { cents: true })} supply run at ${d.vendor} — snapped, categorized, and logged.`,
      caption: () => "Every dollar in, every dollar out.",
    },
    {
      narration: (d) => `Receipt from ${d.vendor}: ${money(d.amount, { cents: true })}, filed under ${d.category} instantly.`,
      caption: () => "Receipts, filed instantly.",
    },
    {
      narration: (d) => `Every write-off starts here — ${money(d.amount, { cents: true })} at ${d.vendor}, tracked the moment it happens.`,
      caption: () => "Every write-off, tracked as it happens.",
    },
    {
      narration: (d) => `${d.vendor}, ${money(d.amount, { cents: true })} — one photo, and it's already categorized.`,
      caption: () => "One photo. Already categorized.",
    },
  ],
  "independent-summary-payoff": [
    {
      narration: () => `Income in, expenses out — one dashboard, zero spreadsheets.`,
      caption: () => "One app. Zero guesswork.",
    },
    {
      narration: (d) => `That's ${money(d.expenseTotal, { cents: true })} in expenses this month, categorized automatically.`,
      caption: () => "Every expense, categorized automatically.",
    },
    {
      narration: () => `No more April surprises — every number's already sitting right here.`,
      caption: () => "No more April surprises.",
    },
    {
      narration: () => `This is your whole month's profit and loss, updating in real time.`,
      caption: () => "Your P&L, updating in real time.",
    },
  ],
  "independent-cta": [
    { narration: () => `Download StackIn, and take the guesswork out of your business.` },
    { narration: () => `Every dollar, tracked automatically. Download StackIn — free to start.` },
    { narration: () => `Tax season, simplified. Download StackIn today.` },
    { narration: () => `Stop reconstructing your income every April. Download StackIn.` },
  ],
};

/** Picks one variant for `kind`, avoiding indices in `exclude` where
 * possible (so a single day's plan doesn't reuse the exact same variant
 * across scenes that share a kind pool), and renders it against `data`.
 * Returns { narration, caption, variantIndex }. */
export function renderScene(kind, data, exclude = []) {
  const pool = KINDS[kind];
  if (!pool) throw new Error(`Unknown narration kind: "${kind}"`);
  const available = pool.map((_, i) => i).filter((i) => !exclude.includes(i));
  const choices = available.length > 0 ? available : pool.map((_, i) => i);
  const variantIndex = choices[randomInt(0, choices.length - 1)];
  const variant = pool[variantIndex];
  return {
    variantIndex,
    narration: variant.narration(data),
    caption: variant.caption ? variant.caption(data) : null,
  };
}

export function poolSize(kind) {
  return KINDS[kind]?.length ?? 0;
}
