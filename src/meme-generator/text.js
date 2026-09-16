/**
 * Text helpers for drawing on the meme canvas.
 *
 * SVG has no word wrap, so we work out the line breaks ourselves before
 * handing the markup to sharp.
 */

/** Escape the five characters that would otherwise break the SVG. */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * How wide one character is, as a fraction of the font size.
 *
 * Rough averages rather than real font metrics, which keeps us off a
 * font-measuring dependency. Monospace is wider because every glyph takes a
 * full cell, including the thin ones.
 */
/**
 * These are measured against DejaVu, which is what Lambda uses, because that
 * is where the memes are actually made. Do not tune them against whatever
 * font your laptop happens to have: macOS picks a narrower face, so text that
 * fits locally can still run off the edge in production.
 *
 * Capitals are much wider than lowercase, so the uppercase layouts get their
 * own number. Guessing 0.55 for bold caps was 34% too narrow.
 */
export const CHAR_WIDTH_RATIO = {
  sans: 0.62,      // mixed case
  sansCaps: 0.78,  // UPPERCASE, bold. Measured at 0.74, plus a safety margin.
  mono: 0.63,      // DejaVu Sans Mono advance is 0.602 em, plus margin
};

/**
 * Break text into lines that fit a given width.
 *
 * Not typographically exact, but close enough for a meme.
 */
export function wrapText(text, { fontSize, maxWidth, maxLines = 4, charWidthRatio = CHAR_WIDTH_RATIO.sans }) {
  const averageCharWidth = fontSize * charWidthRatio;
  const charsPerLine = Math.max(8, Math.floor(maxWidth / averageCharWidth));

  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= charsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  // Too long to fit: keep what we can and mark the cut.
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, charsPerLine - 1)}…`;
  return kept;
}

/**
 * Shrink the font until the text fits in the space we gave it.
 * Returns the chosen size and the wrapped lines.
 */
export function fitText(text, { startSize, minSize, maxWidth, maxLines, charWidthRatio = CHAR_WIDTH_RATIO.sans }) {
  let fontSize = startSize;

  while (fontSize > minSize) {
    const lines = wrapText(text, { fontSize, maxWidth, maxLines: maxLines + 2, charWidthRatio });
    if (lines.length <= maxLines) return { fontSize, lines };
    fontSize -= 4;
  }

  return { fontSize: minSize, lines: wrapText(text, { fontSize: minSize, maxWidth, maxLines, charWidthRatio }) };
}

export default { escapeXml, wrapText, fitText, CHAR_WIDTH_RATIO };
