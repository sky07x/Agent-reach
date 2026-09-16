/**
 * What kind of picture a post gets, and which one.
 *
 * Until now every post got exactly the same media: a 1200x1200 square with
 * two lines of capitals, picked at random from whatever templates had not
 * been used in the last eight posts. Two things went wrong with that.
 *
 * The obvious one: random can repeat. The first two posts both drew
 * "hot-take", because both stores were empty and a coin came up the same way
 * twice.
 *
 * The subtler one: the cooldown tracked the template NAME but not its LAYOUT.
 * Four of the twelve templates are the classic top-caption/bottom-punchline
 * shape. Two of those back to back are the same picture in different colours,
 * and the cooldown was perfectly happy with it.
 *
 * So selection is deterministic now, and a post's media is chosen to suit the
 * post rather than drawn from a hat.
 */

/**
 * The media treatments, rotated one per post.
 *
 * "text-only" is in here deliberately. A post with no image is a real
 * treatment, not a failure: it reads as someone typing a thought rather than
 * publishing a graphic, and a feed where every single entry carries a
 * matching square is its own kind of obviously-automated.
 */
export const MEDIA_TREATMENTS = {
  'meme-square': {
    description: 'The 1:1 square. Safe, dense, works everywhere.',
    width: 1200,
    height: 1200,
  },
  'meme-portrait': {
    description: 'Taller 4:5. Takes more of the feed on a phone.',
    width: 1080,
    height: 1350,
  },
  'text-only': {
    description: 'No image at all. The words carry it.',
    width: null,
    height: null,
  },
};

export const TREATMENT_NAMES = Object.keys(MEDIA_TREATMENTS);

export function getTreatment(name) {
  return MEDIA_TREATMENTS[name] ?? MEDIA_TREATMENTS['meme-square'];
}

export function isTextOnly(name) {
  return getTreatment(name).width === null;
}

/**
 * Score every template and return the best, with the reasoning.
 *
 * Three things matter, in this order:
 *
 *   affinity   does this layout suit the post? A terminal-log post wants a
 *              terminal picture. This is the difference between media that
 *              was chosen and media that was drawn from a hat.
 *   template   how long since we used this exact template.
 *   layout     how long since we used this layout, whatever the colours.
 *
 * Affinity is a preference and not a lock. There are only two terminal
 * templates, so a hard rule would make every terminal-log post alternate
 * between the same pair forever, which is the problem again wearing a hat.
 *
 * The history handed in should reach back further than the cooldown, because
 * the two jobs need different horizons. The cooldown decides who is barred;
 * the longer view decides who is most overdue. With only the cooldown to go
 * on, a template unused for thirty posts looks exactly like one unused for
 * nine, the ranking settles into a fixed orbit, and some templates simply
 * never come up. That is not a thought experiment: with a window of eight,
 * this cycled through ten of the twelve templates forever and never once drew
 * red-alert or paper-white.
 *
 * @param {object[]} templates
 * @param {object} options
 * @param {string[]} options.recentTemplates  newest first, longer than cooldown
 * @param {string[]} options.recentLayouts    newest first, same history
 * @param {number} [options.cooldown]         how many of those bar a template
 * @param {string[]} [options.preferLayouts]  layouts that suit this post
 * @param {object} options.weights
 * @returns {{template: object, scored: object[]}}
 */
export function pickTemplate(templates, {
  recentTemplates = [],
  recentLayouts = [],
  cooldown = recentTemplates.length,
  preferLayouts = [],
  weights,
}) {
  if (!templates.length) throw new Error('No templates to choose from');

  /** Positions are newest-first, so a miss is "longer ago than we tracked". */
  const distance = (list, value) => {
    const index = list.indexOf(value);
    return index === -1 ? list.length + 1 : index;
  };

  // Anything used inside the cooldown window is out, full stop, as long as
  // something else is available. This started as one more weighted term and
  // that was wrong: a template could lose on layout freshness to one that had
  // already run, so a whole pass over the library would reuse one template
  // while never showing another at all. Freshness is a tiebreak, not a trade.
  const barred = new Set(recentTemplates.slice(0, cooldown));
  const unused = templates.filter((template) => !barred.has(template.name));
  const eligible = unused.length ? unused : templates;

  const scored = eligible.map((template) => {
    const sinceTemplate = distance(recentTemplates, template.name);
    const sinceLayout = distance(recentLayouts, template.layout);
    const affine = preferLayouts.includes(template.layout);

    // Normalised so the weights in config mean something comparable.
    const span = Math.max(recentTemplates.length, recentLayouts.length, 1) + 1;

    const score = (affine ? weights.affinity : 0)
      + (sinceTemplate / span) * weights.templateFreshness
      + (sinceLayout / span) * weights.layoutFreshness;

    return {
      name: template.name,
      layout: template.layout,
      score: Number(score.toFixed(3)),
      affine,
      sinceTemplate,
      sinceLayout,
      template,
    };
  });

  // Deterministic: highest score wins, ties broken by name so the same inputs
  // always give the same answer and a test can assert on it.
  scored.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

  return {
    template: scored[0].template,
    scored: scored.map(({ template, ...rest }) => rest),
  };
}

export default { MEDIA_TREATMENTS, TREATMENT_NAMES, getTreatment, isTextOnly, pickTemplate };
