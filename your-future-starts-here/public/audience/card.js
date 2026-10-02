// Draws the student's action card onto a canvas so it can be saved as an image.
// Hand-drawn rather than screenshotting the DOM: no extra library to download.
window.YFSHCard = (() => {
  'use strict';

  const W = 1080;
  const H = 1350;
  const FONT = '"Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    for (const l of lines) { ctx.fillText(l, x, y); y += lineHeight; }
    return y;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render({ project, who, step, reminder }) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Deep violet background with the LUNA network grid
    ctx.fillStyle = '#160b3a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(201,184,245,0.10)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(201,184,245,0.28)';
    for (let x = 0; x <= W; x += 60) for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }

    // Lavender card
    const pad = 70;
    const cardX = pad, cardY = pad, cardW = W - pad * 2, cardH = H - pad * 2;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#f3eeff';
    roundRect(ctx, cardX, cardY, cardW, cardH, 44);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    const inner = 64;
    const x = cardX + inner;
    const maxW = cardW - inner * 2;
    let y = cardY + inner + 22;

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#3a2487';
    ctx.font = `900 30px ${FONT}`;
    ctx.fillText('MY FIRST SMALL PROJECT', x, y);
    y += 60;

    // Project sentence
    ctx.fillStyle = '#1f1150';
    ctx.font = `900 58px ${FONT}`;
    const projectLines = wrap(ctx, project, maxW).slice(0, 5);
    y = drawLines(ctx, projectLines, x, y + 40, 70) + 30;

    // Divider
    ctx.strokeStyle = 'rgba(58,36,135,0.2)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + maxW, y); ctx.stroke();
    y += 60;

    const section = (label, value) => {
      ctx.fillStyle = '#8f74d9';
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(label.toUpperCase(), x, y);
      y += 48;
      ctx.fillStyle = '#1f1150';
      ctx.font = `800 42px ${FONT}`;
      y = drawLines(ctx, wrap(ctx, value, maxW).slice(0, 4), x, y, 54) + 36;
    };
    section('Who I could help', who);
    section('My first step', step);

    // Reminder box
    ctx.fillStyle = 'rgba(176,154,234,0.25)';
    ctx.font = `700 30px ${FONT}`;
    const remLines = wrap(ctx, `Reminder: ${reminder}`, maxW - 60);
    const boxH = remLines.length * 42 + 56;
    roundRect(ctx, x, y, maxW, boxH, 24);
    ctx.fill();
    ctx.fillStyle = '#2a1868';
    drawLines(ctx, remLines, x + 30, y + 54, 42);

    // Footer: logo on the left; the tagline sits to its right when there is
    // room, otherwise above it (fallback fonts are wider than the real one).
    const footerBottom = cardY + cardH - inner + 10;
    const logoH = 64;
    const logoW = drawLogo(ctx, x, footerBottom - logoH, logoH, '#2a1868');
    const tagline = 'YOUR FUTURE STARTS HERE';
    ctx.fillStyle = '#8f74d9';
    ctx.font = `800 24px ${FONT}`;
    const tagW = ctx.measureText(tagline).width;
    if (logoW + 40 + tagW <= maxW) {
      ctx.textAlign = 'right';
      ctx.fillText(tagline, x + maxW, footerBottom - 22);
      ctx.textAlign = 'left';
    } else {
      ctx.fillText(tagline, x, footerBottom - logoH - 26);
    }

    return canvas;
  }

  // Same mark and wordmark as the on-screen logo (see shared/logo.js).
  // Returns the drawn width so the caller can lay out around it.
  function drawLogo(ctx, x, y, height, color) {
    const logo = window.YFSHLogo;
    const scale = height / 200;
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (logo && typeof Path2D === 'function') {
      ctx.fill(new Path2D(logo.MARK_PATH));
      ctx.beginPath();
      ctx.arc(logo.MARK_DOT.cx, logo.MARK_DOT.cy, logo.MARK_DOT.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const CONDENSED = `"Bebas Neue", "Oswald", "Arial Narrow", ${FONT}`;
    const tx = x + height * 1.2 + 14;
    ctx.fillStyle = color;
    ctx.font = `400 ${Math.round(height * 0.72)}px ${CONDENSED}`;
    ctx.fillText('AI EMPOWERED', tx, y + height * 0.62);
    const nameW = ctx.measureText('AI EMPOWERED').width;
    ctx.font = `400 ${Math.round(height * 0.3)}px ${CONDENSED}`;
    spacedText(ctx, 'CLUB', tx + height * 0.12, y + height * 0.98, height * 0.32);
    return tx + nameW - x;
  }

  function spacedText(ctx, text, x, y, spacing) {
    for (const ch of text) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  function toBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  return { render, toBlob };
})();
