# «Хімія щодня» — Design Spec

**Date:** 2026-07-26
**Author:** Tetiana Fedotova
**Status:** Approved for planning
**Configuration:** zero-cost — Gemini 3 Flash free tier, Cloudflare Workers + D1 free tier, RSS sources. No payment method anywhere.

---

## 1. What this is

A private Telegram bot that sends one chemistry news item per day, in Ukrainian, to a single primary reader: the author's grandmother, a trained chemist.

The daily message is an original Ukrainian summary written from an English-language source article, delivered with the publisher's own image where there is one, and a link back to the source.

It runs entirely on free tiers: no subscription, no payment method, nothing that turns into a bill.

## 2. The reader

A trained chemist — teacher, engineer, or lab background — aged around 75.

Two separate constraints follow from that, and conflating them produces a bad product:

- **She is an expert.** Her barrier is language and access, not complexity. Chemical terminology stays. Simplified, explain-it-like-I'm-five summaries would read as condescending and she would stop reading.
- **She is 75.** Legibility, short paragraphs, one idea per block, and a single unambiguous action per message.

## 3. Core behaviour

> Every morning, one message arrives → she reads one new thing in chemistry.

Everything in this spec exists to protect that single loop. Nothing else is in scope for v1.

## 4. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Delivery | Telegram, private 1:1 bot | A message that arrives is a stronger habit trigger than an app that must be remembered. Bot over channel: allows per-user state, feedback, and later personalization. |
| Language | Ukrainian only | No English in any user-facing string. |
| Editorial gate | Fully automatic + feedback buttons | A daily approval chore would break the habit the first busy week. Feedback taps tell the author what is landing, without putting her in the daily path. |
| Content scope | Chemistry-led, widening to materials / pharma / biochem when chemistry is thin | Guarantees daily volume without drifting off her field. |
| Images | Publisher's own `og:image`, text-only when absent | Generated illustrations produce chemically wrong molecules that a chemist spots instantly. |
| Summaries | Original Ukrainian summary, not a translation of the full article | Republishing translated full text is someone else's copyrighted work. A summary plus attribution is clean and reads better. |
| Writer | Gemini 3 Flash, free tier | 1,500 requests/day free against a need of 2. Accepted risk: weaker Ukrainian chemical nomenclature (§5.2). |
| Host | Cloudflare Workers + D1, free tier | The only free host with no idle-reclamation and no inactivity timer. Always addressable, so buttons answer instantly via webhook. |
| Language of implementation | TypeScript | Forced by the host. |

## 5. Architecture

One Worker. One D1 database. One deploy.

```
hourly cron tick ──▶ is it SEND_HOUR in Kyiv, and unsent today?
                          │ yes
                          ▼
  Збирач ──candidates──▶ Редактор ──Ukrainian text──▶ Кур'єр ──▶ Telegram ──▶ бабуся
    │                        │                          │                        │
    └────────────────────────┴────── D1 ────────────────┘                        │
                                     ▲                                           │
                                   Відгук ◀──── webhook ◀──── tap ───────────────┘
```

The four units keep their boundaries: each knows only its own job, and they meet only through D1. That separation is why swapping the writer (§11) touches one section and nothing else.

Serverless here is a single Worker with two entry points, not a distributed system. A queue-and-worker split was considered and rejected: for one reader and one message a day, it is overhead with no return.

### 5.1 Збирач — collector

**Purpose:** produce a list of candidate articles for one tier.
**Interface:** `collect(tier: Tier): Promise<Candidate[]>`
**Depends on:** the feed list, the `seen` and `sent` tables.
**Knows nothing about:** language, Telegram, the LLM.

- Fetches each feed in the requested tier with a 10-second timeout.
- Reads RSS metadata only. It does not fetch article pages; that happens once, after selection (§5.2).
- Returns `Candidate(url, title, blurb, published_at, source_name)`.

**Eligibility window.** A URL is dropped if it appears in `sent`. Otherwise it is eligible for **7 days** from `seen.first_seen_at`, and a row is written to `seen` the first time it is encountered. The window matters: a one-shot "unseen" rule would burn every candidate the selector passed over on day one, and the second-best article of Monday is often the right pick on Thursday.

Intended source set — each feed URL is verified to return parseable XML as an implementation task, and any that does not is dropped with a note rather than silently skipped:

| Tier | Source |
|---|---|
| Core | Chemistry World (RSC) |
| Core | C&EN (ACS) |
| Core | Nature Chemistry — news |
| Core | Phys.org — chemistry |
| Core | ScienceDaily — chemistry |
| Widening | Phys.org — materials science |
| Widening | ScienceDaily — pharmacology |

The widening tier is only collected when the core tier yields nothing the selector will take (§8).

**Why RSS and not a news API.** Every feed above is free, keyless, unregistered, and unmetered, and each entry carries the publisher's `og:image` — which is where the daily picture comes from. No paid content API is required, now or later.

Two things were checked and rejected:

- **NewsAPI.org** — its free tier forbids commercial use, caps at 100 requests/day, and restricts CORS to localhost. It is a development tier, not a free tier; the first paid plan is $449/month.
- **Crossref, OpenAlex, Europe PMC, arXiv, PubChem** — all genuinely free (Crossref needs only a `mailto`; OpenAlex has required a free key since 13 February 2026, with 100,000 credits/day against a usage of about two). All rejected as the primary source because they serve *papers, not news*. An abstract is a primary source with no narrative; Chemistry World writes the story. Swapping feeds for an academic API would make the product worse without making it cheaper, since it is already free.

If the widening tier proves thin, the [Guardian Open Platform](https://open-platform.theguardian.com/) is the free supplement to add: real news prose, a free key, production use permitted, no commercial restriction.

### 5.2 Редактор — editor

**Purpose:** pick the single best candidate and write the Ukrainian summary.
**Interface:** `edit(candidates: Candidate[]): Promise<Article | null>`
**Depends on:** the Gemini API, and one HTTP fetch of the chosen article page.
**Knows nothing about:** RSS, Telegram, D1.

Three steps, two of them Gemini calls on `gemini-3-flash`:

1. **Selection** — given candidate titles and blurbs, return the index of the single best item for a trained chemist, or `null` if nothing clears the bar.
2. **Fetch** — retrieve the chosen article's page once with `fetch()`, and pull two things from it with `HTMLRewriter`: the body text, and the `og:image` URL. `HTMLRewriter` is built into the Workers runtime and streams, so no HTML parsing library is needed and no full document is held in memory. One fetch, after selection, so the collector stays cheap and no page is fetched that will not be used. If the fetch fails, the RSS blurb is used as the source text and the message is sent text-only.
3. **Writing** — given that text, produce the Ukrainian summary as structured output.

The editor returns `Article(headline, paragraphs, why_matters, coined_term, url, source_name, image_url)`. `image_url` is `None` when no `og:image` was found.

Both calls set `responseMimeType: "application/json"` and pass a `responseSchema` in the generation config. The writing call's schema:

```json
{
  "type": "object",
  "properties": {
    "headline":   {"type": "string"},
    "paragraphs": {"type": "array", "items": {"type": "string"}},
    "why_matters":{"type": "string"},
    "coined_term":{"type": ["string", "null"]}
  },
  "required": ["headline", "paragraphs", "why_matters", "coined_term"],
  "additionalProperties": false
}
```

`coined_term` is non-null when the model had to invent a Ukrainian term for a compound or technique that has no settled Ukrainian form. It is not shown to the reader; it is logged and surfaced in the weekly digest so the author can check it.

**API parameters.** `gemini-3-flash` on the free tier: 1,500 requests per day against a need of two, so quota is a non-issue. `thinking_level` is set to `high` for the writing call — the free tier does not charge for thinking tokens, so there is no reason to economise on the one call whose quality matters — and `low` for selection, which is a ranking task.

Two operational rules:

- **Never enable billing on the Google Cloud project holding this key.** Enabling billing removes the free tier from that project permanently, and every call becomes billable from the first token, including calls that would have fit the free quota. This project does one thing and must stay billing-free.
- Free-tier prompts and responses are used by Google to improve their products. The input here is public news articles and the output is a summary of them, so this is acceptable. It is recorded so the decision is not accidental.

**Nomenclature risk, and what guards it.** This is the known weak point of the zero-cost configuration. A Flash-class model writing Ukrainian chemistry will occasionally produce a russified term, a calque from English, or an invented form — and the reader is a career chemist who will notice immediately. Three defences, in order:

1. The editorial prompt names the risk explicitly and instructs the model to prefer established Ukrainian nomenclature and to flag any term it is unsure of in `coined_term`.
2. The Latin-script validator (§6) catches the crudest failure, an untranslated English term left in place.
3. The weekly digest surfaces every `coined_term` to the **author**, who checks them. This is the real guard, and it is why the digest is required rather than optional in this configuration.

A term list of the author's own corrections, appended to the prompt as it grows, is the intended v2 improvement.

**Editorial rules given to the model:**

- Write for a trained chemist. Name compounds and mechanisms. Do not simplify.
- Ukrainian only. No Latin-script words in the body. Chemical formulas and SI units are permitted.
- Headline: at most 8 words.
- Body: 2 to 4 paragraphs, 1 to 2 sentences each, no nested clauses.
- Total rendered caption: at most **1024 characters**, the hard Telegram limit on image captions. Telegram counts the visible text, not the HTML tags, so the courier measures the caption with tags stripped. The editor is asked for **900 visible characters or fewer** — roughly 120 to 140 Ukrainian words — leaving the limit as a safety margin rather than a target.
- Use established Ukrainian chemical nomenclature.

### 5.3 Кур'єр — courier

**Purpose:** render and send.
**Interface:** `send(article: Article): Promise<number>` — returns the Telegram `message_id`.
**Knows nothing about:** chemistry, RSS, the LLM.

Renders to this shape and sends as a single `sendPhoto` call with the text as the caption:

```
[ зображення ]

<b>Заголовок</b>

Перший абзац.

Другий абзац.

<b>Чому це важливо:</b> один рядок.

<a href="...">Джерело</a>

[ ❤️ Подобається ]  [ 👎 Не цікаво ]
[ 🔍 Дізнатися більше ]
```

- One message, never two. Two messages means two things to find. Where the diagram shows an image, a message without one is the same message minus that line — never a second message.
- `parse_mode=HTML`. Bold is used only for the headline and the «Чому це важливо» label.
- **No link preview may ever render.** Telegram's automatic preview shows the source's English title, which breaks the Ukrainian-only rule. On the `sendPhoto` path this holds by construction, since photo captions do not generate previews. On the text-only path it does not: `sendMessage` **must** set `link_preview_options: { is_disabled: true }`. This is the single place where English can reach her, so it is asserted in the courier test rather than trusted.
- No decorative emoji in the body. The three button labels are the only emoji.
- Buttons sit on two rows: the two one-word verdicts share a row, «Дізнатися більше» gets its own. Three buttons on one row truncate to ellipses at a large font size.

**Images.** `Article.image_url` is passed to `sendPhoto` directly; Telegram fetches it — the Worker never downloads or re-encodes the image, which is what keeps this inside the CPU budget.

When `image_url` is `null`, or `sendPhoto` fails on it, the message is sent as text via `sendMessage` with previews disabled. There is no generated fallback card: the Workers free plan allows 10 ms of CPU per request, and while time spent waiting on network I/O does not count against that, rasterising an image does. Generating a card is not viable here.

Two things this rules out, deliberately:

- **No AI-generated illustration**, in any configuration. Generated chemistry imagery produces nonexistent molecules, impossible bonds, and wrongly assembled glassware — invisible to a general reader, instantly visible to her. A missing picture is a smaller failure than a wrong one.
- **No stock photograph of unrelated glassware.** It would be decoration pretending to be information.

An imageless day is a plainer message, not a broken one. In practice it should be rare: every core feed publishes `og:image`.

### 5.4 Відгук — feedback handler

**Purpose:** record taps and report them.
**Interface:** the Worker's `fetch` handler, receiving Telegram's webhook POST for a `callback_query`.

Because the Worker is always addressable, taps are handled the moment they happen: the `answerCallbackQuery` call returns inside Telegram's acknowledgement window and she sees her toast immediately. This is the concrete reason Cloudflare beats a scheduled-job host — on GitHub Actions the tap would be recorded a day later, and the button would spin and die with no response.

Three buttons, recorded against the sent article:

| Button | `callback_data` | Meaning |
|---|---|---|
| ❤️ Подобається | `like` | She liked it |
| 👎 Не цікаво | `dislike` | She did not |
| 🔍 Дізнатися більше | `more` | She wants more on this topic |

Feedback is button-only. She is never asked to type a reply — typing on a phone at 75 is a barrier, and a free-text answer would need reading and handling.

Taps are idempotent per article: a second tap replaces the first rather than adding a row, so changing her mind is possible and the counts stay honest.

Tapping acknowledges with a short Ukrainian toast and nothing else — except for `more`, where the toast must not promise what v1 cannot do. A button labelled «Дізнатися більше» that produces only «Дякую» is a broken promise; one that says the author has been told is true, because the weekly digest tells her. Every Sunday at 20:00 `TIMEZONE` the bot sends the **author** (not the reader) a digest: what was sent, what she tapped, and every `coined_term` from the week.

In v1 feedback is recorded and reported. It does not yet drive selection.

### 5.5 Data

One D1 database, four tables. D1 *is* SQLite, so the schema is unchanged from a local-file design and the same statements run against `wrangler d1 execute` locally:

```sql
CREATE TABLE seen (
  url TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL   -- candidate stays eligible for 7 days from here
);

CREATE TABLE sent (
  send_date   TEXT PRIMARY KEY,       -- YYYY-MM-DD, idempotency key
  url         TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  headline    TEXT NOT NULL,
  coined_term TEXT,
  sent_at     TEXT NOT NULL
);

CREATE TABLE feedback (
  send_date TEXT PRIMARY KEY REFERENCES sent(send_date),
  button    TEXT NOT NULL,     -- 'like' | 'dislike' | 'more'
  tapped_at TEXT NOT NULL
);

CREATE TABLE backlog_used (
  slug    TEXT PRIMARY KEY,       -- filename of the evergreen item
  used_at TEXT NOT NULL
);
```

`sent.send_date` as primary key makes sending idempotent: a process restart cannot double-send.

`feedback.send_date` as primary key gives one verdict per article; a changed mind is an upsert, not a second row.

`sent.url` holds a `backlog:<slug>` sentinel when the day's message came from the evergreen backlog, so the `sent` table remains a complete record of what she has received.

**Against the free-tier ceiling** — 5M row reads and 100K row writes per day — this design uses roughly a few hundred reads and under ten writes daily. The `seen` table is the only one that grows without bound; a monthly prune of rows older than 30 days keeps it flat, and even unpruned it would take years to matter against 5 GB.

## 6. The Ukrainian-only rule, enforced

Every string the **reader** can see is Ukrainian: buttons, `/start`, every error message, the feedback toast. The one exception is messages sent to `AUTHOR_CHAT_ID` — alerts and the weekly digest — which are diagnostics for the author and never reach her chat.

The summary body is checked mechanically. A validator rejects any body containing a Latin-script word, allowing chemical formulas, element symbols, and SI units through a permitted-token list. This runs as a unit test against golden outputs **and** at runtime — a body that fails validation causes the editor to fall through to the next candidate rather than sending Latin text to her.

## 7. Scheduling and hosting

**Host:** Cloudflare Workers, free plan. One Worker with two entry points — a `scheduled` handler for the cron and a `fetch` handler for the Telegram webhook. State lives in D1. Nothing else is deployed.

**Send time: 08:00 `Europe/Kyiv`, correct on both sides of a DST change.**

This needs care, because **Cloudflare cron triggers run in UTC and have no timezone option.** The commonly given advice is to write `0 6 * * *` in summer and `0 7 * * *` in winter and hand-edit `wrangler.toml` twice a year. That is a standing appointment to forget, and the failure is silent: one morning in late October the message simply arrives an hour early, forever.

Instead the cron runs **hourly** (`0 * * * *`) and the handler decides:

```
on each hourly tick:
    now_kyiv = current time in TIMEZONE        // Intl.DateTimeFormat, built into the runtime
    if now_kyiv.hour != SEND_HOUR:  return
    if sent row exists for now_kyiv.date:  return
    run the pipeline
```

DST is then handled by the platform's own timezone database rather than by remembering. The cost is 24 invocations a day against a free budget of 100,000, and `sent.send_date` as primary key (§5.5) already guarantees the second tick of any hour does nothing. The same tick handles the Sunday digest.

**Stack:** TypeScript on the Workers runtime. Deliberately few dependencies, because most of what a Python version needed is built in:

| Need | Python version used | Workers uses |
|---|---|---|
| HTTP | `httpx` | `fetch()` — built in |
| HTML / og:image | `beautifulsoup4` | `HTMLRewriter` — built in, streaming |
| Database | `sqlite3` + disk | D1 binding — built in |
| Scheduling | `JobQueue` | cron trigger — built in |
| Telegram | `python-telegram-bot` | plain `fetch()` to the Bot API |
| Feeds | `feedparser` | a small XML parse; RSS needs little |
| Fallback card | `Pillow` | *removed* — see §5.3 |

`wrangler` is the only development dependency.

**Configuration.** Secrets via `wrangler secret put`, non-secrets as `vars` in `wrangler.toml`. The Worker validates all of them on first invocation and alerts the author if any is missing, rather than discovering it at 08:00.

| Name | Kind | Format | Example |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | BotFather token | `123456:ABC-...` |
| `GEMINI_API_KEY` | secret | AI Studio key | `AIza...` |
| `TELEGRAM_WEBHOOK_SECRET` | secret | random string | — |
| `READER_CHAT_ID` | var | integer | `987654321` |
| `AUTHOR_CHAT_ID` | var | integer | `123456789` |
| `SEND_HOUR` | var | integer, 0–23 | `8` |
| `TIMEZONE` | var | IANA name | `Europe/Kyiv` |

`TELEGRAM_WEBHOOK_SECRET` is set via `setWebhook`'s `secret_token` and checked against the `X-Telegram-Bot-Api-Secret-Token` header on every request. A Worker URL is public; without this check anyone who finds it can forge callbacks into the database. Requests failing the check get a 401 and are not processed.

## 8. Error handling

The governing rule: **the daily message never silently fails to arrive.** That is the single failure mode that kills the habit.

| Failure | Behaviour |
|---|---|
| A feed times out or returns malformed XML | Skip that feed, continue with the rest |
| Every feed fails | Send from the evergreen backlog, alert the author |
| Selection returns `null` (nothing clears the bar) | Collect the widening tier and re-run selection over it; if still `null`, send from backlog |
| The article page fetch fails or yields no usable text | Write from the RSS blurb instead; send text-only |
| The article page has no `og:image` | Send text-only. Not an error |
| Writing call fails or returns invalid JSON | Retry once, then fall through to the next-best candidate |
| Gemini blocks the request or returns `finishReason: SAFETY` / `PROHIBITED_CONTENT` | Treat as a normal skip — drop that candidate, try the next. Expected occasionally for a chemistry feed: articles on energetic materials or toxin research trip the dangerous-content category. Never surfaced to the reader. `safetySettings` are set to block only high-probability harm, so ordinary chemistry coverage is not caught |
| Gemini free-tier quota exhausted (HTTP 429) | Cannot happen at 2 calls against 1,500/day, so treat it as a real fault: alert the author and send from backlog rather than retrying into a wall |
| Ukrainian-only validation fails | Fall through to the next candidate |
| Rendered caption exceeds 1024 characters | Ask the editor to shorten once; if still over, fall through |
| `sendPhoto` fails on the image | Retry once as a text-only `sendMessage` |
| Telegram send fails entirely | Retry with exponential backoff up to 5 attempts, then alert the author |
| The Worker is re-invoked after a successful send | `sent.send_date` prevents a second send — this is load-bearing now, since the cron fires hourly |
| A webhook request arrives with a bad or missing secret token | 401, no processing, no database write |

**Evergreen backlog:** a small set of pre-written Ukrainian summaries of durable chemistry topics, bundled into the Worker at build time — at least 14, so a fortnight of total pipeline failure still produces no repeats. Used only when the pipeline produces nothing. Each use is recorded in `backlog_used`, and the least recently used unused item is picked. Each carries an `image_url` to a stable public image, or none. Because these are written and checked by the author by hand, they are also the one part of the product where the Ukrainian is guaranteed correct — which makes them worth writing properly rather than treating as filler.

**Author alerts** go to `AUTHOR_CHAT_ID` via the same bot. They are the only messages permitted to contain English, since they are diagnostics for the author, not content for the reader.

## 9. Testing

| Unit | Test |
|---|---|
| Збирач | Fixture RSS files in, expected candidate list out. A URL in `sent` is dropped; a URL seen 3 days ago is still eligible; one seen 8 days ago is not. Malformed feed does not raise. |
| Редактор | Golden-file checks on the structured output: schema conformance, paragraph count, visible caption length under 900, no Latin-script words in the body. Safety-block, invalid-JSON, and fetch-failure paths fall through or degrade rather than throw. |
| Кур'єр | Mocked Bot API. Asserts one send and only one; caption under 1024 with tags stripped; all three buttons on two rows; HTML well-formed. **Any `sendMessage` path sets `link_preview_options.is_disabled`** — the one route by which English could reach her. |
| Відгук | Each of the three callback values writes the expected `feedback` row. A second tap on the same article replaces the first rather than adding a row. A request with a wrong secret token is rejected and writes nothing. |
| Scheduling | With `TIMEZONE=Europe/Kyiv` and `SEND_HOUR=8`, the handler fires on the 05:00 UTC tick in winter and the 06:00 UTC tick in summer, and on no other tick. **Run this against a date either side of the last Sunday in March and in October** — this is the test that would have caught the hand-edited-cron failure. |
| Backlog | 14 consecutive total-failure days produce 14 distinct items. |
| Config | A missing secret or var alerts the author on first invocation rather than failing at send time. |
| Idempotency | Twenty-four hourly ticks on one date produce exactly one send. |
| End-to-end | Dry-run mode renders the day's message to the console instead of sending. |

Dry-run mode is the primary development tool: it is how the author tunes reading level and length without messaging her grandmother. `wrangler dev --test-scheduled` drives the cron path locally by hitting `/__scheduled`, so the daily pipeline can be exercised on demand without waiting for a tick.

## 10. Setup checklist

Legibility is mostly set on the phone, not in the code. A Telegram bot cannot control font size — that is a client-side setting.

**Accounts** — none of these require a payment method:

1. Google AI Studio: create an API key. Put it in a **dedicated Google Cloud project with billing disabled**, and leave it that way (§5.2).
2. Cloudflare: free account, `wrangler login`, `wrangler d1 create`, apply the schema.
3. BotFather: create the bot, record the token.
4. Deploy, then register the webhook with `setWebhook`, passing `secret_token`.

**Her phone** — legibility is mostly set here, not in the code. A Telegram bot cannot control font size; it is a client-side setting.

5. Open the bot on her phone and tap Start. Record the resulting chat ID as `READER_CHAT_ID`.
6. **Telegram → Налаштування → Розмір тексту → set to a large value.**
7. **Telegram → Налаштування → set the light theme** for contrast.
8. Pin the chat to the top of her chat list.
9. Confirm notifications for the chat are enabled — the notification is the habit trigger.
10. Send one dry-run message and watch her read it.

**Before handing it over:** run a week of dry-run output past someone who reads Ukrainian chemistry, or read it closely yourself. The free-tier model is the weak point (§5.2), and the cheapest place to find that out is before she is reading it every morning.

Steps 3 and 4 do more for legibility than any formatting decision available in the code. They are required, not optional.

## 11. Cost

**€0 per month. No payment method is registered anywhere in this design.**

| Line | Provider | Free allowance | Daily need |
|---|---|---|---|
| Content | RSS feeds | unmetered, keyless | ~7 fetches |
| Writer | Gemini 3 Flash free tier | 1,500 requests/day | 2 |
| Compute | Cloudflare Workers free | 100,000 requests/day | ~24 cron ticks + a few taps |
| Database | Cloudflare D1 free | 5 GB, 5M reads / 100K writes per day | a few hundred reads, <10 writes |

Every line sits two to three orders of magnitude under its ceiling. This does not grow into a bill by accident; it would need a deliberate change of scope to get near one.

**What zero costs.** Two things, recorded so they are not rediscovered later as surprises:

1. **The Ukrainian is weaker than it would be on a paid frontier model.** Chemical nomenclature is the specific weakness, and a career chemist is the specific reader who will catch it. §5.2 sets out the three guards. This is the real price of the configuration, and it is paid in the product's core quality rather than in money.
2. **No fallback image.** Days without an `og:image` are plain text (§5.3).

Two considered alternatives were rejected, with reasons kept in case the question returns:

| Rejected | Why |
|---|---|
| Oracle Cloud Always Free ARM VM | Would have kept a Python stack. But Oracle reclaims instances under ~10–20% CPU across 7 days, and a bot idle 23 hours 59 minutes a day is exactly that profile — staying alive means burning CPU to look busy. Halved to 2 OCPU / 12 GB on 15 June 2026, and asks for a card at signup. |
| GitHub Actions cron | Free minutes are ample. But there is no persistent disk, so state must be committed back to the repo, and **scheduled workflows are auto-disabled after 60 days of repository inactivity**, warned only by an email. Silent failure is the one outcome §8 exists to prevent. It also cannot answer a button tap in real time. |

**If the nomenclature turns out to be the problem**, the smallest fix is to move only the writing call to a paid frontier model — about $3 a month — and change nothing else. The architecture does not assume which model writes; §5.2 is the only section that would change.

## 12. Out of scope for v1

Quizzes. Vocabulary lists. Images beyond the one attached to the article. A web archive. Personalization driven by feedback. Multiple articles per day. A second reader. Viber.

Each of these is a reasonable v2 candidate. None of them is allowed to delay the habit.
