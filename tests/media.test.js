/**
 * Media selection.
 *
 * Every post used to get the same thing: a 1200x1200 square with two lines of
 * capitals, drawn at random from whatever templates had not been used lately.
 * The first two posts both came out "hot-take", because random can repeat and
 * both stores were empty.
 *
 * The subtler failure is the one these tests care most about. The cooldown
 * tracked the template NAME but not its LAYOUT, and four of the twelve
 * templates are the same classic shape. Two of those in a row counted as
 * variety while being one picture in different colours.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEDIA_TREATMENTS,
  TREATMENT_NAMES,
  getTreatment,
  isTextOnly,
  pickTemplate,
} from '../src/meme-generator/media.js';
import { LAYOUTS } from '../src/meme-generator/layouts.js';
import { POST_SHAPES } from '../src/content-engine/shapes.js';
import { createRotation } from '../src/lib/rotation.js';
import { config } from '../src/config/index.js';

const WEIGHTS = config.memeGenerator.selectionWeights;

/** The real library, so the tests fail when someone adds a lopsided template. */
const TEMPLATES = [
  { name: 'hot-take', layout: 'classic' },
  { name: 'cyan-shout', layout: 'classic' },
  { name: 'red-alert', layout: 'classic' },
  { name: 'paper-white', layout: 'classic' },
  { name: 'before-after', layout: 'two-panel' },
  { name: 'ship-it', layout: 'two-panel' },
  { name: 'grep-output', layout: 'terminal' },
  { name: 'midnight-terminal', layout: 'terminal' },
  { name: 'blue-quote', layout: 'quote' },
  { name: 'they-said-it', layout: 'quote' },
  { name: 'pm-vs-eng', layout: 'chat' },
  { name: 'standup', layout: 'chat' },
];

const COOLDOWN = config.memeGenerator.templateCooldown;

const choose = (options = {}) =>
  pickTemplate(TEMPLATES, { weights: WEIGHTS, cooldown: COOLDOWN, ...options }).template;

/* --- treatments ----------------------------------------------------------- */

test('every configured treatment exists and has sane dimensions', () => {
  for (const name of config.memeGenerator.treatments) {
    const treatment = MEDIA_TREATMENTS[name];
    assert.ok(treatment, `config names a treatment that is not defined: ${name}`);

    if (treatment.width === null) {
      assert.equal(treatment.height, null, 'text-only has no dimensions at all');
    } else {
      assert.ok(treatment.width > 0 && treatment.height > 0);
    }
  }
});

test('the treatments are actually different shapes', () => {
  const ratios = TREATMENT_NAMES
    .map((name) => MEDIA_TREATMENTS[name])
    .filter((treatment) => treatment.width)
    .map((treatment) => (treatment.width / treatment.height).toFixed(2));

  assert.equal(new Set(ratios).size, ratios.length, 'two picture treatments with the same aspect ratio are one treatment');
});

test('a post without an image is a supported outcome', () => {
  assert.ok(isTextOnly('text-only'));
  assert.ok(!isTextOnly('meme-square'));
  assert.ok(config.memeGenerator.treatments.includes('text-only'), 'text-only must be in the rotation');
});

test('an unknown treatment falls back to the square', () => {
  assert.deepEqual(getTreatment('not-a-treatment'), MEDIA_TREATMENTS['meme-square']);
});

/* --- affinity ------------------------------------------------------------- */

test('every shape affinity names a layout that exists', () => {
  for (const [name, shape] of Object.entries(POST_SHAPES)) {
    assert.ok(Array.isArray(shape.layouts), `${name} must declare layouts, even if empty`);

    for (const layout of shape.layouts) {
      assert.ok(LAYOUTS[layout], `${name} prefers "${layout}", which is not a layout`);
    }
  }
});

test('every affinity has at least two templates behind it', () => {
  // One template behind an affinity means that shape gets the identical
  // picture every single time it comes round, which is the bug again.
  for (const [name, shape] of Object.entries(POST_SHAPES)) {
    for (const layout of shape.layouts) {
      const count = TEMPLATES.filter((template) => template.layout === layout).length;
      assert.ok(count >= 2, `${name} prefers "${layout}", which has only ${count} template(s)`);
    }
  }
});

test('a terminal-log post gets a terminal picture', () => {
  assert.equal(choose({ preferLayouts: ['terminal'] }).layout, 'terminal');
});

test('a quote-reaction post gets a quote picture', () => {
  assert.equal(choose({ preferLayouts: ['quote'] }).layout, 'quote');
});

test('affinity still rotates within its layout', () => {
  const first = choose({ preferLayouts: ['terminal'] });
  const second = choose({
    preferLayouts: ['terminal'],
    recentTemplates: [first.name],
    recentLayouts: [first.layout],
  });

  assert.equal(second.layout, 'terminal', 'still on brand');
  assert.notEqual(second.name, first.name, 'but not the identical image');
});

test('affinity is a preference, not a lock', () => {
  // Both terminal templates just used. Rather than repeat one, take the hint
  // and use something else - the alternative is alternating forever.
  const picked = choose({
    preferLayouts: ['terminal'],
    recentTemplates: ['grep-output', 'midnight-terminal'],
    recentLayouts: ['terminal', 'terminal'],
  });

  assert.notEqual(picked.layout, 'terminal', 'two in a row should break the affinity');
});

/* --- the cooldown that was missing ---------------------------------------- */

test('a layout does not repeat just because the colours changed', () => {
  // The exact failure: hot-take then red-alert is two classic pictures.
  const picked = choose({
    recentTemplates: ['hot-take'],
    recentLayouts: ['classic'],
  });

  assert.notEqual(picked.layout, 'classic', 'a recolour is not a different picture');
});

test('selection is deterministic', () => {
  const inputs = { recentTemplates: ['hot-take', 'ship-it'], recentLayouts: ['classic', 'two-panel'] };

  const picks = Array.from({ length: 10 }, () => choose(inputs).name);

  assert.equal(new Set(picks).size, 1, 'the same inputs must always give the same answer');
});

/**
 * Walk n posts the way the real thing does, with history capped at the
 * cooldown window rather than growing forever.
 *
 * The window matters. Feed it unbounded history and it is forced to exhaust
 * the library, and four of the twelve templates share the classic layout, so
 * two of them must end up adjacent at the tail. That is arithmetic, not a
 * bug, and asserting otherwise only tests a situation that never happens.
 */
function walk(posts, { preferLayouts = [] } = {}) {
  const window = config.memeGenerator.templateHistory;
  const history = [];

  for (let i = 0; i < posts; i += 1) {
    const template = choose({
      preferLayouts,
      recentTemplates: history.map((entry) => entry.name),
      recentLayouts: history.map((entry) => entry.layout),
    });

    history.unshift({ name: template.name, layout: template.layout });
    history.length = Math.min(history.length, window);
  }

  return history;
}

test('a template never comes back inside the cooldown window', () => {
  const window = config.memeGenerator.templateHistory;

  // Run well past the window so the wrap-around is exercised, checking every
  // position rather than only the end state.
  const seen = [];
  const history = [];

  for (let i = 0; i < 40; i += 1) {
    const template = choose({
      recentTemplates: history.map((entry) => entry.name),
      recentLayouts: history.map((entry) => entry.layout),
    });

    assert.ok(
      !history.slice(0, COOLDOWN).some((entry) => entry.name === template.name),
      ` came back within  posts, at position `,
    );

    seen.push(template.name);
    history.unshift({ name: template.name, layout: template.layout });
    history.length = Math.min(history.length, window);
  }

  assert.equal(new Set(seen).size, TEMPLATES.length, 'every template should get used over 40 posts');
});

test('consecutive picks never share a layout', () => {
  const history = walk(40);
  const layouts = [...history].reverse().map((entry) => entry.layout);

  for (let i = 1; i < layouts.length; i += 1) {
    assert.notEqual(layouts[i], layouts[i - 1], `two ${layouts[i]} pictures in a row at position ${i}`);
  }
});

test('an empty library is an error, not a crash later on', () => {
  assert.throws(() => pickTemplate([], { weights: WEIGHTS }), /No templates/);
});

/* --- media state, the same way as everything else ------------------------- */

function memoryStore(state = {}, posts = []) {
  const bag = new Map(Object.entries(state));

  return {
    getState: async (key, fallback = null) => (bag.has(key) ? bag.get(key) : fallback),
    setState: async (key, value) => bag.set(key, value),
    listPosts: async () => posts,
  };
}

test('the media rotation advances through every treatment', async () => {
  const store = memoryStore();
  const rotation = createRotation({ store });
  const names = config.memeGenerator.treatments;

  const seen = [];
  for (let i = 0; i < names.length; i += 1) {
    seen.push(await rotation.next({ key: 'mediaRotationIndex', names, known: MEDIA_TREATMENTS }));
  }

  assert.deepEqual([...seen].sort(), [...names].sort(), 'every treatment gets a turn');
});

test('media state rebuilds itself from post history, like the rest', async () => {
  // A cold Lambda with posts but no counter. Before #6 this restarted at zero
  // and the feed replayed its media from the top.
  const posts = [
    { mediaTreatment: 'meme-square' },
    { mediaTreatment: 'text-only' },
    { legacy: true },
  ];

  const rotation = createRotation({ store: memoryStore({}, posts) });
  const names = config.memeGenerator.treatments;

  const next = await rotation.next({
    key: 'mediaRotationIndex',
    names,
    known: MEDIA_TREATMENTS,
    seed: (all) => all.filter((post) => post.mediaTreatment).length,
  });

  assert.equal(next, names[2 % names.length], 'continues at post 3, ignoring the one with no treatment');
});

test('a treatment removed from config is skipped without breaking the rotation', async () => {
  const rotation = createRotation({ store: memoryStore({ mediaRotationIndex: 1 }) });

  const next = await rotation.next({
    key: 'mediaRotationIndex',
    names: ['meme-square', 'retired-treatment', 'text-only'],
    known: MEDIA_TREATMENTS,
  });

  assert.equal(next, 'text-only', 'the unknown name is dropped, not rendered');
});
