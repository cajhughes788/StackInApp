# 521 ads

Two motion ads built with [Remotion](https://remotion.dev) (React → MP4):

- **Built on your books** (38.8 s, `npm run render:built`): the main ad. Bookkeeping is the
  foundation (a glowing profit & loss slab); Booking, Invoices, Payments and Receipts drop onto
  it and send their money down into it. Scenes are in `src/built/scenes.tsx`, the slab, blocks and
  pulse lines in `src/built/foundation.tsx`, timing in `src/BuiltOnBooks.tsx`. The category cloud
  uses the app's real categories from `shared/expenseCategories.ts`; update `CATEGORIES` if they change.
- **Booking ad** (36 s, `npm run render`): the earlier booking-first cut, described below.

## Booking ad

A 36-second motion ad for booking.
Style: dark, glowing green light, one short line at a time, the app shown as floating cards and chips.

## Render

```bash
npm install
npm run render          # all three: out/booking-ad-9x16.mp4, -1x1.mp4, -16x9.mp4
npm run render:vertical # just 9:16
npm run studio          # live preview with a timeline scrubber
```

Rendering uses the installed Google Chrome (see `remotion.config.ts`); Remotion's own headless
Chrome never paints a frame on this Mac.

## Change things

- **Words on screen:** each scene's `<Words text="…" />`. Wrap a word in `**…**` to make it the green highlight.
- **Prices, names, times:** in the scene files (`Haircut`, `Jordan`, `$45.00`, `jaycuts`…).
  The money adds up: $40 haircut + $15 beard trim − $10 deposit = $45 due, + $8 tip.
- **Timing:** `SCENES` in `src/BookingAd.tsx` (frames at 30 fps; scenes overlap a few frames to blur through).
- **Colors:** `C` in `src/theme.ts`.

| Time | Scene | File |
|---|---|---|
| 0–7 s | Three apps, client messages pile up | `scenes/opening.tsx` → `Opening` |
| 7–9 s | Logo reveal | `scenes/opening.tsx` → `LogoReveal` |
| 9–13 s | Services and hours | `scenes/setup.tsx` → `Services` |
| 13–17 s | Link, website button, QR | `scenes/setup.tsx` → `Share` |
| 17–21 s | Client books and pays the deposit | `scenes/setup.tsx` → `ClientBooks` |
| 21–24 s | New booking push, reminders | `scenes/setup.tsx` → `Notify` |
| 24–29 s | Finish & get paid by QR, tip | `scenes/money.tsx` → `GetPaid` |
| 29–32 s | Income, tip, fees, profit | `scenes/money.tsx` → `Books` |
| 32–36 s | "No more…", logo, Booked. Paid. Done. | `scenes/money.tsx` → `Ending` |

## Music

There's no audio track. Add music in your editor (or drop an mp3 in `public/` and add
`<Audio src={staticFile("music.mp3")} />` to `BookingAd.tsx`). Around 120 BPM fits the cuts.
