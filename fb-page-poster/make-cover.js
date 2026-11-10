#!/usr/bin/env node
'use strict';

// Renders the AI Empowered Club Facebook Page cover and a preview of how it
// crops on desktop and mobile.
//
//   node make-cover.js --out graphics/brand/fb-cover
//
// Writes <out>.png (1640x924, the 16:9 upload Facebook recommends: phones show
// all of it, computers show the middle ~1640x624 band) and <out>-preview.png.
// Everything important sits in that middle band and clear of the lower-left
// corner, where the Page's profile picture overlaps the cover.

const fs = require('fs');
const path = require('path');

const W = 1640;
const H = 924;
const BAND = Math.round(W / (820 / 312)); // height computers show, centred

const asset = (file) => `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'brand', file)).toString('base64')}`;

function cover() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;color:#fff;font-family:'Inter',sans-serif;
  background:radial-gradient(circle at 78% 20%,rgba(112,85,250,.65) 0,transparent 45%),
    radial-gradient(circle at 10% 100%,rgba(112,52,171,.55) 0,transparent 40%),
    linear-gradient(150deg,#3B23B5 0%,#1E1260 50%,#0B0518 100%)}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(199,190,218,.35) 1.4px,transparent 1.6px);background-size:40px 40px;opacity:.4;
  -webkit-mask-image:radial-gradient(ellipse at 50% 50%,transparent 30%,#000 75%)}
.ring{position:absolute;right:-120px;top:50%;transform:translateY(-50%);width:760px;height:760px;border-radius:50%;border:3px dashed rgba(199,190,218,.25)}
.ring.two{right:40px;width:440px;height:440px;border-style:solid;border-color:rgba(112,85,250,.45);box-shadow:0 0 120px rgba(112,85,250,.35)}
.wrap{position:absolute;left:0;right:0;top:${(H - BAND) / 2}px;height:${BAND}px;display:flex;align-items:center;justify-content:center;gap:70px;padding:0 140px}
.logo{width:330px;flex:none;filter:drop-shadow(0 0 50px rgba(112,85,250,.8))}
.divider{width:3px;height:300px;background:linear-gradient(transparent,rgba(199,190,218,.6),transparent);flex:none}
.copy{max-width:800px}
h1{font-family:'Inter Display';font-weight:800;font-size:92px;line-height:1.02;letter-spacing:-2px;margin:0 0 26px}
.hl{color:#EFA831}
.sub{font-size:40px;line-height:1.35;color:#C7BEDA;margin:0 0 30px}
.abc{display:flex;align-items:center;gap:20px;font-family:'Inter Display';font-weight:700;font-size:24px;letter-spacing:4px;text-transform:uppercase;color:#C7BEDA}
.abc img{height:46px}
.tag{position:absolute;right:70px;bottom:${(H - BAND) / 2 + 26}px;font-family:'Inter Display';font-weight:700;font-size:26px;letter-spacing:3px;color:#EFA831}
</style></head><body>
<div class="dots"></div><div class="ring"></div><div class="ring two"></div>
<div class="wrap">
  <img class="logo" src="${asset('aec-logo-white.png')}" alt="AI Empowered Club">
  <div class="divider"></div>
  <div class="copy">
    <h1>AI-empowered,<br><span class="hl">not powered by AI.</span></h1>
    <p class="sub">Learn AI with friends, not alone.</p>
    <div class="abc">Home of <img src="${asset('abc-logo-white.png')}" alt="AI Builder's Camp"></div>
  </div>
</div>
<div class="tag">#YourAIBestie</div>
</body></html>`;
}

// Desktop crop with the profile picture overlapping lower left, and the full
// phone view with its overlap.
function preview(uri) {
  const dW = 820;
  const dH = 312;
  const mW = 360;
  const mH = Math.round(mW * (H / W));
  return `<!doctype html><html><head><style>
body{margin:0;padding:30px;background:#e9e9ee;font-family:Inter,sans-serif;display:flex;gap:40px;align-items:flex-start}
.label{font:700 15px Inter;letter-spacing:1px;text-transform:uppercase;color:#555;margin:0 0 10px}
.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.15);padding-bottom:16px}
.pic{position:absolute;border-radius:50%;border:4px solid #fff;background:#0B0518;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800}
.name{font:800 24px Inter;color:#111}
</style></head><body>
<div><p class="label">Desktop · 820×312</p><div class="card" style="width:${dW}px">
  <div style="position:relative;width:${dW}px;height:${dH}px;background:url(${uri}) center/cover"></div>
  <div style="position:relative;height:110px"><div class="pic" style="left:24px;top:-60px;width:168px;height:168px">AEC</div>
  <div style="position:absolute;left:210px;top:16px"><div class="name">AI Empowered Club</div><div style="color:#65676b;font-size:15px">Education website</div></div></div>
</div></div>
<div><p class="label">Phone · 640×360</p><div class="card" style="width:${mW}px">
  <div style="position:relative;width:${mW}px;height:${mH}px;background:url(${uri}) center/cover"></div>
  <div style="position:relative;height:120px"><div class="pic" style="left:14px;top:-50px;width:110px;height:110px">AEC</div>
  <div style="position:absolute;left:14px;top:66px"><div class="name" style="font-size:20px">AI Empowered Club</div></div></div>
</div></div></body></html>`;
}

async function main() {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(i > 0 ? process.argv[i + 1] : 'graphics/brand/fb-cover');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(cover(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}.png` });
    console.log(`Saved ${out}.png`);
    const p = await browser.newPage({ viewport: { width: 1340, height: 520 }, deviceScaleFactor: 2 });
    await p.setContent(preview(`data:image/png;base64,${fs.readFileSync(`${out}.png`).toString('base64')}`), { waitUntil: 'load' });
    await p.screenshot({ path: `${out}-preview.png`, fullPage: true });
    console.log(`Saved ${out}-preview.png`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
