# linkedin-tech-meme-agent

Reads TechCrunch, decides which AI/CS stories are actually worth posting about,
writes them up in a Fireship-ish voice, draws a meme, and publishes to LinkedIn
three times a week.

It is built as a loop, not a pipeline: it perceives (scrape + classify),
reasons (curate, with a justification for each pick), acts (write, humanize,
render, publish), and learns (pulls engagement back in and feeds it into the
next round of prompts).

---

## Quick start

```bash
npm install
cp .env.example .env          # fill in OPENAI_API_KEY at minimum

npm run dry-run               # builds one real post, publishes nothing
```

The dry run prints the post, the hook candidates with their scores, what the
humanizer stripped, and where it saved the meme image. Run it a few times
until the output looks like something you would actually post.

Then:

```bash
npm run dev                   # admin API on :3001 + cron scheduler
npm test                      # 67 tests, no network needed
npm run templates:preview     # render every meme template to data/out/
npm run linkedin:auth         # one-time LinkedIn OAuth, writes .env for you
```

---

## How a run works

| Stage | Folder | What it does | LLM calls |
|---|---|---|---|
| 1. Scrape | `src/scraper/` | TechCrunch RSS, falls back to HTML for the full body. Caches responses, respects robots.txt. | 0 |
| 2. Classify | `src/classifier/` | Keyword scoring decides most articles for free. Only the grey zone goes to the model. | ~0.3 per article |
| 3. Curate | `src/curator/` | Scores "meme-ability", shortlists 8, then one call ranks them and gives each pick an angle. | 1 per run |
| 4. Write | `src/content-engine/` | One call returns 4 hooks and the post. Each post is written to a different shape, and we pick the hook with plain rules. | 1 per post |
| 5. Humanize | `src/humanizer/` | Strips AI tells mechanically, then one editor pass, then strips again. | 1 per post |
| 6. Meme | `src/meme-generator/` | Draws the image locally with sharp. | 0 |
| 7. Publish | `src/publisher/` | LinkedIn API, or the console provider which saves to disk. | 0 |
| 8. Learn | `src/store/analytics.js` | Pulls likes/comments back, works out what did well, writes it into the prompts. | 0 |

Each stage reads and writes through `src/store/`, so a run that dies halfway
can be re-run without redoing the expensive parts, and any stage can be tested
on its own.

---

## The cost decision

**Chosen: a hosted API (OpenAI `gpt-4o-mini`), not a self-hosted model.**

At three posts a week the call volume is genuinely tiny, and the arithmetic is
not close.

| | Hosted `gpt-4o-mini` | Self-hosted 7B on a VPS |
|---|---|---|
| Cost per post | about $0.002 | $0 marginal |
| Cost per month | **about $0.03** | **about $15**, whether it posts or not |
| Cost per year | about $0.40 | about $180 |
| Infra to run | none | you size, patch and monitor a box |
| Output quality | better at sarcasm and concrete detail | noticeably blander at 7B |
| Failure mode | rate limit, retried | box is down, nothing posts |

Where the monthly $0.03 goes, at roughly 20 new articles per run:

| Call | Per week | Cost per week |
|---|---|---|
| classify (only ambiguous articles) | ~18 | $0.0018 |
| curate | 3 | $0.0017 |
| write-post | 3 | $0.0021 |
| humanize editor pass | 3 | $0.0010 |
| | | **~$0.007/week** |

Self-hosting only wins if you are already paying for a GPU box for something
else and can share it. If that changes, `LLM_PROVIDER=ollama` and
`LLM_BASE_URL=http://your-box:11434` is the whole migration — no code changes,
because every module talks to `src/lib/llm-client.js` rather than an SDK.

Three things keep the bill this low, and they are all worth preserving:

1. **The classifier never calls the model unless the keywords are unsure.**
   In a real run, 53 articles produced 14 calls. The rest were free.
2. **Nothing is ever reprocessed.** An article is classified once, ever,
   keyed by a hash of its URL.
3. **Meme images are drawn locally.** No image-generation API, at any point.

AWS adds roughly $0.10/month: Lambda sits inside the free tier at 3 runs a
week, DynamoDB is on-demand and near-empty, and the container image in ECR is
the only line item that reliably costs anything.

---

## LinkedIn setup

This agent posts to a **personal profile through the official API**. That was
a deliberate choice over the two alternatives:

- **Company Page via the Marketing API** — fully supported for automation, but
  needs a Company Page and an app approved into the partner program.
- **Browser automation** — works without approval, and violates LinkedIn's
  terms. An account restriction is a real outcome, not a theoretical one.
  Not implemented here.

Personal-profile posting via `w_member_social` is the middle path: it is the
official API and it is what the "Share on LinkedIn" product is for. The catch
is that member tokens are short-lived, so this needs occasional attention.

### Getting a token

```bash
npm run linkedin:auth
```

That opens LinkedIn in your browser, catches the redirect on a throwaway local
server, swaps the code for a token, looks up your member id, and writes both
into `.env`. You never copy a token by hand.

Before the first run, set up the app once:

1. Create an app at https://www.linkedin.com/developers/apps and associate it
   with a Company Page (LinkedIn requires one even for member posting).
2. **Products** tab: add *Share on LinkedIn* and *Sign In with LinkedIn using
   OpenID Connect*. Both are self-serve and usually instant.
3. **Auth** tab: copy the client id and secret into `.env`, and add
   `http://localhost:4000/callback` as an authorized redirect URL — it has to
   match `LINKEDIN_REDIRECT_URI` exactly, character for character.

   ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```

Then run the command. It prints the account it connected, the scopes granted
and the expiry date, and warns you if `w_member_social` is missing — that one
is the difference between reading your profile and being able to post.

Check it without posting anything:

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" localhost:3001/publisher/verify
```

Finally, to actually go live:

```
PUBLISHER=linkedin
DRY_RUN=false
```

Until you change both of those, nothing is published.

### When it stops working

Member access tokens expire after **60 days**. A `401` from the publisher is
almost always an expired token, not a code problem. Re-run:

```bash
npm run linkedin:auth
```

That is the entire renewal procedure. Refresh tokens are not granted to every
app, so set a calendar reminder for day 55 rather than relying on one. The
CloudWatch alarm in the SAM template tells you when a scheduled run starts
failing, which is the other way you will find out.

Note that the deployed Lambda reads its token from the stack parameter, not
from `.env`, so after renewing you also need to redeploy:
`./infra/scripts/deploy.sh --live`.

---

## Configuration

Everything lives in [src/config/index.js](src/config/index.js). Nothing in the
codebase hardcodes a feed URL, a schedule time, or a hashtag rule.

### Schedule

```bash
SCHEDULE_CRON="30 9 * * 2,3,4"     # Tue/Wed/Thu 09:30
SCHEDULE_TIMEZONE="Asia/Kolkata"
```

Running locally, `node-cron` reads these directly. On Lambda, EventBridge is
the scheduler and you set `ScheduleExpression` on the stack instead — note
that **EventBridge cron is always UTC**, so the default there is
`cron(0 4 ? * TUE,WED,THU *)`, which is the same 09:30 IST.

Change both if you change the schedule, or the local scheduler and the
deployed one will disagree with each other.

### Swapping the LLM provider

```bash
# ChatGPT (default)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...

# a local open-weight model instead
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
LLM_BASE_URL=http://localhost:11434
```

No code changes. To add a third provider, add one function to
[src/lib/llm-client.js](src/lib/llm-client.js) — it needs to
take `{system, user, model, temperature, maxTokens, json}` and return
`{text, inputTokens, outputTokens}`.

### Adding a post shape

A shape is the skeleton of a post: what we ask the model for, and how the
pieces are glued back together. Six ship with the agent (`classic-take`,
`two-line-zinger`, `slow-burn-rant`, `terminal-log`, `quote-reaction`,
`receipts`) and one is used per post, in rotation.

This matters more than the wording does. Rotating only the opening line while
every post kept the same hook / body / question / hashtags frame is what made
the feed look like one template with the nouns swapped out.

Add one entry to `POST_SHAPES` in
[src/content-engine/shapes.js](src/content-engine/shapes.js):

```js
'my-shape': {
  instruction: 'What the model should write, in plain words.',
  fields: [
    { key: 'punchline', type: 'string', description: 'what this field is' },
    { key: 'beats', type: 'string[]', description: 'a list of lines' },
  ],
  assemble: ({ hook, parts, hashtags }) => /* return the finished text */,
}
```

Then add its name to `content.postShapes` in
[src/config/index.js](src/config/index.js). The fields you declare are what
the model is asked for, so nothing else needs to change. Set `overrideHook` if
the shape needs to own its own first line, the way `quote-reaction` does.

The shape rotation (six) and the opening-style rotation (five) advance
separately, so the same pairing does not come round again for thirty posts.

### Adding a meme template

Drop a JSON file into [assets/meme-templates/](assets/meme-templates/):

```json
{
  "name": "my-template",
  "layout": "classic",
  "background": { "type": "gradient", "from": "#0f172a", "to": "#020617" },
  "accent": "#22d3ee",
  "textColor": "#f8fafc",
  "outline": "#020617"
}
```

`layout` is one of `classic`, `two-panel`, `terminal`, `quote`, `chat` — see
[src/meme-generator/layouts.js](src/meme-generator/layouts.js). Then:

```bash
npm run templates:preview
```

The generator will not reuse a template until 8 posts have gone out
(`memeGenerator.templateCooldown`), so more templates means less visual
repetition. Twelve ship with the agent.

To add a whole new *layout* rather than a new colourway, add a function to
`LAYOUTS` in `layouts.js`. It receives `{template, width, height, topText,
bottomText}` and returns an SVG fragment.

### Teaching the humanizer a new tell

When a post goes out and something in it reads like a machine wrote it, add
the phrase to `BANNED_PHRASES` in
[src/humanizer/banned-phrases.js](src/humanizer/banned-phrases.js). This list
is meant to grow — that is cheaper and more reliable than trying to prompt the
tell away. Add a test alongside it.

---

## Admin API

Everything except `/health` needs `Authorization: Bearer $ADMIN_API_KEY`.
If `ADMIN_API_KEY` is unset, the admin routes return 503 rather than opening up.

| Method | Path | What |
|---|---|---|
| GET | `/health` | Alive, plus schedule status and next run time. Open. |
| POST | `/run` | Run a cycle now. `?dryRun=true` builds it but holds it back. |
| GET | `/posts?limit=10` | Recent posts, newest first. |
| GET | `/posts/:id` | One post with the humanizer report and hook scoreboard. |
| GET | `/posts/:id/image` | The rendered meme as a PNG. |
| POST | `/pause` · `/resume` | Stop and restart scheduled publishing. |
| GET | `/publisher/verify` | Check the LinkedIn token without posting. |
| GET | `/learnings` | What the agent currently thinks works. |
| GET | `/config` | Loaded config, secrets stripped. |

---

## Deploying to AWS Lambda

Deployed as a plain zip. You need the AWS SAM CLI and AWS credentials —
**no Docker**.

```bash
./infra/scripts/deploy.sh            # deploys with DRY_RUN=true
./infra/scripts/invoke-once.sh       # trigger a run and tail the logs
./infra/scripts/deploy.sh --live     # publishing on, asks for confirmation
```

The stack ([infra/template.yaml](infra/template.yaml)) creates a
DynamoDB table, a scheduled Lambda on an EventBridge rule, an admin Lambda
behind a Function URL, and an alarm on scheduled-run errors.

### What the build script does, and why

`deploy.sh` runs [infra/scripts/build.sh](infra/scripts/build.sh) first,
which assembles `infra/build/` — the directory the template uploads. It is
more than a copy because of two things that will otherwise bite you:

**1. sharp ships a different native binary per platform.** Installing on a Mac
gets you a macOS `.node` file, and Lambda answers with `invalid ELF header`.
The script installs with `--os=linux --cpu=arm64 --libc=glibc` so npm fetches
the right one, and fails the build if it is missing.

**2. Lambda has no fonts.** This is the one that wastes an afternoon: sharp
renders your meme background perfectly and draws *no text at all*, with no
error anywhere. [fetch-fonts.sh](infra/scripts/fetch-fonts.sh)
downloads DejaVu into `assets/fonts/` (gitignored), `fonts.conf` tells
fontconfig to use it, and the template sets `FONTCONFIG_PATH` so Lambda picks
it up. Locally you need none of this — your machine already has fonts.

The finished package is about 19 MB zipped, well inside Lambda's 50 MB limit.

### Storage switches to DynamoDB

Lambda's filesystem is thrown away between invocations, so the JSON store
would silently lose the dedupe keys and post history the agent depends on.
`STORE_DRIVER=dynamo` is set for you in the template. Locally it stays `json`,
so tests and dry runs need no AWS account.

Note that `data/out/` images are written to Lambda's temporary disk, so
`GET /posts/:id/image` will 404 for posts made by an older container. The post
text and all its metadata are in DynamoDB and survive fine.

### Architecture

Both the template (`Architectures: [arm64]`) and the build script
(`--cpu=arm64`) target Graviton, which is cheaper per millisecond. If you
switch to x86, change **both** or the function will not start.

## Tests

```bash
npm test
```

67 tests over the parts most likely to degrade quietly rather than crash:

- **classifier scoring** — that AI stories pass, e-bike stories don't, exclude
  keywords actually bite, and `ai` doesn't match inside `email` or `chair`.
- **dedupe** — that the same URL always produces the same id even with
  tracking params, that saving twice stores once, and that a used article is
  never offered again.
- **humanizer** — that every banned phrase is stripped, em-dashes are capped,
  contractions keep their capitals, and clean text is left alone.
- **hook scoring** — that a specific hook beats a vague one and clichés lose.
- **post shapes** — that no two shapes assemble into the same skeleton, that a
  shape which forbids a closing question never gets one, and that a half-empty
  model response still produces something postable.

No network and no API key needed for any of them.

---

## Layout

```
src/
  scraper/          RSS + HTML, caching, robots.txt
  classifier/       heuristics.js is the free scoring, index.js escalates
  curator/          meme-score.js is the shortlist, index.js does the ranking
  content-engine/   shapes.js is the skeleton, prompts.js is the voice,
                    hook-scorer.js picks the opener
  humanizer/        banned-phrases.js is the list, rules.js does the work
  meme-generator/   layouts.js draws, text.js wraps, index.js picks templates
  scheduler/        node-cron locally, unused on Lambda
  publisher/        linkedin-provider.js and console-provider.js
  store/            json-driver.js, dynamo-driver.js, analytics.js
  config/           every knob, in one file
  lib/              logger, http-client, llm-client - the generic plumbing
  agent.js          wires the modules together
  pipeline.js       the loop
  app.js            admin API
  server.js         local entry point
  lambda.js         AWS entry points
  cli.js            dry runs and template previews
assets/
  meme-templates/   one JSON file per look
  fonts/            downloaded, gitignored, only needed for Lambda
infra/
  template.yaml     the SAM stack
  scripts/          build, deploy, invoke, teardown, fetch-fonts
tests/
```

`src/lib/` holds the parts that are not specific to this agent — logging, HTTP
retries, the LLM wrapper. Nothing in `lib/` imports from a pipeline stage, so
if you ever build a second agent, that folder is what you lift out.
# Agent-reach
