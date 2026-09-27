# linkedin-tech-meme-agent

Reads TechCrunch, decides which AI/CS stories are actually worth posting about,
writes them up in a Fireship-ish voice, draws a meme, and publishes to LinkedIn
twice a week (Tue and Thu).

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
npm test                      # 278 tests, no network needed
npm run templates:preview     # render every meme template to data/out/
npm run linkedin:auth         # one-time LinkedIn OAuth, writes .env for you
```

---

## How a run works

| Stage | Folder | What it does | LLM calls |
|---|---|---|---|
| 1. Scrape | `src/scraper/` | TechCrunch RSS, falls back to HTML for the full body. Caches responses, respects robots.txt. | 0 |
| 2. Classify | `src/classifier/` | Keyword scoring decides most articles for free. Only the grey zone goes to the model. | ~0.3 per article |
| 3. Curate | `src/curator/` | Scores "meme-ability", shortlists 8, then one call ranks them, gives each pick an angle, and ranks two spares. | 1 per run |
| 4a. Read | `src/content-engine/insight.js` | Reads the full article: what happened, the specifics, what developers miss, the one point to make. A story with nothing to add is **turned down** and a spare is used. | 1-2 per post |
| 4b. Write | `src/content-engine/` | Picks a shape and ending the story can carry, writes several first lines, rates them, then writes the post around the one that wins. | 3 per post |
| 4c. Judge | `src/content-engine/quality.js` | Free checks, then one call scoring six named dimensions. Below the floor it is rewritten once, then **held**, and the next story gets the slot. | ~1 per post |
| 5. Humanize | `src/humanizer/` | Strips AI tells mechanically, then one editor pass, then strips again. | 1 per post |
| 6. Media | `src/meme-generator/` | Rotates square / portrait / text-only, then picks a template that suits the post. Drawn locally with sharp. | 0 |
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
| Cost per post | about $0.003 | $0 marginal |
| Cost per month | **about $0.05** | **about $15**, whether it posts or not |
| Cost per year | about $0.60 | about $180 |
| Infra to run | none | you size, patch and monitor a box |
| Output quality | better at sarcasm and concrete detail | noticeably blander at 7B |
| Failure mode | rate limit, retried | box is down, nothing posts |

Where the monthly $0.05 goes, at roughly 20 new articles per run (the
writing line is measured: 16 real stories cost $0.040 end to end):

| Call | Per week | Cost per week |
|---|---|---|
| classify (only ambiguous articles) | ~18 | $0.0018 |
| curate | 3 | $0.0017 |
| insight, hooks, hook rating, write-post, judge | 15-18 | ~$0.008 |
| humanize editor pass | 3 | $0.0010 |
| | | **~$0.012/week** |

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
SCHEDULE_CRON="30 9 * * 2,4"       # Tue/Thu 09:30
SCHEDULE_TIMEZONE="Asia/Kolkata"
```

Running locally, `node-cron` reads these directly. On Lambda, EventBridge is
the scheduler and you set `ScheduleExpression` on the stack instead — note
that **EventBridge cron is always UTC**, so the default there is
`cron(0 4 ? * TUE,THU *)`, which is the same 09:30 IST.

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

### Story frames

A frame is the angle a story gets told from, and it is what a reader actually
notices repeating. Dedupe used to run on proper nouns alone, so "Cymphony
raises to fix rogue agents" and "Relay shut down, 42% of AI projects failed"
looked unrelated. They are the same post: *AI is failing*. A day apart, that
reads as a page with one opinion.

Seven frames live in [src/curator/frames.js](src/curator/frames.js): `broke`,
`hype-check`, `absurd-money`, `shipped`, `foot-gun`, `irony`, `grind`.

Two layers decide them:

1. A **cheap keyword guess** runs on every shortlist candidate. It only shapes
   the shortlist, never the stored answer, because it is wrong often enough
   that it should not get the final say. A story it cannot read is labelled
   `unclear` rather than guessed at, and `unclear` is exempt from both the
   penalty and the cap — an absence of evidence is not evidence of repetition.
2. The **model assigns the real frame** in the curation call it was already
   making. That is what gets stored on the post and cooled down. A frame it
   invents falls back to the guess.

Two mechanisms use it:

- A **soft score penalty** (`curator.framePenalty`) for frames used in recent
  posts, halved when the guess is not confident. This carries between runs.
- A **hard cap** (`curator.maxPerFrame`) on how many of one frame can fill the
  shortlist. This is the one that matters: the penalty cannot help inside a
  single run, because if the eight highest scorers are all failures the model
  has nothing else it could pick, whatever the prompt asks it to do.

There is also a `positive` signal in `memeSignals`, because every other signal
rewards something going wrong — `funnyWords` is almost entirely *outage,
broke, crash, deleted, hacked* — and without a counterweight the page turns
into one long obituary.

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

### How a post ends

The ending rotates on its own counter, separately from the shape and the
opener. Six of them live in `CLOSER_STYLES` in the same file:

| Ending | What it does |
|---|---|
| `argument-bait` | a question worth arguing with |
| `flat-verdict` | a statement, no question mark |
| `prediction` | calls what happens next, as fact |
| `dare` | dares the reader to disagree |
| `aside` | a muttered throwaway line |
| `none` | the post just stops |

`none` is in the list on purpose. Every post ending with a question was the
loudest sign that a feed came off a production line, and it is tiring to read.

A shape either takes a turn of this rotation (`closer: 'rotate'`) or ends
itself (`closer: 'own'` — the zinger and the rant, where stopping dead *is*
the shape). Shapes that end themselves don't consume a turn, so the endings
stay evenly spread across the posts that actually use one.

### How long a post runs

Each shape carries its own word range, and a rotating *length mood* picks a
point inside it:

| Shape | Words |
|---|---|
| `two-line-zinger` | 14–30 |
| `quote-reaction` | 22–60 |
| `receipts` | 25–70 |
| `terminal-log` | 35–85 |
| `slow-burn-rant` | 40–105 |
| `classic-take` | 55–155 |

The moods are `tight` (the bottom of the range), `short`, `mid` and `full`
(the top). They are listed in `content.lengthMoods` in a deliberately
non-monotonic order — `tight, mid, short, full` — so consecutive posts swing
between lengths instead of ramping up and resetting.

The ranges are per shape rather than global because they are not comparable: a
`full` zinger is still shorter than a `tight` classic take, and a 150-word
zinger is not a zinger.

`content.maxWords` is a hard ceiling over all of them. Nothing is trimmed to
fit — cutting a post mid-sentence does more damage than the overrun — but an
overrun is logged, because a shape that always overshoots has a prompt that
needs work.

Four rotations of six, five, six and four advance independently, so the same
combination is effectively out of reach.

### Choosing the hook

The first line is a stage of its own, and it comes before the body:

1. The model writes four candidates, each in one of the opening styles, from
   the story and the point the insight step found.
2. [hook-scorer.js](src/content-engine/hook-scorer.js) scores each with plain
   rules: length, clichés, a list of **generic hook** patterns ("Looks like…",
   "Most of us think… X proves otherwise", "It's like…" with no subject), and
   whether the line contains anything from *this* story - a name or a number.
   A line that could sit on top of any post is marked down hard.
3. One cheap call rates each candidate 1-5 for **specific curiosity**: does
   it give a developer a concrete reason to read line two, without promising
   more than the post says?
4. The two scores are combined (the rating counts for more), and anything
   within `content.hookJitter` of the top is a contender, picked at random.
   The last post's opening style is marked down slightly, which is what now
   keeps openings varied - styles no longer rotate one per post.
5. The body is written **around the chosen line**. It used to be written in
   the same reply as the hooks and stapled under whichever one won.

The rules keep a veto: a generic line the rater liked still loses to a
specific one. A dry run marks the line that ran with `>` and shows both
scores.

### Is the post any good?

Everything else here checks structure. None of it can tell whether a post
says anything, and a post went out that proved it:

> "But reasoning has always been something that we've relied on the frontier
> model providers for." - Jayesh Govindarajan
>
> Salesforce just gave spreadsheets a reason to take over.
> This should be interesting.

Four things now stand between a story and a publish.

**The story is read before anything is written.**
[insight.js](src/content-engine/insight.js) reads the whole article and
answers: what happened, what is specific about it, why it matters, what a
developer skimming the headline would miss, and the one point the post should
make. That point has to name something from the story; a trend statement ("AI
agents are creating security risks") gets one retry and then the story is
turned down. The writer is told the point and the specifics, and told not to
summarise.

The step also scores *substance* 1-5, and below `content.insight.minSubstance`
the story is turned down. Be aware that gpt-4o-mini scored sixteen of sixteen
real stories 4/5, so in practice this rarely fires; the judge below is what
really catches thin stories.

**The story picks its own format.** The insight step names the shapes that
suit the story (each shape has a `suits` line), and each shape's own `fits()`
check has to agree. Endings that need a disagreement (`argument-bait`,
`dare`) only run when the insight found one. The rotations still choose among
what is left, so they prevent repetition without overriding fit. Opening
styles that need something (a `number-drop` needs a number) are only offered
when the story has it.

**The point has to survive a "so what?" test.** The insight step works in
order: what happened, the key evidence (each fact with the words from the
article that support it, and any fact whose quote is not in the article is
dropped), why it is interesting, the implication, **the one point** the
reader should take away, and why this audience should care. It also says
whether a comparison with another company is supported by the story. The
point is then tested before anything is written: it must name something from
the story, must not be a stock conclusion ("developers need to rethink…",
"the competition is heating up"), must rest on at least one verified fact,
and must fail the model's own name-swap test (rewritten for an unrelated AI
story, it should stop making sense). One retry, then the story is turned
down.

The writer is told which lines are fact and which are interpretation, to
hedge interpretation ("may", "probably"), never to state a cause the story
does not, never to invent a rivalry, trend or reaction, and to build the post
as hook, evidence, interpretation, point. It may not claim any first-person
experience except what is in `AUTHOR_CONTEXT`, which is empty by default. The
opening style that used to be called `fake-confession` is now
`uncomfortable-truth`, and admits things about the work, never the author.

**Free checks.** Filler endings (checked on the last line however the shape
ended), generic hooks, numbers the story never gave (ratios like "seven in 10"
count as 70%), lines cut mid-sentence, more than one question, analyst-report
voice ("this shows", "highlights", "in a crowded market"), openings or
endings copied from a recent post, and the point-level checks: empty
reactions ("That's creepy", "Funny how that works"), generic conclusions,
causes stated as fact that the story does not state, rivalries the story never
describes, invented first-person experience, invented dates, and two or more
claims that would fit under any AI story. They run before anything is spent, and
again after the humanizer's editor pass: if the editor breaks a checked post,
the checked version ships.

**One call that reads the post against the story.** It scores eleven named
dimensions - hook, specificity, insight, accuracy, voice, coherence, point,
implication, information value, non-genericness and evidence/inference
separation - and answers direct questions: finish "this post argues
that…", would the post survive a name swap, does the hook set up the point,
are there several unrelated ideas, and which lines are filler, empty
reactions, unsupported claims or invented narratives. It can hold a post as
"accurate but boring", "specific but no meaningful takeaway" or "the facts are
correct, but the conclusion is generic". Point, information value and
non-genericness have their own floor, `MIN_POINT_SCORE` (default 3): at 4
far fewer posts pass. A post is held if any of
hook, specificity, insight or accuracy is under `content.quality.minDimension`,
if the average is under `minScore`, if it only summarises the story, if the
hook is generic, or if two or more lines are filler. The judge has to say
*why*, quoting the line, and that is what the rewrite is told.

A post that fails gets **one** rewrite - same shape, same ending, same length,
and the same first line if the judge had no problem with it. If it still
fails it is saved as `held`, the story is not offered again, and the next
spare story gets the slot, so a thin story does not cost the run its post.

A held post is refused by the scheduled run and by `npm run publish`, which
prints the verdict and offers `--force`. A gate that only logs is not a gate.

**Choosing the review model.** `LLM_REVIEW_MODEL` sets the model for the calls
that judge rather than write (insight, hook rating, judge). Measured on the
same sixteen stories: with gpt-4o-mini reviewing, 12 passed; with gpt-4o
reviewing, 6 passed and it was clearly stricter, for roughly ten times the
cost. Using gpt-4o as the *writer* as well did not help - it invented more
numbers, which the free checks caught.

### Hashtags

Measured over the first thirteen posts, before any of this existed:

```
#MachineLearning  11 of 13  (85%)      five of the fifteen configured tags
#AIAgents          9 of 13  (69%)      were never used once
```

Twelve of the thirteen sets were exactly three tags long, and two pairs of
posts carried the identical set reordered. The cause: the model was asked for
tags, the list was topped up from a fixed array read front to back, and
nothing remembered anything.

Two forces pull against each other here. Variety says rotate; relevance says
an AI story really does want the AI tags every time. A post tagged
`#Kubernetes` because `#Kubernetes` was next in a queue is worse than a
repeated tag — it is a lie about what the post is about.

So **relevance decides who is eligible and variety decides between them**.
Tags are grouped by subject in
[src/content-engine/hashtags.js](src/content-engine/hashtags.js) and matched
to a story through its frame: `foot-gun`→security, `absurd-money`→money,
`shipped`→code, and so on. Three tiers of relevance — the writer's own picks,
then the frame's groups, then `core` — and a tag in no tier is never chosen,
however overdue it is.

On top of that, the same two-horizon pattern as the meme templates:

| Setting | What it does |
|---|---|
| `hashtagCooldown` (3) | a tag used this recently is barred |
| `hashtagMaxShare` (0.4) | no tag may exceed this share of the window |
| `hashtagHistory` (25) | how far back fatigue is measured |
| `hashtagSetCooldown` (10) | how far back an exact *set* is compared |
| `hashtagCounts` | the size rotates, so sets stop being uniformly 3 |

`hashtagMaxShare` is the one that matters — it is what stops the model's
favourite three tags riding along on every post.

**When a story is genuinely thin**, the bars relax in order (share first, then
cooldown) but never past relevance. A story that only supports two tags gets
two; it will not pad. A relaxed run is reported in the log rather than
happening silently.

Simulated over 50 posts with the writer stubbornly suggesting the same three
AI tags every time: highest share **28%** (was 85%), **26** distinct tags
(was 10), sizes spread across 3/4/5, and the closest identical set 12 posts
apart. `npm run dry-run` prints why each tag was chosen.

### Media

Every post used to get the same thing: a 1200×1200 square with two lines of
capitals, drawn at random from whatever templates had not been used in the
last eight posts.

**What kind of media** rotates per post, on the same store-backed counter as
everything else — `meme-square` (1:1), `meme-portrait` (4:5, taller in a
phone feed), and `text-only`. Text-only is a real treatment, not a failure: a
feed where every single entry carries a matching square is its own kind of
obviously-automated. Set them in `memeGenerator.treatments`.

**Which template** is chosen, not drawn. Each post shape declares a `layouts`
affinity, so a `terminal-log` post gets a terminal picture and a
`quote-reaction` gets the quote layout. Affinity is a preference rather than a
lock — there are only two terminal templates, and a hard rule would make that
shape alternate between the same pair forever.

Two horizons do two different jobs:

- `templateCooldown` (8) is a **hard bar**. A template used inside it cannot
  be picked at all, as long as anything else is available.
- `templateHistory` (40) is how far the picker **looks** when deciding who is
  most overdue.

They have to be different numbers. With only the cooldown to go on, a template
unused for thirty posts looks identical to one unused for nine, the ranking
settles into a fixed orbit, and some templates never come up. Measured: at a
single horizon of 8 this cycled through ten of the twelve templates forever
and drew `red-alert` and `paper-white` exactly never. With the split, all
twelve appear 3–4 times over 40 posts.

**Layout is cooled down as well as template name.** Four of the twelve
templates are the `classic` shape, so `hot-take` followed by `red-alert` used
to count as variety while being one picture in different colours.

```bash
npm run templates:preview     # every template in every size, to data/out/
```

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

### One memory, not two

This is worth understanding before you run anything locally that publishes.

The agent originally kept **two** memories. Local runs wrote `./data/*.json`;
Lambda wrote DynamoDB. Neither knew the other existed. So when a post was
published from a laptop with `npm run publish`, the scheduled Lambda never saw
it: both rotation counters stayed near zero, both runs picked the first
opening style and a random template from a full pool, and the two posts came
out looking like the same post. The article dedupe was split the same way, so
the same story could go out twice.

Three things now stop that:

**The counters are a cache, not the source of truth.** When a rotation counter
is missing, it is rebuilt by counting the posts that actually used that
rotation, so a fresh store with history in it carries on instead of starting
the feed again. Each rotation counts its own posts, because they do not all
advance once per post — the endings rotation skips shapes that end themselves.

**Publishing live from the JSON store is refused.** `npm run publish` with
`STORE_DRIVER=json` and `PUBLISHER=linkedin` stops with an explanation rather
than quietly desyncing. Dry runs and the console provider are unaffected.
`ALLOW_JSON_STORE_FOR_LIVE_POSTS=true` opts back in.

**There is a migration.** To bring existing local history into the table:

```bash
npm run store:migrate                 # prints what it would do
npm run store:migrate -- --confirm    # writes
```

Articles and posts are copied only if missing, so the live store always wins.
Rotation counters take the **highest** of the two, never the newest — a
counter going backwards replays a stretch of the rotation, which is the bug
this whole thing is about. Everything else takes the most recent value. It is
safe to run twice.

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

278 tests over the parts most likely to degrade quietly rather than crash:

- **classifier scoring** — that AI stories pass, e-bike stories don't, exclude
  keywords actually bite, and `ai` doesn't match inside `email` or `chair`.
- **quality gate** — that the post which actually shipped is caught by the free
  checks, that the good post is not, that every filler closer is recognised,
  that shapes decline stories they cannot carry, and that an unreachable judge
  never blocks a run.
- **hashtags** — that a tag nothing made relevant is never chosen even when
  everything relevant is fatigued, that a dominant tag is barred once it
  passes its share, that a thin story gets a short honest set rather than
  padding, that no set repeats inside its cooldown over 60 posts, and that the
  count rotation rebuilds itself from post history.
- **media selection** — that a template cannot return inside the cooldown, that
  consecutive posts never share a layout, that every template gets used over a
  long run, that a shape affinity is honoured but can be overridden, and that
  text-only produces no image.
- **store persistence** — that both drivers behave identically, that cooldowns
  count drafts while analytics does not, that a rotation counter can never go
  backwards through a migration, that migrating twice is a no-op, and that a
  store which loses its counters resumes from post history instead of
  restarting the feed.
- **dedupe** — that the same URL always produces the same id even with
  tracking params, that saving twice stores once, and that a used article is
  never offered again.
- **story frames** — that a repeated frame lowers a story's score, that one
  frame cannot take over the shortlist, that the cap keeps the best of a
  capped frame rather than a random three, and that a bare announcement is not
  mistaken for a genuinely good release.
- **humanizer** — that every banned phrase is stripped, em-dashes are capped,
  contractions keep their capitals, and clean text is left alone.
- **hook scoring** — that a specific hook beats a vague one, that clichés
  lose, and that jitter can reach a near-tie but never a genuinely weaker line.
- **content engine** — that the story is read before hooks are written and
  the body is written around the winning hook, that a thin or generic story
  is turned down before any rotation moves, that only shapes the story suits
  are reachable, that a held post hands its slot to the next story, and that
  an editor pass which breaks a checked post is reverted.
- **post shapes** — that no two shapes assemble into the same skeleton, that a
  shape which forbids a closing question never gets one, that a closer the
  model volunteers is dropped when the ending is `none`, that no shape can ask
  for more words than the global ceiling, and that a half-empty model response
  still produces something postable.

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
