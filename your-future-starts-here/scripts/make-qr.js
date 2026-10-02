#!/usr/bin/env node
'use strict';

// Makes the QR assets for a printed or pasted join code.
//
//   node scripts/make-qr.js https://yourfuturestartshere.xyz [docs/qr]
//
// Writes join-qr.png (2048 px), join-qr.svg, and two self-contained HTML
// cards (light and dark) you can open in a browser and screenshot or print.
// The bare domain always opens the session marked live on the presenter page.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/make-qr.js <url> [outDir]');
  process.exit(1);
}
const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs', 'qr'));
fs.mkdirSync(out, { recursive: true });

const VIOLET = '#1f1150';
// Same mark as public/shared/logo.js
const MARK_PATH = 'M76 45A24 24 0 0 1 114 45L232 192H114L32 100Z';
const MARK_DOT = { cx: 34, cy: 164, r: 28 };

const fontsDir = path.join(__dirname, '..', 'public', 'shared', 'fonts');
const fontFace = (family, file, weight) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontsDir, file)).toString('base64')}) format('woff2')}`;

function card({ theme, qrSvg, display }) {
  const dark = theme === 'dark';
  const bg = dark ? '#160b3a' : '#f3eeff';
  const fg = dark ? '#ffffff' : '#1f1150';
  const accent = dark ? '#c9b8f5' : '#5b3fa6';
  const grid = dark ? 'rgba(201,184,245,0.10)' : 'rgba(58,36,135,0.08)';
  const dots = dark ? 'rgba(201,184,245,0.28)' : 'rgba(58,36,135,0.18)';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Join QR (${theme})</title>
<style>
${fontFace('Nunito', 'nunito-variable-latin.woff2', '200 1000')}
${fontFace('Bebas Neue', 'bebas-neue-400-latin.woff2', '400')}
html,body{margin:0;background:${bg}}
.card{position:relative;width:1400px;height:1400px;box-sizing:border-box;padding:90px;color:${fg};font-family:Nunito,system-ui,sans-serif;
  background:${bg};background-image:radial-gradient(circle,${dots} 2px,transparent 3px),linear-gradient(${grid} 2px,transparent 2px),linear-gradient(90deg,${grid} 2px,transparent 2px);background-size:70px 70px;
  display:grid;grid-template-rows:auto 1fr auto;gap:40px;text-align:center}
.logo{display:flex;align-items:center;justify-content:center;gap:22px;color:${fg}}
.logo svg{height:84px;width:auto;fill:currentColor}
.logo .name{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:66px;line-height:.9;letter-spacing:.03em}
.logo .sub{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:28px;letter-spacing:.5em;text-indent:.5em;margin-top:8px}
.logo .text{display:flex;flex-direction:column;align-items:center}
.mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px}
h1{margin:0;font-size:92px;font-weight:900;letter-spacing:-.01em;line-height:1}
.sub1{margin:0;font-size:38px;font-weight:700;color:${accent}}
.tile{background:#fff;border-radius:48px;padding:44px;box-shadow:0 30px 80px rgba(8,3,25,${dark ? '.55' : '.18'})}
.tile svg{display:block;width:640px;height:640px}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:800;font-size:44px;color:${fg};word-break:break-all}
.foot{font-size:28px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${accent}}
</style></head><body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 240 200" aria-hidden="true"><path d="${MARK_PATH}"/><circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}"/></svg>
    <div class="text"><span class="name">AI EMPOWERED</span><span class="sub">CLUB</span></div>
  </div>
  <div class="mid">
    <h1>Scan to join</h1>
    <p class="sub1">Your Future Starts Here</p>
    <div class="tile">${qrSvg}</div>
    <div class="url">${display}</div>
  </div>
  <div class="foot">AI and the Future of Work</div>
</div>
</body></html>`;
}

(async () => {
  const color = { dark: VIOLET, light: '#ffffff' };
  await QRCode.toFile(path.join(out, 'join-qr.png'), url, { type: 'png', width: 2048, margin: 4, errorCorrectionLevel: 'H', color });
  await QRCode.toFile(path.join(out, 'join-qr.svg'), url, { type: 'svg', margin: 4, errorCorrectionLevel: 'H', color });
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'H', color });
  const display = url.replace(/^https?:\/\//, '');
  for (const theme of ['light', 'dark']) {
    fs.writeFileSync(path.join(out, `join-card-${theme}.html`), card({ theme, qrSvg, display }));
  }
  console.log(`QR for ${url}`);
  console.log(`  ${path.join(out, 'join-qr.png')}`);
  console.log(`  ${path.join(out, 'join-qr.svg')}`);
  console.log(`  ${path.join(out, 'join-card-light.html')} / join-card-dark.html (open and screenshot, or print)`);
})().catch((err) => { console.error(err); process.exit(1); });
