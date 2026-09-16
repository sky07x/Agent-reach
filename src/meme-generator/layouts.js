/**
 * The meme layouts, drawn as SVG.
 *
 * A template file (assets/meme-templates/*.json) picks one of these layouts
 * and supplies the colours. That split means adding a new look is a small
 * JSON file, and adding a new *shape* is one function here.
 *
 * Fonts: we ask for a stack of common sans faces. On a machine with no fonts
 * installed (a bare Lambda zip, for example) SVG text will not render, so the
 * deploy notes cover shipping a font with the bundle.
 */

import { escapeXml, fitText, CHAR_WIDTH_RATIO } from './text.js';

const FONT_STACK = "'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";
const MONO_STACK = "'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace";

/** Background fill, either a flat colour or a two-stop gradient. */
function background(template, width, height) {
  const { background: bg } = template;

  if (bg.type === 'gradient') {
    return `
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${bg.from}"/>
          <stop offset="100%" stop-color="${bg.to}"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>`;
  }

  return `<rect width="${width}" height="${height}" fill="${bg.color}"/>`;
}

/** Draw wrapped lines centred on x, starting at y. */
function textBlock(lines, { x, y, fontSize, fill, anchor = 'middle', weight = 800, font = FONT_STACK, stroke }) {
  const lineHeight = fontSize * 1.15;
  const strokeAttrs = stroke ? `stroke="${stroke}" stroke-width="${Math.max(2, fontSize * 0.06)}" paint-order="stroke"` : '';

  return lines.map((line, index) => `
    <text x="${x}" y="${y + index * lineHeight}"
          font-family="${font}" font-size="${fontSize}" font-weight="${weight}"
          fill="${fill}" text-anchor="${anchor}" ${strokeAttrs}>${escapeXml(line)}</text>`).join('');
}

/* ------------------------------------------------------------------ */
/* Layouts                                                             */
/* ------------------------------------------------------------------ */

/** Top caption, bottom punchline. The default meme shape. */
function classic({ template, width, height, topText, bottomText }) {
  const padding = width * 0.08;
  const maxWidth = width - padding * 2;

  const caps = CHAR_WIDTH_RATIO.sansCaps;
  const top = fitText(topText.toUpperCase(), { startSize: 76, minSize: 34, maxWidth, maxLines: 3, charWidthRatio: caps });
  const bottom = fitText(bottomText.toUpperCase(), { startSize: 68, minSize: 30, maxWidth, maxLines: 3, charWidthRatio: caps });

  return `
    ${background(template, width, height)}
    <rect x="${padding / 2}" y="${padding / 2}" width="${width - padding}" height="${height - padding}"
          fill="none" stroke="${template.accent}" stroke-width="4" rx="24" opacity="0.5"/>
    ${textBlock(top.lines, {
      x: width / 2, y: height * 0.22, fontSize: top.fontSize, fill: template.textColor, stroke: template.outline,
    })}
    <line x1="${width * 0.25}" y1="${height * 0.5}" x2="${width * 0.75}" y2="${height * 0.5}"
          stroke="${template.accent}" stroke-width="5" stroke-linecap="round"/>
    ${textBlock(bottom.lines, {
      x: width / 2, y: height * 0.68, fontSize: bottom.fontSize, fill: template.accent, stroke: template.outline,
    })}`;
}

/** Two stacked panels, the "this vs that" shape. */
function twoPanel({ template, width, height, topText, bottomText }) {
  const half = height / 2;
  const padding = width * 0.07;
  const maxWidth = width - padding * 2;

  const sans = CHAR_WIDTH_RATIO.sans;
  const top = fitText(topText, { startSize: 62, minSize: 30, maxWidth, maxLines: 3, charWidthRatio: sans });
  const bottom = fitText(bottomText, { startSize: 62, minSize: 30, maxWidth, maxLines: 3, charWidthRatio: sans });


  return `
    ${background(template, width, height)}
    <rect y="${half}" width="${width}" height="${half}" fill="${template.accent}" opacity="0.12"/>
    <line x1="0" y1="${half}" x2="${width}" y2="${half}" stroke="${template.accent}" stroke-width="4"/>
    <text x="${padding}" y="${half * 0.28}" font-family="${MONO_STACK}" font-size="30"
          fill="${template.accent}" opacity="0.8">// before</text>
    ${textBlock(top.lines, {
      x: width / 2, y: half * 0.6, fontSize: top.fontSize, fill: template.textColor, weight: 700,
    })}
    <text x="${padding}" y="${half + half * 0.22}" font-family="${MONO_STACK}" font-size="30"
          fill="${template.accent}" opacity="0.8">// after</text>
    ${textBlock(bottom.lines, {
      x: width / 2, y: half + half * 0.55, fontSize: bottom.fontSize, fill: template.accent, weight: 800,
    })}`;
}

/** A fake terminal window. Reliably on-brand for a dev audience. */
function terminal({ template, width, height, topText, bottomText }) {
  const margin = width * 0.06;
  const windowWidth = width - margin * 2;
  const windowHeight = height - margin * 2;
  const barHeight = 64;
  const padding = 44;
  const maxWidth = windowWidth - padding * 2;

  const mono = CHAR_WIDTH_RATIO.mono;
  const command = fitText(`$ ${topText}`, { startSize: 44, minSize: 26, maxWidth, maxLines: 3, charWidthRatio: mono });
  const output = fitText(bottomText, { startSize: 52, minSize: 28, maxWidth, maxLines: 5, charWidthRatio: mono });

  // Flow the output under the command rather than pinning it to a fixed
  // height, so a two-line command never collides with a five-line output,
  // then centre the whole block so short captions don't float at the top.
  const commandHeight = command.lines.length * command.fontSize * 1.3;
  const outputHeight = output.lines.length * output.fontSize * 1.25;
  const gap = output.fontSize * 1.6;
  const blockHeight = commandHeight + gap + outputHeight;

  const contentTop = margin + barHeight;
  const contentHeight = windowHeight - barHeight;
  const commandTop = contentTop + (contentHeight - blockHeight) / 2 + command.fontSize;
  const outputTop = commandTop + commandHeight + gap;

  const dots = ['#ff5f57', '#febc2e', '#28c840']
    .map((color, index) => `<circle cx="${margin + 32 + index * 32}" cy="${margin + barHeight / 2}" r="10" fill="${color}"/>`)
    .join('');

  return `
    ${background(template, width, height)}
    <rect x="${margin}" y="${margin}" width="${windowWidth}" height="${windowHeight}" rx="20" fill="#0b0f19"/>
    <rect x="${margin}" y="${margin}" width="${windowWidth}" height="${barHeight}" rx="20" fill="#1b2130"/>
    <rect x="${margin}" y="${margin + barHeight - 20}" width="${windowWidth}" height="20" fill="#0b0f19"/>
    ${dots}
    ${command.lines.map((line, index) => `
      <text x="${margin + padding}" y="${commandTop + index * command.fontSize * 1.3}"
            font-family="${MONO_STACK}" font-size="${command.fontSize}" fill="${template.accent}">${escapeXml(line)}</text>`).join('')}
    ${output.lines.map((line, index) => `
      <text x="${margin + padding}" y="${outputTop + index * output.fontSize * 1.25}"
            font-family="${MONO_STACK}" font-size="${output.fontSize}" font-weight="700"
            fill="${template.textColor}">${escapeXml(line)}</text>`).join('')}`;
}

/** Big pull-quote. Good for "someone actually said this" stories. */
function quote({ template, width, height, topText, bottomText }) {
  const padding = width * 0.1;
  const maxWidth = width - padding * 2;

  const main = fitText(`"${topText}"`, { startSize: 78, minSize: 32, maxWidth, maxLines: 5, charWidthRatio: CHAR_WIDTH_RATIO.sans });
  const attribution = fitText(bottomText, { startSize: 40, minSize: 24, maxWidth, maxLines: 2, charWidthRatio: CHAR_WIDTH_RATIO.sans });

  return `
    ${background(template, width, height)}
    <text x="${padding}" y="${height * 0.25}" font-family="${FONT_STACK}" font-size="200"
          fill="${template.accent}" opacity="0.25" font-weight="900">&#8220;</text>
    ${textBlock(main.lines, {
      x: width / 2, y: height * 0.38, fontSize: main.fontSize, fill: template.textColor, weight: 700,
    })}
    <line x1="${width * 0.35}" y1="${height * 0.76}" x2="${width * 0.65}" y2="${height * 0.76}"
          stroke="${template.accent}" stroke-width="4"/>
    ${textBlock(attribution.lines, {
      x: width / 2, y: height * 0.84, fontSize: attribution.fontSize, fill: template.accent, weight: 500,
    })}`;
}

/** A chat exchange. Works for "PM asks / engineer answers" jokes. */
function chat({ template, width, height, topText, bottomText }) {
  const padding = width * 0.08;
  const bubbleWidth = width * 0.7;
  const maxWidth = bubbleWidth - 80;

  const ask = fitText(topText, { startSize: 46, minSize: 24, maxWidth, maxLines: 4, charWidthRatio: CHAR_WIDTH_RATIO.sans });
  const reply = fitText(bottomText, { startSize: 50, minSize: 24, maxWidth, maxLines: 4, charWidthRatio: CHAR_WIDTH_RATIO.sans });

  const askHeight = ask.lines.length * ask.fontSize * 1.3 + 70;
  const replyHeight = reply.lines.length * reply.fontSize * 1.3 + 70;
  const replyTop = height * 0.52;

  return `
    ${background(template, width, height)}
    <rect x="${padding}" y="${height * 0.18}" width="${bubbleWidth}" height="${askHeight}" rx="32"
          fill="${template.textColor}" opacity="0.12"/>
    ${ask.lines.map((line, index) => `
      <text x="${padding + 40}" y="${height * 0.18 + 60 + index * ask.fontSize * 1.3}"
            font-family="${FONT_STACK}" font-size="${ask.fontSize}" fill="${template.textColor}">${escapeXml(line)}</text>`).join('')}
    <rect x="${width - padding - bubbleWidth}" y="${replyTop}" width="${bubbleWidth}" height="${replyHeight}" rx="32"
          fill="${template.accent}" opacity="0.9"/>
    ${reply.lines.map((line, index) => `
      <text x="${width - padding - bubbleWidth + 40}" y="${replyTop + 60 + index * reply.fontSize * 1.3}"
            font-family="${FONT_STACK}" font-size="${reply.fontSize}" font-weight="700"
            fill="${template.replyTextColor ?? '#0b0f19'}">${escapeXml(line)}</text>`).join('')}`;
}

export const LAYOUTS = { classic, 'two-panel': twoPanel, terminal, quote, chat };

/** Render a template + captions into a complete SVG document. */
export function renderSvg({ template, width, height, topText, bottomText, footer }) {
  const draw = LAYOUTS[template.layout];

  if (!draw) {
    throw new Error(`Template "${template.name}" uses unknown layout "${template.layout}"`);
  }

  const body = draw({ template, width, height, topText, bottomText });

  // Sits inside whatever frame the layout drew, not below it.
  const footerMarkup = footer
    ? `<text x="${width / 2}" y="${height - 58}" font-family="${MONO_STACK}" font-size="26"
             fill="${template.accent}" opacity="0.55" text-anchor="middle">${escapeXml(footer)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${body}
    ${footerMarkup}
  </svg>`;
}

export default { LAYOUTS, renderSvg };
