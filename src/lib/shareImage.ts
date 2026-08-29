/**
 * Draws a `ShareCard` onto a canvas and hands it out as a PNG.
 *
 * Canvas rather than a library: the app has no runtime dependencies beyond
 * React and precaches its whole bundle onto a phone, so a few hundred
 * kilobytes of DOM-to-image machinery is a poor trade for one button. Drawing
 * a table is a couple of hundred lines and it behaves the same in every
 * browser, which the DOM-rasterizing approaches do not.
 *
 * Everything here is synchronous on purpose. iOS only allows `navigator.share`
 * during user activation, and an `await` before the call can lose it, so a
 * click handler can go straight from the record to the shared file with
 * nothing suspended in between.
 */

import type { CardTone, ShareCard } from './shareCard';

/** Logical width of the card, in the units all the layout below is written in. */
const W = 540;
/** Drawn at twice that, so the PNG is still crisp on a phone screen. */
const SCALE = 2;

const PAD = 26;
const ROW_H = 30;
const GUTTER = 16;

/**
 * A deliberately fixed palette, not the theme tokens.
 *
 * Every other surface in the app takes its colors from `index.css` so that
 * night and day stay in step. This one must not: the picture leaves the app
 * and lands in someone else's message thread, where it should look the same
 * whether it was exported before sunrise or after. `fast` and `slow` share a
 * color because they are the same answer — outside the band — and the sign in
 * the text already says which side.
 */
const COLOR = {
  bg: '#ffffff',
  panel: '#f3f5f7',
  ink: '#0c1116',
  muted: '#6b7480',
  line: '#e2e6ea',
  on: '#0f6b3c',
  off: '#a8500c',
};

const STACK = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
function font(weight: number, size: number): string {
  return `${weight} ${size}px ${STACK}`;
}

function toneColor(tone: CardTone): string {
  if (tone === 'on') return COLOR.on;
  if (tone === 'fast' || tone === 'slow') return COLOR.off;
  return COLOR.ink;
}

/** Shorten to fit, with an ellipsis, so a long segment name can't run over. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/**
 * Letter spacing is what makes the small uppercase labels legible, but it is
 * a recent canvas property. Assigning it where it isn't supported is a no-op,
 * which is the right outcome — slightly tighter labels, not a broken card.
 */
function setTracking(ctx: CanvasRenderingContext2D, px: string): void {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = px;
}

/**
 * Widths for the numeric columns, measured from their own contents.
 *
 * The first column takes whatever is left, because a segment name is the one
 * thing that can be arbitrarily long and the one thing that can be truncated
 * without losing a number.
 */
function columnWidths(ctx: CanvasRenderingContext2D, card: ShareCard): number[] {
  const widths = card.columns.map((col, i) => {
    if (i === 0) return 0;
    setTracking(ctx, '0.6px');
    ctx.font = font(700, 11);
    let w = ctx.measureText(col.label.toUpperCase()).width;
    setTracking(ctx, '0px');
    for (const row of card.rows) {
      if (row.kind !== 'segment') continue;
      ctx.font = font(i === 0 ? 700 : 600, 15);
      w = Math.max(w, ctx.measureText(row.cells[i]?.text ?? '').width);
    }
    return Math.ceil(w);
  });
  const numeric = widths.slice(1).reduce((a, b) => a + b, 0);
  widths[0] = W - PAD * 2 - numeric - GUTTER * (widths.length - 1);
  return widths;
}

/** Left edge of each column; numeric columns are drawn from their right edge. */
function columnEdges(widths: number[]): number[] {
  const edges: number[] = [];
  let x = PAD;
  for (const w of widths) {
    edges.push(x);
    x += w + GUTTER;
  }
  return edges;
}

/**
 * Renders the card and returns the canvas.
 *
 * Two passes over the same context: the first measures columns and totals the
 * height, then the canvas is sized — which resets the context — and the second
 * draws. Every `fillText` sets its own font, so the reset costs nothing.
 */
export function renderShareCard(card: ShareCard): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  const widths = columnWidths(ctx, card);
  const edges = columnEdges(widths);

  const statsTop = PAD + 38 + 20;
  const statsH = 76;
  const tableTop = statsTop + statsH + 22;
  const headerH = 26;
  const bodyH = card.rows.length * ROW_H;
  const noteH = card.note ? 26 : 0;
  const H = Math.ceil(tableTop + headerH + bodyH + noteH + PAD);

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  // Title and date.
  ctx.fillStyle = COLOR.ink;
  ctx.font = font(800, 26);
  ctx.textAlign = 'left';
  ctx.fillText(fit(ctx, card.title, W - PAD * 2), PAD, PAD + 24);
  ctx.fillStyle = COLOR.muted;
  ctx.font = font(600, 13);
  ctx.fillText(fit(ctx, card.subtitle, W - PAD * 2), PAD, PAD + 44);

  // Headline numbers, evenly divided across the panel.
  ctx.fillStyle = COLOR.panel;
  roundRect(ctx, PAD, statsTop, W - PAD * 2, statsH, 14);
  ctx.fill();
  const statW = (W - PAD * 2) / card.stats.length;
  card.stats.forEach((stat, i) => {
    const x = PAD + statW * i + 18;
    ctx.fillStyle = COLOR.ink;
    ctx.font = font(800, 30);
    ctx.fillText(stat.value, x, statsTop + 42);
    ctx.fillStyle = COLOR.muted;
    ctx.font = font(700, 10);
    setTracking(ctx, '1px');
    ctx.fillText(stat.label.toUpperCase(), x, statsTop + 60);
    setTracking(ctx, '0px');
  });

  // Column headers.
  ctx.fillStyle = COLOR.muted;
  ctx.font = font(700, 11);
  setTracking(ctx, '0.6px');
  card.columns.forEach((col, i) => {
    const label = col.label.toUpperCase();
    if (col.align === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(label, edges[i] + widths[i], tableTop + 14);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(label, edges[i], tableTop + 14);
    }
  });
  setTracking(ctx, '0px');

  // Rows.
  let y = tableTop + headerH;
  for (const row of card.rows) {
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 0.5);
    ctx.lineTo(W - PAD, y + 0.5);
    ctx.stroke();

    const textY = y + 20;
    if (row.kind === 'elision') {
      ctx.fillStyle = COLOR.muted;
      ctx.font = font(600, 13);
      ctx.textAlign = 'center';
      ctx.fillText(row.note ?? '', W / 2, textY);
    } else {
      card.columns.forEach((col, i) => {
        const cell = row.cells[i];
        if (!cell) return;
        ctx.fillStyle = toneColor(cell.tone);
        ctx.font = font(i === 0 ? 700 : 600, 15);
        if (col.align === 'right') {
          ctx.textAlign = 'right';
          ctx.fillText(cell.text, edges[i] + widths[i], textY);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(fit(ctx, cell.text, widths[i]), edges[i], textY);
        }
      });
    }
    y += ROW_H;
  }

  if (card.note) {
    ctx.fillStyle = COLOR.muted;
    ctx.font = font(600, 12);
    ctx.textAlign = 'left';
    ctx.fillText(card.note, PAD, y + 18);
  }

  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The canvas as a PNG file, synchronously.
 *
 * `toBlob` is the tidier call but it is asynchronous, and awaiting it before
 * `navigator.share` spends the user activation that iOS requires — the share
 * sheet then never opens and nothing says why. `toDataURL` is synchronous, so
 * decoding it by hand keeps the whole path from click to share in one task.
 */
export function shareCardFile(card: ShareCard): File {
  const canvas = renderShareCard(card);
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], card.fileName, { type: 'image/png' });
}
