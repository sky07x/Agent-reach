/**
 * What picture does this post get?
 *
 * The meme generator used to be handed two captions the writer dashed off
 * in the same breath as the post ("PLEASE DON'T HACK!" / "BUT I'M A CAT"),
 * and put them on a gradient. That picture added nothing a reader could use,
 * and a feed of them reads as a bot with a template folder.
 *
 * So the picture is planned now, after the post is final, by reading the
 * post: the diagram of the mechanism a breakdown walks through, the chart of
 * the numbers a numbers post is built on, the cheat sheet of a builder's
 * notes. One call. The planner can also say no picture helps, and then the
 * old meme card is the fallback, which is still better than something made
 * up.
 *
 * Every number on a card is checked against the story before it is drawn.
 * A chart is the most believable thing a post can carry, which makes a wrong
 * number on one the most damaging thing it can carry.
 */

import { createLogger } from '../lib/logger.js';
import { inventedNumbers } from './quality.js';
import { displayIsInArticle } from './insight.js';
import { getShape } from './shapes.js';
import { VISUAL_TYPES } from '../meme-generator/visuals.js';

const log = createLogger('visual-planner');

const VISUAL_PROMPT = `You design the single image that goes with a LinkedIn post
by an AI/ML engineer. It must look like something a real engineer-creator
made in ten minutes in Figma or Excalidraw: a clean diagram, a chart, a code
window, a cheat sheet. Never decoration, never stock-AI imagery.

The image has to EARN its place: it shows the key idea of the post at a
glance, or gives the reader something worth saving. If it only repeats the
first line in big letters, it is wrong.

TYPES, and the JSON each one takes (every type also takes "kicker", 1-4
words shown small above the title, and "title", a plain statement under 70
characters, no clickbait, no question):

  flow        how something works, step by step, top to bottom.
              {"type":"flow","steps":[{"label":"under 40 chars","detail":"optional, under 80 chars"}], "note":"optional one line"}
              2 to 5 steps, only steps the post or story describes.
  chart       horizontal bars comparing figures that share ONE unit.
              {"type":"chart","bars":[{"label":"under 32 chars","value":123,"display":"$123M","highlight":true}], "note":"what is measured"}
              2 to 5 bars. Exactly one highlight: the bar the post is about.
              Never mix units ($ with %, users with dollars).
  stat        one to three headline numbers.
              {"type":"stat","stats":[{"display":"93%","label":"under 60 chars","context":"optional, under 110 chars"}]}
              display is the bare figure with its unit, under 8 characters:
              "70%", "$500M", "80x", "5,000". Never words ("seven in 10",
              "more than 50"): put qualifiers like "more than" in the label.
  comparison  two columns: before/after, headline/detail, old way/new way.
              {"type":"comparison","left":{"heading":"under 28 chars","points":["under 50 chars, a fragment is fine"]},"right":{"heading":"...","points":["..."]}}
              2 to 4 points each. The right column is the one the post argues for.
  checklist   a cheat sheet someone saves: things to do or check.
              {"type":"checklist","items":["under 75 chars"]}
              2, 4 or 5 items, never 3. Each specific to this story.
  code        an editor window. Only when the post is about code, an API or a
              config, and only a short realistic sketch of the PATTERN.
              {"type":"code","filename":"agent.py","lines":["..."],"highlight":[line numbers],"caption":"under 120 chars"}
              At most 14 lines, under 56 chars each. Never invent a real
              product's API or config keys: if the story does not show them,
              write generic code and say "a sketch" in the caption.
  terminal    a terminal session, same rules as code, lines start with "$ "
              for commands. {"type":"terminal","lines":["..."],"caption":"..."}
  quote       a real quote from the story, exactly as written.
              {"type":"quote","quote":"...","who":"name, role"}
  none        no image would add anything. {"type":"none"}

RULES
- Every number on the image appears in the story, exactly. No maths on them,
  no rounding, no estimates.
- Only facts the story states. Labels and steps are plain words, sentence case.
- No emoji. No exclamation marks. No hashtags.
- "alt": one sentence describing the image for screen readers.

Reply as JSON: the object for the chosen type, plus "alt".`;

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A headline figure: digits and a unit, nothing else. "seven in 10" is a sentence. */
const BARE_FIGURE = /^[~<>≈+]?\s?\$?\d[\d,.]*\s?(?:%|x|[kmbt]|bn|million|billion|trillion)?\+?$/i;

/** In the story as written, or arithmetic on it ("seven in 10" is 70%). */
function figureInStory(display, article) {
  return displayIsInArticle(display, article) || inventedNumbers(display, article).length === 0;
}

/** What counts as the same unit on a chart. */
function unitOf(display) {
  const value = String(display ?? '').toLowerCase();
  if (value.includes('$') || /\b(usd|dollars?)\b/.test(value)) return 'money';
  if (/%|percent/.test(value)) return 'percent';
  if (/\d\s*x\b/.test(value)) return 'multiple';
  return 'count';
}

/**
 * Check a planned visual and trim it to what the renderer can lay out.
 *
 * @returns {{visual: object|null, problems: string[]}}
 */
export function checkVisual(raw, { article } = {}) {
  const problems = [];
  const type = String(raw?.type ?? '').trim();

  if (type === 'none') return { visual: null, problems: [] };
  if (!VISUAL_TYPES.includes(type)) return { visual: null, problems: [`unknown type "${type}"`] };

  const visual = {
    type,
    kicker: text(raw.kicker, 40),
    title: text(raw.title, 90),
    alt: text(raw.alt, 300),
  };

  const list = (value) => (Array.isArray(value) ? value : []);

  switch (type) {
    case 'flow':
      visual.steps = list(raw.steps).map((step) => ({ label: text(step?.label ?? step, 60), detail: text(step?.detail, 110) })).filter((step) => step.label).slice(0, 5);
      visual.note = text(raw.note, 120);
      if (visual.steps.length < 2) problems.push('a flow needs at least two steps');
      break;
    case 'chart': {
      visual.bars = list(raw.bars)
        .map((bar) => ({ label: text(bar?.label, 40), value: Number(bar?.value), display: text(bar?.display, 14), highlight: bar?.highlight === true }))
        .filter((bar) => bar.label && Number.isFinite(bar.value) && bar.value >= 0 && bar.display)
        .slice(0, 5);
      visual.note = text(raw.note, 120);
      if (visual.bars.length < 2) problems.push('a chart needs at least two bars');
      if (new Set(visual.bars.map((bar) => unitOf(bar.display))).size > 1) problems.push('the bars mix units; a chart compares one kind of number');
      if (visual.bars.filter((bar) => bar.highlight).length !== 1 && visual.bars.length) {
        // Not worth a retry: highlight the biggest, which is usually the point.
        const top = visual.bars.reduce((best, bar) => (bar.value > best.value ? bar : best), visual.bars[0]);
        visual.bars = visual.bars.map((bar) => ({ ...bar, highlight: bar === top }));
      }
      if (article) {
        const missing = visual.bars.filter((bar) => !figureInStory(bar.display, article));
        if (missing.length) problems.push(`these figures are not in the story: ${missing.map((bar) => bar.display).join(', ')}`);
      }
      break;
    }
    case 'stat':
      visual.stats = list(raw.stats).map((item) => ({ display: text(item?.display, 12), label: text(item?.label, 80), context: text(item?.context, 140) })).filter((item) => item.display && item.label).slice(0, 3);
      if (!visual.stats.length) problems.push('a stat card needs a number');
      {
        const wordy = visual.stats.filter((item) => !BARE_FIGURE.test(item.display));
        if (wordy.length) problems.push(`a stat is a bare figure like "70%" or "$500M", not words: ${wordy.map((item) => `"${item.display}"`).join(', ')}`);
      }
      if (article) {
        const missing = visual.stats.filter((item) => !figureInStory(item.display, article));
        if (missing.length) problems.push(`these figures are not in the story: ${missing.map((item) => item.display).join(', ')}`);
      }
      break;
    case 'comparison':
      for (const side of ['left', 'right']) {
        visual[side] = { heading: text(raw?.[side]?.heading, 32), points: list(raw?.[side]?.points).map((point) => text(point, 90)).filter(Boolean).slice(0, 4) };
        if (!visual[side].heading || !visual[side].points.length) problems.push(`the ${side} column is empty`);
      }
      break;
    case 'checklist':
      visual.items = list(raw.items).map((item) => text(item, 110)).filter(Boolean).slice(0, 5);
      if (visual.items.length < 2) problems.push('a checklist needs at least two items');
      if (visual.items.length === 3) problems.push('three items is the tidy triple every generated post has; use two, four or five');
      break;
    case 'code':
    case 'terminal':
      visual.filename = text(raw.filename, 40);
      visual.lines = list(raw.lines).map((line) => String(line ?? '').replace(/\t/g, '  ').replace(/\s+$/, '').slice(0, 64)).slice(0, 14);
      visual.highlight = list(raw.highlight).map(Number).filter(Number.isInteger);
      visual.caption = text(raw.caption, 140);
      if (visual.lines.filter((line) => line.trim()).length < 2) problems.push('a code window needs at least two lines');
      break;
    case 'quote':
      visual.quote = text(raw.quote, 260).replace(/^["“]|["”]$/g, '');
      visual.who = text(raw.who, 80);
      if (!visual.quote || !visual.who) problems.push('a quote needs the words and who said them');
      if (article && visual.quote && !`${article.title} ${article.summary} ${article.body}`.replace(/[“”]/g, '"').replace(/[’‘]/g, "'").includes(visual.quote.replace(/[’‘]/g, "'").slice(0, 60))) {
        problems.push('the quote is not word for word in the story');
      }
      break;
    default:
      break;
  }

  // Every number anywhere on the card, whatever the type. Code is exempt:
  // "range(10)" is syntax, not a claim about the story.
  if (article && type !== 'code' && type !== 'terminal') {
    const strings = JSON.stringify({ ...visual, alt: '' }).replace(/"(?:value|highlight)":\s*[\d.]+/g, '');
    const invented = inventedNumbers(strings.replace(/[{}[\]":,]/g, ' '), article);
    if (invented.length) problems.push(`numbers on the image that are not in the story: ${invented.join(', ')}`);
  }

  return problems.length ? { visual: null, problems } : { visual, problems };
}

export function createVisualPlanner({ config, llm, store }) {
  const settings = config.memeGenerator?.visuals ?? {};
  const model = config.content?.writerModel || undefined;

  async function recentTypes() {
    const posts = await store.listRecentAttempted(settings.recentTypes ?? 3);
    return posts.map((post) => post.visualType).filter(Boolean);
  }

  return {
    /**
     * Plan the picture for one finished post.
     *
     * Never throws: a picture is worth having, not worth failing a run over.
     *
     * @returns {Promise<object|null>} a checked visual, or null for "use the
     *   meme card instead"
     */
    async plan({ article, draft, insight, treatment }) {
      if (settings.enabled === false) return null;

      const preferred = getShape(draft.shape).visuals ?? [];
      const avoid = await recentTypes();
      const portrait = treatment === 'meme-portrait';

      const brief = `THE STORY
Title: ${article.title}
Summary: ${text(article.summary, 600)}
Article: ${text(article.body, 3000)}
${insight?.numbers?.length ? `\nFIGURES FROM THE STORY, the only numbers allowed:\n${insight.numbers.map((item) => `- ${item.display} (${item.label}), value ${item.value}`).join('\n')}\n` : ''}${insight?.mechanism?.length ? `\nHOW IT WORKS, per the article:\n${insight.mechanism.map((step) => `- ${step}`).join('\n')}\n` : ''}
THE POST
${draft.text}

This post is a "${draft.shape}". Types that usually suit it: ${preferred.filter((type) => type !== 'meme').join(', ') || 'any'}.
${avoid.length ? `The last posts used: ${avoid.join(', ')}. Pick something else unless it is clearly the best fit.\n` : ''}The image is ${portrait ? 'portrait, 4:5' : 'square'}.`;

      let notes = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const raw = await llm.chatJson({
            label: 'plan-visual',
            model,
            temperature: 0.7,
            maxTokens: 900,
            system: VISUAL_PROMPT,
            user: notes.length ? `${brief}\n\nYOUR LAST DESIGN WAS REJECTED:\n${notes.map((note) => `- ${note}`).join('\n')}\nFix that, or pick a different type.` : brief,
          });

          if (raw?.type === 'none') {
            log.info('The planner says no picture would help', { shape: draft.shape });
            return null;
          }

          const { visual, problems } = checkVisual(raw, { article });
          if (visual) {
            log.info('Visual planned', { type: visual.type, title: visual.title, attempt: attempt + 1 });
            return visual;
          }

          log.warn('Visual rejected', { type: raw?.type, problems });
          notes = problems;
        } catch (error) {
          log.warn('Visual planning failed, the post keeps its meme card', { error: error.message });
          return null;
        }
      }

      return null;
    },
  };
}

export default { createVisualPlanner, checkVisual };
