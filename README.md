# Chemistry Daily Bot

A Telegram bot that sends one chemistry news story a day, in Ukrainian, to whoever's activated it.

## Why I built this

Primarily built for my grandmother. As a chemistry teacher, she is interested in what's happening in the field, but doesn't speak English, and most current chemistry news gets published in English first. She also doesn't have the time or the habit of digging through science sites on her own. So I wanted her to get one solid, properly written story a day, delivered straight into the messenger she already checks every day.

## Tools used

- Cloudflare Workers, runs the bot
- Cloudflare D1, the database
- Telegram Bot API, sends messages and buttons, handles taps
- Google Gemini API, picks the story and writes it in Ukrainian
- RSS feeds from Chemistry World, Phys.org, and ScienceDaily, the actual news sources

## How it works

Every morning at 9:00 Kyiv time, the bot checks its feeds, picks the one story worth reading, and asks Gemini to write it up in Ukrainian, formulas and all (K₂Cr₂O₇, not K2Cr2O7). It sends that story with a few buttons under it: like, dislike, "tell me more," and "send me another one now."

Tapping a button doesn't just acknowledge it. Every reaction gets logged, and the plan is to use that over time to see what she actually responds to, so the bot gets better at picking stories instead of guessing every morning.

She can also just type a chemistry question straight into the chat and get an answer back. And if she ever wants a break, one command unsubscribes her, and the same code word she used the first time brings her right back, no history lost.

## Running it yourself

You'll need your own free accounts: a Cloudflare account, a Telegram bot token from [@BotFather](https://t.me/BotFather), and a Gemini API key from Google AI Studio (kept on a project with billing disabled).

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
Then register the webhook so Telegram knows where to send updates. See
docs/GUIDE.md for that last step and the full explanation of what each
piece is doing.

Testing
npx vitest run    # the full test suite
npx tsc --noEmit  # typecheck
There are over 100 tests, covering the RSS parsing, the Ukrainian-only
validator, the Gemini prompt schemas, and the Telegram send paths.
