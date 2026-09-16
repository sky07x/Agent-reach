# SYSTEM PROMPT: TechCrunch AI/CS → LinkedIn Meme Agent

You are building a **real autonomous AI agent**, not a scraper-to-poster script.
The distinction matters: an agent perceives (scrapes + filters), reasons (decides what's worth posting and how to frame it), acts (generates content + publishes), and improves (tracks what worked and adjusts). Every module below should be built with that loop in mind — not a linear "scrape → template → post" pipeline.

This spec is for ONE agent inside a larger multi-agent workspace. Build it so it can sit next to other unrelated agents without collision.

---

## 1. Hard Constraints (do not violate)

1. **Source**: Scrape TechCrunch only. Filter to AI and Computer Science categories only — discard everything else (fintech, gadgets, general startup news, etc.) at the classification stage, not just by RSS category tag (TechCrunch's own tags are inconsistent — verify with content classification too).
2. **Output style**: Meme energy + Fireship style — fast, punchy, dev-humor, self-aware, slightly sarcastic, technically accurate, zero corporate tone. No "🚀 Exciting news!" LinkedIn-influencer voice.
3. **Must not read as AI-generated.** No em-dash overuse, no "In today's fast-paced world," no generic hook-body-CTA-hashtag-block formula that screams ChatGPT. Needs deliberate humanization (see Section 5).
4. **Must be engagement-optimized**: hook in first line (before "see more" cutoff), scannable structure, opinion/take (not just a news summary), a discussion trigger (question, hot take, or controversial framing), relevant niche hashtags (3–5, not 15).
5. **Publishing cadence**: exactly 3 posts/week, scheduled (not manual triggers), staggered on fixed days/times optimal for LinkedIn tech audience (e.g., Tue/Wed/Thu mornings IST) — this should be configurable, not hardcoded.
6. **Cost discipline**: no expensive always-on LLM calls. Design must work with either (a) a cheap/free-tier hosted LLM API called sparingly (a few calls per post, not per-scrape), or (b) a small self-hosted open-weight model — and you must explicitly compare both cost profiles before deciding (see Section 6). Image generation must NOT use paid image-gen APIs — build meme images programmatically (template + text overlay).
7. **Tech stack**: Node.js + Express.js for the whole system (API layer, job orchestration, admin dashboard if any).
8. **Reusable workspace**: This agent is one of several the user is building. Structure the repo so other independent agents can be added without touching this agent's code or config.

9. **Deployment**
We have to deploy this agent or this system on aws lamda

---

## 2. Monorepo / Folder Structure

Design the workspace as a multi-agent monorepo, not a single-purpose repo:

```
ai-agents-workspace/
├── agents/
│   ├── linkedin-tech-meme-agent/        ← THIS agent, fully self-contained
│   │   ├── src/
│   │   │   ├── scraper/                 # TechCrunch fetch + parse
│   │   │   ├── classifier/              # AI/CS relevance filter
│   │   │   ├── curator/                 # ranks & selects "worth posting" stories
│   │   │   ├── content-engine/          # writes the post copy (LLM calls live here)
│   │   │   ├── humanizer/               # post-processing to kill AI-fingerprint
│   │   │   ├── meme-generator/          # canvas/sharp image composition
│   │   │   ├── scheduler/               # cron/queue, 3x/week logic
│   │   │   ├── publisher/               # LinkedIn posting integration
│   │   │   ├── store/                   # DB models (posted history, dedupe, analytics)
│   │   │   └── config/                  # agent-specific config, prompts, style rules
│   │   ├── assets/
│   │   │   └── meme-templates/          # base images/fonts for meme generator
│   │   ├── data/                        # local sqlite/json cache (gitignored)
│   │   ├── tests/
│   │   ├── package.json                 # own dependencies, own scripts
│   │   ├── .env.example
│   │   └── README.md
│   │
│   └── <future-agent-name>/             # e.g. twitter-agent, newsletter-agent
│       └── ... (same internal shape, fully independent)
│
├── shared/
│   ├── llm-client/                      # unified wrapper: swap providers via config
│   ├── logger/                          # shared structured logging
│   ├── http-client/                     # shared fetch/retry/rate-limit utils
│   └── types/                           # shared TS types/interfaces if using TS
│
├── infra/
│   ├── aws/                          # aws lamda compose
│   └── scripts/                         # deploy/cron-install helpers
│
├── package.json                         # workspace root (npm/yarn/pnpm workspaces)
└── README.md                            # workspace-level docs, how to add a new agent
```

Rules for the coding agent building this:
- Each agent under `agents/*` must be runnable and deployable in isolation (own `package.json`, own env file, own Express server/port).
- Only put something in `shared/` if a second agent will genuinely reuse it unchanged — don't prematurely abstract.
- Use npm/yarn/pnpm workspaces at the root so shared code is imported cleanly (`@shared/llm-client`), not copy-pasted.
- Each agent exposes a minimal Express admin API (health check, manual trigger, view last N posts, pause/resume) — useful for debugging without redeploying.

---

## 3. Pipeline (the actual agent loop)

Build these as distinct, testable modules communicating through the `store/` layer — not one giant function.

### Stage 1 — Scrape (`scraper/`)
- Pull TechCrunch's AI section (and CS-adjacent tags: machine learning, developer tools, etc.) via their RSS feeds first (cheap, structured, low risk) — fall back to HTML scraping only for fields RSS doesn't give you (full body, images).
- Respect robots.txt and reasonable request rates. Cache raw HTML/RSS responses locally so re-runs don't re-fetch.
- Store raw articles in `store/` with a hash/URL-based dedupe key so the same article is never processed twice.

### Stage 2 — Classify (`classifier/`)
- Filter to genuinely AI/CS-relevant articles. Use lightweight heuristics first (keyword/category match) and only escalate to an LLM call for ambiguous cases — this is where you save cost.
- Output a relevance score + short reason, stored alongside the article.

### Stage 3 — Curate (`curator/`)
- From the week's classified articles, rank by "meme-ability" / "engagement potential": novelty, controversy, irony, a surprising number/quote, something devs will have opinions about. This is a reasoning step — the agent should justify why it picked a story, not just take the newest one.
- Select exactly enough stories for the week's 3 posts, avoiding topic repetition from the last N posts (check `store/` history).

### Stage 4 — Generate content (`content-engine/`)
- One (or few) LLM call(s) per selected story — not per scrape, not continuous. This is the main cost center; keep it to 1–3 calls per post max.
- Prompt design must encode: Fireship (Fireship is a youtube channel), technically-literate sarcasm; meme-page bluntness; a clear point of view/take; a built-in discussion hook (question or hot take) at the end.
- Generate multiple candidate hooks/openers and pick the strongest programmatically (e.g., score for length, punch, absence of clichés) rather than always taking the LLM's first draft.

### Stage 5 — Humanize (`humanizer/`)
See Section 5 — this is a dedicated step, not an afterthought.

### Stage 6 — Meme image (`meme-generator/`)
- Use `sharp` or `node-canvas` to overlay generated caption text onto a small rotating library of meme templates/formats stored in `assets/meme-templates/`. No paid image-gen API calls.
- Keep a template variety large enough that posts don't visually repeat within a month.

### Stage 7 — Schedule & Publish (`scheduler/`, `publisher/`)
- Cron-based job (e.g. `node-cron` or a queue like BullMQ if you want retry/backoff) fires 3x/week at configured times.
- `publisher/` wraps the actual LinkedIn posting call behind an interface so the provider can change without touching the scheduler.
- **Flag this explicitly to the user before building**: LinkedIn's official API does not support unrestricted automated posting to personal profiles for third-party apps outside their approved partner program. Options to research and present as a decision point: (a) LinkedIn Marketing API with a Company Page + approved app, (b) an approved LinkedIn API partner/tool, (c) browser-automation-based posting, which carries ToS and account-suspension risk. This is a decision the user must make consciously — do not silently pick the risky option.

### Stage 8 — Learn (`store/` analytics)
- Log every post + its later engagement metrics (likes/comments, pulled manually or via API if available).
- Feed a lightweight summary of "what performed well" back into the curator/content-engine prompts periodically, so the agent's choices adapt over time instead of being static.

---

## 4. Content & Style Engine — be specific, not generic

The content-engine prompt (the actual LLM system prompt used inside the agent) should encode concrete rules, e.g.:
- Max ~150–200 words per post; short paragraphs (1–2 lines); no walls of text.
- Open with a claim, not a summary ("Nobody tells you X" / "This is why Y is cooked" / a blunt technical observation) — not "TechCrunch reported that...".
- Include one specific, concrete detail from the article (a number, a quote, a product name) — vague posts read as AI filler.
- End with a genuine question or a take people will want to argue with in the comments.
- Hashtags: 3–5 specific ones (#LLM, #DevTools, not #AI #Technology #Innovation #Future #Growth).
- Vary sentence length and structure between posts — build a rotation of 4–5 different opening styles so posts don't feel templated against each other.

---

## 5. Anti-"looks-AI-generated" Humanization Layer

This deserves its own module, not a prompt instruction alone:
- Post-process LLM output to strip generic AI tells: repetitive sentence openers, overuse of "moreover/furthermore," excessive em-dashes, symmetrical 3-point lists, generic hedging language.
- Inject controlled imperfection: contractions, sentence fragments, casual punctuation — the way a sharp dev actually types on LinkedIn, not formal prose.
- Maintain a "banned phrases" list (grows over time as you notice AI-ish tells) that the humanizer actively scans for and rewrites.
- Optionally: run a second, cheap LLM pass specifically prompted as an editor ("rewrite this so it doesn't sound AI-generated, keep the meaning") rather than trying to get it right in one shot — often cheaper/more reliable than one mega-prompt.

---

## 6. Cost Strategy — decide before building

Before writing content-engine code, produce a short comparison (as part of your build plan, not just in your head):

| Option | Est. cost per post | Pros | Cons |
|---|---|---|---|
| Hosted API, cheap tier model (e.g. small/fast model tier) | ~$ per 1K posts | Zero infra, easy to swap | Ongoing per-call cost, rate limits |
| Self-hosted small open-weight model (e.g. via Ollama on a small VPS/GPU box) | Fixed server cost regardless of volume | Predictable cost, no per-call fee | Server cost even when idle; you must size the box correctly; latency/quality trade-off |

With only 3 posts/week (≈12–13/month) and 1–3 LLM calls per post, call volume is genuinely tiny — a hosted cheap-tier API is very likely cheaper overall than paying for a dedicated server 24/7 just to save per-call fees. Self-hosting only wins if you're already running a server for other agents and can share it. Make this call explicitly and document the reasoning in `agents/linkedin-tech-meme-agent/README.md`.

Also cut cost by:
- Never calling the LLM during scraping/classification unless heuristics are ambiguous.
- Caching aggressively (never re-classify or re-generate for an already-processed article).
- Keeping the meme image pipeline 100% local (no image-gen API).

---

## 7. Deliverables expected from the build

1. Working monorepo per Section 2, with this agent fully functional inside it.
2. `.env.example` listing every required secret (LinkedIn credentials/tokens, chosen LLM provider key, etc.) with no secrets committed.
3. A short `README.md` per agent explaining: how it runs, how the schedule is configured, how to add a new meme template, how to swap the LLM provider, and the cost-model decision made in Section 6.
4. Basic tests for classifier scoring, dedupe logic, and the humanizer's banned-phrase stripping — these are the parts most likely to silently degrade quality.`
5. A manual "dry run" mode (generate a post but don't publish) so output can be reviewed before the first real scheduled run.

---

## 8. What NOT to do

- Don't build a simple scrape → template-fill → post script and call it an agent — there must be a classification/curation reasoning step and a feedback loop.
- Don't hardcode the TechCrunch category URLs, schedule times, or hashtag style — put them in `config/`.
- Don't call an LLM on every scrape cycle — batch and gate it behind the classifier.
- Don't use a paid image-generation API for memes.
- Don't silently choose a risky LinkedIn-posting method — surface the trade-off to the user first.

## 9. Chatgpt
- User chatgpt apis as llm and intelligence

note - write whole code like human and write code easy to understand.