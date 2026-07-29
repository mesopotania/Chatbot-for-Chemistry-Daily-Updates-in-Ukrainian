# Chemistry Daily Bot

A Telegram bot that sends one chemistry news story a day, in Ukrainian, to whoever's activated it.

## Why I built this

I wanted something that would put real chemistry news in front of people who
actually read Ukrainian and actually know chemistry — my grandmother, a friend,
myself — without turning it into a chore for me to run. No copy-pasting
articles every morning, no manual translation, and definitely nothing that
costs money every month just to send a few messages a day.

So the bot does the whole loop itself: wakes up at 9am, reads a handful of
real chemistry news feeds (Chemistry World, Phys.org, ScienceDaily), picks the
one story worth reading, writes it up in Ukrainian with proper formulas and
the interesting parts bolded, and sends it. Every recipient gets their own
copy with their own like/dislike/"more please" buttons.

## The constraints that shaped everything

**It has to be free.** Not "free trial," not "free until you scale" — free,
permanently, with no payment method attached anywhere. That ruled out a lot of
obvious choices and pushed me toward:

- **Cloudflare Workers** instead of a rented server or a Python box on Oracle
  Cloud — Workers has no idle-server bill and no cold start, and Oracle's free
  VMs get reclaimed if they sit idle too long (which a bot that runs once a
  day definitely does).
- **Gemini's free tier** instead of a paid model — genuinely free at the
  volume this needs (a couple of calls a day), as long as you don't touch the
  preview models, which have a stingy per-day cap even on the free tier.
- **RSS feeds** instead of a news API — every proper news API wants money or
  restricts commercial use; RSS from the actual publishers is free, keyless,
  and already carries an image.

**It has to actually read like Ukrainian chemistry writing**, not a
translated press release. That meant being deliberate about tone in the
prompt — write for someone who already knows the subject, keep the formulas
as real subscripted formulas (H₂O, not H2O), and don't pad it out with filler
just to hit a word count.

**It has to survive being shared around.** Once I wanted my grandmother and a
friend to get it too, "hardcode my own chat ID" stopped working. So instead
of me manually adding every person, anyone can activate themselves by sending
the bot a code word — no technical steps, no GitHub, just open a link, press
Start, type a word.

## What it actually does

- Every morning at 9:00 Kyiv time, picks and writes one article, sends it to
  everyone registered.
- Tap **📰 Ще новини** (or type `/news`) any time for another article on
  demand — you're not stuck waiting for tomorrow.
- Tap **❤️ / 👎** to react; tap **🔍 Дізнатися більше** for a deeper version.
- Just type a chemistry question and get a real, formatted answer back.
- `/stop` to unsubscribe, the code word again to come back — no data loss.
- Every reaction gets logged, so eventually I can see what's actually landing.

## How it's built

TypeScript on Cloudflare Workers, with Cloudflare D1 (a small SQLite database)
for state and Google's Gemini API for the writing. No server to maintain, no
queue, no external scheduler — Cloudflare's own cron trigger wakes the Worker
up, and Telegram's webhook delivers button taps and messages the instant they
happen.

```
src/
  collector.ts   — fetches and dedupes the RSS feeds
  editor.ts      — asks Gemini to pick a story and write it
  courier.ts     — sends the finished message to Telegram
  feedback.ts    — the webhook: buttons, activation, commands, Q&A
  pipeline.ts    — the shared collect→pick→write→send flow
  db.ts          — everything that talks to D1
```

The full architecture, the exact prompts I'm using, and the reasoning behind
each piece are written up in [`docs/GUIDE.md`](docs/GUIDE.md) — I wanted a
reference I could hand to someone else (or to myself in six months) without
having to re-explain it from scratch.

## Running it yourself

You'll need your own free accounts — a Cloudflare account, a Telegram bot
token from [@BotFather](https://t.me/BotFather), and a Gemini API key from
Google AI Studio (kept on a project with billing disabled, so it can never
become a paid call by accident).

```bash
npm install
npx wrangler login
npx wrangler d1 create khimiya-shchodnya-db   # note the database_id it prints
npx wrangler d1 execute khimiya-shchodnya-db --remote --file=schema.sql
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ACTIVATION_CODE_WORD
npx wrangler deploy
```

Then register the webhook so Telegram knows where to send updates — see
`docs/GUIDE.md` for that last step and the full explanation of what each
piece is doing.

## Testing

```bash
npx vitest run    # the full test suite
npx tsc --noEmit  # typecheck
```

Everything above 100 tests, covering the RSS parsing, the Ukrainian-only
validator, the Gemini prompt schemas, and the Telegram send paths — I didn't
want a wording tweak six months from now to silently break the daily send.
