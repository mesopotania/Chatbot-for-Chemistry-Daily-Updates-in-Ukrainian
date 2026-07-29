# «Хімія щодня» — how it works, step by step

A plain-language guide to what was built, why, and exactly how — so you can
explain it to someone else, or rebuild it yourself.

---

## 1. What this is, in one sentence

A Telegram bot that wakes itself up every morning at 9:00 (Kyiv time), picks
the single best chemistry news story of the day, writes it in Ukrainian using
an AI model, and sends it to everyone who has activated it — with buttons for
feedback, more news on demand, and now free-form Q&A.

Nobody runs a server. Nobody pays for hosting. It costs **€0/month**.

---

## 2. The three services involved, and what each one does

| Service | What it is | What it does here | Cost |
|---|---|---|---|
| **Cloudflare Workers** | A place to run code that Cloudflare keeps "awake" for you | Runs all the bot's logic, on a timer and on demand | Free tier |
| **Cloudflare D1** | A small database | Remembers what's been sent, who's registered, who reacted how | Free tier |
| **Google Gemini API** | An AI model (`gemini-flash-lite-latest`) | Picks the best article and writes it in Ukrainian; answers questions | Free tier |
| **Telegram Bot API** | Telegram's own messaging interface | Delivers messages, buttons, and receives taps/texts back | Always free |

**No Python. No server you manage. No n8n or Zapier.** The code is
TypeScript, and it runs *inside* Cloudflare's infrastructure — Cloudflare
itself is the thing that wakes the code up, not a machine you own.

---

## 3. The daily workflow — what happens every morning

```
Cloudflare wakes the Worker up automatically, every hour, forever
(this is called a "cron trigger" — no server, no external scheduler)
        │
        ▼
"Is it 9:00 in Kyiv right now, AND have I not already sent today?"
        │ if no → go back to sleep, try again next hour
        │ if yes ↓
        ▼
COLLECT: fetch ~10 chemistry RSS feeds
  (Chemistry World, Phys.org, ScienceDaily — real news sites, free, no key needed)
        │
        ▼
SELECT: send the day's headlines to Gemini, ask it to pick the single
  most interesting one for an expert chemist
        │
        ▼
WRITE: fetch the full article page, send it to Gemini again, ask it to
  write a Ukrainian summary — paragraphs, bold key terms, chemical
  formulas with subscripts (CO₂, not CO2), keywords, a link
        │
        ▼
FAN OUT: send that same written article to every person who has
  activated the bot (see §5) — each gets their own copy, their own buttons
        │
        ▼
RECORD: write to the database "sent this URL, to this person, today"
  → this is what stops it from ever repeating an article
```

That whole sequence is one function, `runDailyPipeline`, in
[`src/index.ts`](../src/index.ts).

### Why hourly, not "just run at 9am"?

Cloudflare's free scheduler runs in UTC and has no timezone setting.
Kyiv shifts between UTC+2 and UTC+3 twice a year (daylight saving). Instead
of hand-editing a cron expression twice a year (which is exactly the kind of
thing that gets forgotten), the Worker wakes up **every hour** and asks
itself, in Kyiv's own calendar, "is it 9am *there*, right now?" This is
handled by [`src/scheduling.ts`](../src/scheduling.ts) and is immune to DST
changes automatically, because it asks the timezone database, not a fixed
offset.

---

## 4. The second workflow — instant reactions

The daily send is on a *timer*. But someone tapping a button, or typing a
question, needs to be answered **immediately**, not on the next hourly tick.
That's a second, completely independent path:

```
Someone taps a button, or sends a text message, in Telegram
        │
        ▼
Telegram instantly forwards it to the Worker's public URL
  (this is called a "webhook" — Telegram calls us, we don't poll Telegram)
        │
        ▼
The Worker checks: is this a registered person, or the author (you)?
        │ no  → send back "type the code word to activate" (never reveals the word)
        │ yes ↓
        ▼
  ❤️/👎 tap  → log the reaction, done
  📰 "Ще новини" tap → run the same COLLECT→SELECT→WRITE steps as the
                        daily job, right now, send the result
  🔍 "Дізнатися більше" tap → acknowledge (logged for you to review)
  free-text message → treated as a chemistry QUESTION, answered by Gemini
```

This lives in [`src/feedback.ts`](../src/feedback.ts) and
[`src/qa.ts`](../src/qa.ts).

---

## 5. How people join — the code word

You share **one plain link**: `https://t.me/ChemistryDaily_bot`
(no special parameters needed).

1. They tap the link → Telegram opens a chat with the bot → they press **Start**.
2. The bot replies immediately: *"Send me the code word to activate."*
3. They type the code word (currently: **Zina**, case doesn't matter).
4. The bot confirms, adds them to the `recipients` table, and you get a
   notification that someone new joined.
5. Tomorrow at 9am, they get the daily message too — automatically, forever,
   with no further action from you.

This *used* to only work via a special link format
(`?start=Zina`), which is what silently failed for your friend — some
clients don't forward that parameter reliably. The fix: **any** message from
an unrecognized person — including a bare `/start` — now gets an in-chat
prompt asking for the word, so the plain link always works.

---

## 6. The database — what it remembers, and why

Four things live in Cloudflare D1 (`schema.sql`):

| Table | Remembers | Why it matters |
|---|---|---|
| `recipients` | Who has activated | The daily send loops over this list |
| `sent` | Which article went to whom, on which day | Never repeat an article; never double-send in the same day |
| `feedback` | Every ❤️/👎/🔍 tap, per person, per day | The raw material if you ever want to teach the selector what lands well |
| `seen` | Every article the collector has noticed, even unsent ones | Keeps a story "in the running" for 7 days, not just the day it first appeared |

Nothing here is your personal data beyond a Telegram chat ID and an optional
first name — no messages, no content, are stored beyond what's needed to run
the bot.

---

## 7. The exact AI prompts used

These are the actual instructions sent to Gemini. If you ever want to tune
tone, length, or behavior, this is where to look — file:
[`src/editor.ts`](../src/editor.ts).

### Selecting the best story

> Ти редактор хімічних новин для читачки-хімікині з багаторічним досвідом. З
> наведеного списку обери ЄДИНУ найкращу статтю для неї — актуальну,
> змістовну хімічну новину. Якщо жодна не годиться, поверни null.

### Writing the daily article

> Ти пишеш щоденний огляд хімічної новини українською мовою для читачки —
> дипломованої хімікині (вчителька, інженерка або лаборантка), близько 75
> років.
>
> Правила:
> - Пиши для фахівчині. Називай сполуки, реагенти, механізми та кількісні
>   дані. НЕ спрощуй і НЕ скорочуй надмірно.
> - Подавай суть стисло, але змістовно: що саме відкрили, яким методом, який
>   результат у цифрах, і чому це важливо.
> - Структуруй абзацами: 3-5 коротких абзаців, по 2-3 речення.
> - Виділяй ключову інформацію подвійними зірочками: **вихід 92%**.
> - Доречні емодзі дозволені, зрідка: 🧪 🔬 ⚗️ 🧫.
> - Лише українська мова. Жодних слів латиницею.
> - Хімічні формули ЗАВЖДИ з нижніми індексами Unicode: CO₂, H₂O — НІКОЛИ
>   звичайними цифрами.
> - Заголовок: не більше 10 слів.
> - Обсяг: приблизно 600-1200 видимих символів.

*(followed by the source name, headline, and the fetched article text)*

### Answering a free-form question

> Ти — хімічний асистент, що відповідає українською мовою фахівчині-хімікині
> з багаторічним досвідом. Дай точну, стислу відповідь на її питання.
>
> Правила:
> - Пиши для фахівчині. Не спрощуй.
> - Лише українська мова. Формули з нижніми індексами Unicode.
> - Виділяй ключові терміни подвійними зірочками.
> - Без вступних фраз кшталт «Звичайно, ось відповідь» — одразу по суті.
> - Приблизно 400-800 видимих символів.

**Pattern to notice:** every prompt ends by asking the model to return
**structured JSON** (a fixed shape: headline, paragraphs, keywords, etc.),
not free text. This is what makes the output reliable enough to format
automatically — the code never has to "guess" where the headline ends and
the body begins.

---

## 8. Safety nets built in (so a bad day never breaks the habit)

- **No article picked?** → fall back to a pre-written "evergreen" chemistry
  story, so a message still arrives.
- **Article too long for Telegram?** → sent as one text message (not a
  photo caption), so nothing is ever truncated.
- **A recipient's send fails?** → you get an alert, but everyone else still
  gets theirs.
- **Gemini errors or hits a quota** → the code degrades gracefully (falls
  through to the next candidate, or replies with a Ukrainian apology) —
  it never leaves a tap or question unanswered in silence.
- **A stranger finds the bot** → gets asked for the code word, nothing else
  happens; they can't see content, trigger sends, or read anyone's data.

---

## 9. If you wanted to rebuild this from scratch — the real steps taken

1. **Get a free Telegram bot token** — message `@BotFather` on Telegram,
   `/newbot`, follow the prompts.
2. **Get a free Gemini API key** — Google AI Studio, "Get API key," and
   critically: put it in a project with **billing disabled**, so it can
   never become a paid call by accident.
3. **Create a free Cloudflare account**, run `wrangler login`.
4. **Create the database**: `wrangler d1 create <name>` — gives you a
   database ID to put in `wrangler.toml`.
5. **Write the schema** (`schema.sql`) — the four tables above.
6. **Write the code** — collector (RSS), editor (Gemini calls), courier
   (Telegram sending), feedback (webhook + activation + Q&A), all wired
   together in `index.ts`.
7. **Set secrets** (never in code, never committed): `wrangler secret put
   TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`,
   `ACTIVATION_CODE_WORD`.
8. **Deploy**: `wrangler deploy` — this is the moment the bot goes live and
   starts waking itself up every hour.
9. **Register the webhook** — tell Telegram where to send button taps and
   messages (`setWebhook`), with a secret token so only real Telegram
   requests are trusted.
10. **Test end-to-end** — trigger the pipeline manually once, watch a real
    message arrive, tap the buttons, confirm nothing breaks.

---

## 10. Quick answers to things that come up

- **Changing the bot's display name?** Purely cosmetic, zero effect on
  anything — do it anytime via BotFather's `/setname`.
- **Changing the bot's @username?** Breaks old shared links (people need
  the new one), but the bot itself keeps working — the token is the real
  identity, not the username.
- **Changing the code word?** One command, no redeploy of the code needed:
  `wrangler secret put ACTIVATION_CODE_WORD`.
- **"Training" the AI?** Doesn't happen. Every call is the model reading a
  fresh prompt and responding — no fine-tuning, no memory between calls.
  The `feedback` table is just a log for *you* to read later, not an
  automatic feedback loop.
