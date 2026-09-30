/**
 * Planned visuals: the pictures an engineer actually posts.
 *
 * The meme cards were two lines of capitals on a gradient, and a feed of them
 * reads as a bot with a template folder. What people in this niche post, and
 * what gets saved, is a picture that carries information: the diagram of how
 * a thing works, the chart of the numbers, the cheat sheet, the before and
 * after, the code window with the interesting line highlighted.
 *
 * Every type here is drawn as SVG and rendered with sharp, like the memes, so
 * there is still no image API and no cost per picture. The content comes from
 * content-engine/visual-planner.js, which checks every number against the
 * story before anything is drawn.
 *
 * Design rules, kept deliberately plain because plain is what reads as made
 * by a person: one light surface, ink text, a single accent per card used for
 * emphasis only, generous margins, left-aligned type. No gradients, no glow,
 * no stock-AI imagery. Numbers are always in ink; the accent marks the thing
 * that matters (the highlighted bar, the step marker), it never carries text.
 */

import { escapeXml, wrapText, fitText, CHAR_WIDTH_RATIO } from './text.js';

const SANS = "'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";
const MONO = "'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace";

/**
 * Average advance of DejaVu Sans, measured on these cards as rendered with
 * the fonts Lambda ships (FONTCONFIG_PATH=assets/fonts), plus a margin. The
 * meme layouts use wider numbers because they are mostly capitals; these
 * cards are sentence case, and the wider numbers wrapped them at 60%.
 */
const SANS_RATIO = 0.56;
const BOLD_RATIO = 0.61;

export const THEME = {
  surface: '#fcfcfb',
  card: '#ffffff',
  sunken: '#f1f0ec',
  ink: '#0b0b0b',
  secondary: '#52514e',
  muted: '#8a8984',
  rule: '#e4e2dc',
  neutralBar: '#c9c7c0',
  codeBg: '#0d1117',
  codeBar: '#161b22',
  codeInk: '#e6edf3',
  codeMuted: '#6e7681',
};

/** The accent rotates per card, so a week of posts is not one colour. */
export const ACCENTS = ['#2a78d6', '#eb6834', '#4a3aa7', '#008300', '#e34948'];

export function accentFor(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

/** Lines of text, one <text> each. Leading spaces kept for code. */
function lines(list, { x, y, size, lineHeight = size * 1.28, fill = THEME.ink, weight = 400, font = SANS, anchor = 'start', preserve = false }) {
  return list.map((line, index) => `<text x="${x}" y="${(y + index * lineHeight).toFixed(1)}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${preserve ? ' xml:space="preserve"' : ''}>${escapeXml(line)}</text>`).join('');
}

const wrap = (text, size, width, maxLines = 6, ratio = SANS_RATIO) => wrapText(String(text ?? ''), { fontSize: size, maxWidth: width, maxLines, charWidthRatio: ratio });

/**
 * The frame every card shares: kicker, title, and a footer with the handle
 * and the source. Returns the markup and the box the body can draw in.
 */
function frame({ width, height, visual, accent, handle, source }) {
  const pad = Math.round(width * 0.075);
  const inner = width - pad * 2;
  const kicker = String(visual.kicker ?? '').toUpperCase().slice(0, 40);

  let y = pad + 14;
  let markup = `<rect width="${width}" height="${height}" fill="${THEME.surface}"/>`;

  if (kicker) {
    markup += `<rect x="${pad}" y="${y - 4}" width="44" height="6" rx="3" fill="${accent}"/>`;
    markup += lines([kicker], { x: pad + 60, y: y + 6, size: 24, fill: THEME.secondary, weight: 700, font: MONO });
    y += 58;
  }

  const title = fitText(String(visual.title ?? ''), { startSize: Math.round(width * 0.056), minSize: 36, maxWidth: inner, maxLines: 3, charWidthRatio: BOLD_RATIO });
  if (title.lines.length && title.lines[0]) {
    y += title.fontSize;
    markup += lines(title.lines, { x: pad, y, size: title.fontSize, lineHeight: title.fontSize * 1.16, weight: 700 });
    y += (title.lines.length - 1) * title.fontSize * 1.16;
  }

  const footerY = height - pad + 8;
  markup += `<line x1="${pad}" y1="${footerY - 44}" x2="${width - pad}" y2="${footerY - 44}" stroke="${THEME.rule}" stroke-width="2"/>`;
  if (handle) markup += lines([handle], { x: pad, y: footerY, size: 24, fill: THEME.secondary, weight: 700 });
  if (source) markup += lines([source], { x: width - pad, y: footerY, size: 22, fill: THEME.muted, anchor: 'end' });

  return {
    markup,
    pad,
    inner,
    body: { top: y + 56, bottom: footerY - 80, left: pad, right: width - pad },
  };
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Horizontal bars, one highlighted. Values in ink at the tip. */
function chart({ visual, accent, body }) {
  const bars = visual.bars;
  const max = Math.max(...bars.map((bar) => bar.value), 0) || 1;
  const labelSize = 30;
  const valueSize = 36;
  const valueRoom = Math.max(...bars.map((bar) => String(bar.display).length)) * valueSize * BOLD_RATIO + 28;
  const barMax = body.right - body.left - valueRoom;
  const barHeight = 44;
  const noteLines = visual.note ? wrap(visual.note, 28, body.right - body.left, 3) : [];
  const noteHeight = noteLines.length ? 40 + noteLines.length * 36 : 0;
  const row = Math.min(170, (body.bottom - body.top - noteHeight) / bars.length);
  const total = bars.length * row + noteHeight;
  const top = body.top + Math.max(0, (body.bottom - body.top - total) / 2);

  let markup = '';
  bars.forEach((bar, index) => {
    const rowTop = top + index * row;
    const labelLine = wrap(bar.label, labelSize, body.right - body.left, 1)[0] ?? '';
    const barTop = rowTop + labelSize + 16;
    const length = Math.max(12, (bar.value / max) * barMax);
    const radius = 6;

    markup += lines([labelLine], { x: body.left, y: rowTop + labelSize, size: labelSize, fill: THEME.secondary });
    // Square at the baseline, rounded at the data end.
    markup += `<path d="M${body.left},${barTop} h${length - radius} a${radius},${radius} 0 0 1 ${radius},${radius} v${barHeight - radius * 2} a${radius},${radius} 0 0 1 -${radius},${radius} h-${length - radius} z" fill="${bar.highlight ? accent : THEME.neutralBar}"/>`;
    markup += lines([String(bar.display)], { x: body.left + length + 18, y: barTop + barHeight / 2 + valueSize * 0.36, size: valueSize, weight: 700 });
  });

  if (noteLines.length) markup += lines(noteLines, { x: body.left, y: top + bars.length * row + 30, size: 28, fill: THEME.secondary });
  return markup;
}

/** One to three headline numbers. */
function stat({ visual, accent, body }) {
  const stats = visual.stats;
  const width = body.right - body.left;
  let markup = '';

  if (stats.length === 1) {
    const [item] = stats;
    const value = fitText(String(item.display), { startSize: 220, minSize: 90, maxWidth: width, maxLines: 1, charWidthRatio: BOLD_RATIO });
    const label = wrap(item.label, 44, width, 3);
    const context = item.context ? wrap(item.context, 32, width, 3) : [];
    const blockHeight = value.fontSize + 40 + label.length * 56 + (context.length ? 30 + context.length * 42 : 0);
    let y = body.top + Math.max(0, (body.bottom - body.top - blockHeight) / 2) + value.fontSize * 0.85;

    markup += `<rect x="${body.left}" y="${y - value.fontSize * 0.78}" width="10" height="${value.fontSize * 0.8}" rx="3" fill="${accent}"/>`;
    markup += lines(value.lines, { x: body.left + 36, y, size: value.fontSize, weight: 700 });
    y += 40 + 44;
    markup += lines(label, { x: body.left, y, size: 44, lineHeight: 56, weight: 700 });
    y += label.length * 56 + 20;
    if (context.length) markup += lines(context, { x: body.left, y, size: 32, lineHeight: 42, fill: THEME.secondary });
    return markup;
  }

  const row = (body.bottom - body.top) / stats.length;
  stats.forEach((item, index) => {
    const top = body.top + index * row;
    const value = fitText(String(item.display), { startSize: 120, minSize: 60, maxWidth: width, maxLines: 1, charWidthRatio: BOLD_RATIO });
    const label = wrap(item.label, 34, width, 2);
    if (index) markup += `<line x1="${body.left}" y1="${top}" x2="${body.right}" y2="${top}" stroke="${THEME.rule}" stroke-width="2"/>`;
    const y = top + Math.max(value.fontSize + 20, (row - value.fontSize - label.length * 44) / 2 + value.fontSize);
    markup += `<rect x="${body.left}" y="${y - value.fontSize * 0.75}" width="8" height="${value.fontSize * 0.76}" rx="3" fill="${index === 0 ? accent : THEME.neutralBar}"/>`;
    markup += lines(value.lines, { x: body.left + 30, y, size: value.fontSize, weight: 700 });
    markup += lines(label, { x: body.left, y: y + 58, size: 34, lineHeight: 44, fill: THEME.secondary });
  });
  return markup;
}

/** Boxes and arrows, top to bottom: how the thing works. */
function flow({ visual, accent, body }) {
  const steps = visual.steps;
  const width = body.right - body.left;
  const noteLines = visual.note ? wrap(visual.note, 28, width, 3) : [];
  const noteHeight = noteLines.length ? noteLines.length * 36 + 36 : 0;

  // Shrink until it fits. Real diagrams do the same thing by hand.
  for (let scale = 1; scale >= 0.6; scale -= 0.05) {
    const labelSize = Math.round(36 * scale);
    const detailSize = Math.round(28 * scale);
    const circle = Math.round(26 * scale);
    const textLeft = circle * 2 + 44;
    const textWidth = width - textLeft - 28;
    const gap = Math.round(64 * scale);

    const boxes = steps.map((step) => {
      const label = wrap(step.label, labelSize, textWidth, 2, BOLD_RATIO);
      const detail = step.detail ? wrap(step.detail, detailSize, textWidth, 3) : [];
      const height = 30 * scale + label.length * labelSize * 1.25 + (detail.length ? 8 + detail.length * detailSize * 1.3 : 0) + 30 * scale;
      return { label, detail, height: Math.max(height, circle * 2 + 36) };
    });

    const total = boxes.reduce((sum, box) => sum + box.height, 0) + gap * (boxes.length - 1) + noteHeight;
    if (total > body.bottom - body.top && scale > 0.61) continue;

    let y = body.top + Math.max(0, (body.bottom - body.top - total) / 2);
    let markup = '';

    boxes.forEach((box, index) => {
      markup += `<rect x="${body.left}" y="${y}" width="${width}" height="${box.height}" rx="18" fill="${THEME.card}" stroke="${index === boxes.length - 1 ? accent : THEME.rule}" stroke-width="${index === boxes.length - 1 ? 3 : 2}"/>`;
      const cy = y + box.height / 2;
      markup += `<circle cx="${body.left + 22 + circle}" cy="${cy}" r="${circle}" fill="${index === boxes.length - 1 ? accent : THEME.ink}"/>`;
      markup += lines([String(index + 1)], { x: body.left + 22 + circle, y: cy + circle * 0.38, size: Math.round(circle * 1.05), weight: 700, fill: '#ffffff', anchor: 'middle' });

      const textHeight = box.label.length * labelSize * 1.25 + (box.detail.length ? 8 + box.detail.length * detailSize * 1.3 : 0);
      let ty = y + (box.height - textHeight) / 2 + labelSize * 0.95;
      markup += lines(box.label, { x: body.left + textLeft, y: ty, size: labelSize, lineHeight: labelSize * 1.25, weight: 700 });
      ty += box.label.length * labelSize * 1.25 + 8 - labelSize * 0.25;
      if (box.detail.length) markup += lines(box.detail, { x: body.left + textLeft, y: ty + detailSize * 0.9, size: detailSize, lineHeight: detailSize * 1.3, fill: THEME.secondary });

      y += box.height;
      if (index < boxes.length - 1) {
        const x = body.left + 22 + circle;
        markup += `<line x1="${x}" y1="${y + 8}" x2="${x}" y2="${y + gap - 16}" stroke="${THEME.secondary}" stroke-width="3"/>`;
        markup += `<path d="M${x - 10},${y + gap - 20} L${x},${y + gap - 6} L${x + 10},${y + gap - 20} z" fill="${THEME.secondary}"/>`;
        y += gap;
      }
    });

    if (noteLines.length) markup += lines(noteLines, { x: body.left, y: y + 56, size: 28, fill: THEME.secondary });
    return markup;
  }
  return '';
}

/** Two columns: before and after, the headline and the detail. */
function comparison({ visual, accent, body }) {
  const gap = 28;
  const colWidth = (body.right - body.left - gap) / 2;
  const columns = [visual.left, visual.right];
  const room = body.bottom - body.top;

  // Shrink until the taller column fits, the same way the flow does.
  let laid;
  let height;
  let pointSize;
  let headingSize;
  for (let scale = 1; scale >= 0.6; scale -= 0.05) {
    pointSize = Math.round(30 * scale);
    headingSize = Math.round(34 * scale);
    laid = columns.map((column) => ({
      heading: wrap(column.heading, headingSize, colWidth - 56, 2, BOLD_RATIO),
      points: column.points.map((point) => wrap(point, pointSize, colWidth - 88, 4)),
    }));
    height = Math.max(...laid.map((column) => 52 + column.heading.length * headingSize * 1.3 + 26
      + column.points.reduce((sum, point) => sum + point.length * pointSize * 1.3 + 26 * scale, 0) + 24));
    if (height <= room) break;
  }
  height = Math.min(room, height);
  const top = body.top + Math.max(0, (room - height) / 2);

  return laid.map((column, index) => {
    const x = body.left + index * (colWidth + gap);
    const emphasised = index === 1;
    let markup = `<rect x="${x}" y="${top}" width="${colWidth}" height="${height}" rx="18" fill="${emphasised ? THEME.card : THEME.sunken}" stroke="${emphasised ? accent : 'none'}" stroke-width="3"/>`;
    let y = top + 52 + headingSize * 0.2;
    markup += lines(column.heading, { x: x + 28, y, size: headingSize, lineHeight: headingSize * 1.3, weight: 700, fill: emphasised ? THEME.ink : THEME.secondary });
    y += column.heading.length * headingSize * 1.3 + 26;
    for (const point of column.points) {
      markup += `<circle cx="${x + 40}" cy="${y - pointSize * 0.34}" r="7" fill="${emphasised ? accent : THEME.muted}"/>`;
      markup += lines(point, { x: x + 64, y, size: pointSize, lineHeight: pointSize * 1.3, fill: THEME.ink });
      y += point.length * pointSize * 1.3 + 26 * (pointSize / 30);
    }
    return markup;
  }).join('');
}

/** A cheat sheet. The picture people save. */
function checklist({ visual, accent, body }) {
  const width = body.right - body.left;
  const size = visual.items.length > 4 ? 32 : 36;
  const items = visual.items.map((item) => wrap(item, size, width - 84, 3));
  const rowGap = 34;
  const total = items.reduce((sum, item) => sum + item.length * size * 1.3 + rowGap * 2, 0);
  let y = body.top + Math.max(0, (body.bottom - body.top - total) / 2);
  let markup = '';

  items.forEach((item, index) => {
    if (index) markup += `<line x1="${body.left}" y1="${y}" x2="${body.right}" y2="${y}" stroke="${THEME.rule}" stroke-width="2"/>`;
    const textTop = y + rowGap + size * 0.9;
    const box = textTop - size * 0.82;
    markup += `<rect x="${body.left}" y="${box}" width="40" height="40" rx="9" fill="none" stroke="${accent}" stroke-width="3.5"/>`;
    markup += `<path d="M${body.left + 9},${box + 21} L${body.left + 17},${box + 29} L${body.left + 31},${box + 12}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    markup += lines(item, { x: body.left + 72, y: textTop, size, lineHeight: size * 1.3 });
    y += item.length * size * 1.3 + rowGap * 2;
  });
  return markup;
}

const KEYWORDS = /\b(const|let|var|function|return|if|else|elif|for|while|await|async|import|from|export|def|class|try|except|catch|finally|new|None|True|False|null|undefined|true|false|in|with|as|yield|raise|throw|lambda|not|and|or)\b/;

/** Just enough highlighting to read as a screenshot of an editor. */
function highlight(line, colors) {
  const pattern = /(\/\/.*$|#.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]+\b)/g;
  let out = '';
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    out += escapeXml(line.slice(last, match.index));
    const [token, comment, string, number, word] = match;
    const fill = comment ? colors.comment : string ? colors.string : number ? colors.number : (word && KEYWORDS.test(word) && word.match(KEYWORDS)[0] === word) ? colors.keyword : null;
    out += fill ? `<tspan fill="${fill}">${escapeXml(token)}</tspan>` : escapeXml(token);
    last = match.index + token.length;
  }
  return out + escapeXml(line.slice(last));
}

/** An editor or terminal window on the light surface, the carbon.now.sh look. */
function code({ visual, accent, body, terminal = false }) {
  const width = body.right - body.left;
  const source = visual.lines.slice(0, 16);
  const gutter = terminal ? 0 : 52;
  const padX = 36;
  const longest = Math.max(12, ...source.map((line) => line.length));
  const captionLines = visual.caption ? wrap(visual.caption, 30, width, 3) : [];
  const captionHeight = captionLines.length ? captionLines.length * 40 + 30 : 0;
  const barHeight = 58;

  const byWidth = (width - padX * 2 - gutter) / (longest * CHAR_WIDTH_RATIO.mono);
  const byHeight = (body.bottom - body.top - captionHeight - barHeight - 60) / (source.length * 1.5);
  const size = Math.max(16, Math.min(30, byWidth, byHeight));
  const lineHeight = size * 1.5;
  const windowHeight = barHeight + 36 + source.length * lineHeight + 24;
  const top = body.top + Math.max(0, (body.bottom - body.top - windowHeight - captionHeight) / 2);
  const highlighted = new Set((visual.highlight ?? []).map(Number));
  const colors = { comment: THEME.codeMuted, string: '#a5d6ff', number: '#ffa657', keyword: '#ff7b72' };

  let markup = `<rect x="${body.left}" y="${top}" width="${width}" height="${windowHeight}" rx="16" fill="${THEME.codeBg}"/>`;
  markup += `<path d="M${body.left},${top + barHeight} v-${barHeight - 16} a16,16 0 0 1 16,-16 h${width - 32} a16,16 0 0 1 16,16 v${barHeight - 16} z" fill="${THEME.codeBar}"/>`;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((color, index) => {
    markup += `<circle cx="${body.left + 30 + index * 26}" cy="${top + barHeight / 2}" r="8" fill="${color}"/>`;
  });
  if (visual.filename) markup += lines([String(visual.filename).slice(0, 48)], { x: body.left + width / 2, y: top + barHeight / 2 + 8, size: 22, fill: THEME.codeMuted, font: MONO, anchor: 'middle' });

  source.forEach((line, index) => {
    const baseline = top + barHeight + 36 + index * lineHeight + size;
    if (highlighted.has(index + 1)) {
      markup += `<rect x="${body.left}" y="${baseline - size * 1.05}" width="${width}" height="${lineHeight}" fill="${accent}" opacity="0.28"/>`;
      markup += `<rect x="${body.left}" y="${baseline - size * 1.05}" width="6" height="${lineHeight}" fill="${accent}"/>`;
    }
    if (gutter) markup += lines([String(index + 1)], { x: body.left + padX + gutter - 22, y: baseline, size: size * 0.9, fill: THEME.codeMuted, font: MONO, anchor: 'end' });
    const clipped = line.length > longest ? `${line.slice(0, longest - 1)}…` : line;
    const content = terminal && /^\$ /.test(clipped)
      ? `<tspan fill="${accent === ACCENTS[2] ? '#9085e9' : '#7ee787'}">$</tspan>${escapeXml(clipped.slice(1))}`
      : highlight(clipped, colors);
    markup += `<text x="${body.left + padX + gutter}" y="${baseline}" font-family="${MONO}" font-size="${size.toFixed(1)}" fill="${THEME.codeInk}" xml:space="preserve">${content}</text>`;
  });

  if (captionLines.length) markup += lines(captionLines, { x: body.left, y: top + windowHeight + 56, size: 30, lineHeight: 40, fill: THEME.secondary });
  return markup;
}

/** A pull quote, set like a magazine would set it. */
function quote({ visual, accent, body }) {
  const width = body.right - body.left;
  const text = fitText(`“${visual.quote}”`, { startSize: 60, minSize: 34, maxWidth: width - 40, maxLines: 8, charWidthRatio: BOLD_RATIO });
  const lineHeight = text.fontSize * 1.3;
  const who = wrap(visual.who, 30, width - 40, 2);
  const total = text.lines.length * lineHeight + 50 + who.length * 40;
  const top = body.top + Math.max(0, (body.bottom - body.top - total) / 2);

  let markup = `<rect x="${body.left}" y="${top}" width="8" height="${text.lines.length * lineHeight}" rx="3" fill="${accent}"/>`;
  markup += lines(text.lines, { x: body.left + 40, y: top + text.fontSize, size: text.fontSize, lineHeight, weight: 700 });
  markup += lines(who.map((line, index) => (index ? line : `- ${line}`)), { x: body.left + 40, y: top + text.lines.length * lineHeight + 50, size: 30, lineHeight: 40, fill: THEME.secondary });
  return markup;
}

const DRAWERS = {
  chart,
  stat,
  flow,
  comparison,
  checklist,
  code,
  terminal: (input) => code({ ...input, terminal: true }),
  quote,
};

export const VISUAL_TYPES = Object.keys(DRAWERS);

/**
 * Draw one planned visual as a complete SVG document.
 *
 * @param {object} input
 * @param {object} input.visual   a spec from the visual planner, already checked
 * @param {number} input.width
 * @param {number} input.height
 * @param {string} [input.handle] signed bottom-left
 * @param {string} [input.source] credited bottom-right
 */
export function renderVisualSvg({ visual, width, height, handle = '', source = '' }) {
  const draw = DRAWERS[visual?.type];
  if (!draw) throw new Error(`Unknown visual type "${visual?.type}"`);

  const accent = accentFor(visual.title ?? visual.type);
  const framed = frame({ width, height, visual, accent, handle, source: visual.type === 'code' || visual.type === 'terminal' ? '' : source });
  const body = draw({ visual, accent, body: framed.body });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${framed.markup}${body}</svg>`;
}

export default { renderVisualSvg, VISUAL_TYPES, accentFor, THEME, ACCENTS };
