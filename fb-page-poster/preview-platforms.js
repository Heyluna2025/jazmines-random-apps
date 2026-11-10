#!/usr/bin/env node
'use strict';

// Mocks up how a carousel will look on each platform, for review before posting:
//
//   node preview-platforms.js content/week1/abc-intro.json graphics/week1/2026-11-10-abc-intro
//
// Reads <prefix>-01.png, -02.png, ... and the spec's caption, and writes
//   <prefix>-preview-instagram.png  phone feed (cover + slide 2 at real phone
//                                   size, caption cut where "more" appears) and
//                                   the profile grid, which crops covers to 3:4
//   <prefix>-preview-facebook.png   feed post with the multi-photo collage
//                                   (approximate: Facebook picks the layout) and
//                                   the caption cut where "See more" appears
//   <prefix>-preview-crops.png      every slide with the 3:4 and 1:1 crop lines,
//                                   to check nothing important sits outside them
// These are approximations of the apps, not screenshots of them.

const fs = require('fs');
const path = require('path');

const PHONE = 390; // CSS width of a typical phone screen

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

// Instagram shows about two lines (~125 characters) before "… more".
function igCaption(text) {
  const first = text.replace(/\n+/g, ' ').trim();
  return first.length > 125 ? `${escape(first.slice(0, 125).trimEnd())}… <span class="more">more</span>` : escape(first);
}

// Facebook shows a few lines (~250 characters, keeping line breaks) before "See more".
function fbCaption(text) {
  const cut = text.length > 250 ? text.slice(0, 250).trimEnd() : text;
  return `${escape(cut).replace(/\n/g, '<br>')}${text.length > 250 ? '… <span class="more">See more</span>' : ''}`;
}

const base = `*{box-sizing:border-box}body{margin:0;padding:30px;background:#e9e9ee;font-family:Inter,sans-serif;display:flex;gap:40px;align-items:flex-start}
.label{font:700 15px Inter;letter-spacing:1px;text-transform:uppercase;color:#555;margin:0 0 10px}
.phone{width:${PHONE}px;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.15)}
.head{display:flex;align-items:center;gap:10px;padding:12px 14px;font-size:14px;font-weight:600;color:#111}
.av{width:32px;height:32px;border-radius:50%;background:#0B0518;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800}
.sub{font-weight:400;color:#777;font-size:12px}
.more{color:#8e8e8e}
.cap{padding:8px 14px 16px;font-size:14px;line-height:1.4;color:#111}`;

function instagram(files, caption, handle) {
  const slide = (f, n) => `<div class="phone"><div class="head"><div class="av">AEC</div><div>${handle}<div class="sub">Sponsored-free · carousel</div></div></div>
    <div style="position:relative"><img src="${dataUri(f)}" style="width:${PHONE}px;height:${PHONE * 1.25}px;display:block">
      <div style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;padding:3px 9px;border-radius:12px">${n}/${files.length}</div></div>
    <div style="display:flex;justify-content:center;gap:4px;padding:10px">${files.map((_, i) => `<span style="width:6px;height:6px;border-radius:50%;background:${i === n - 1 ? '#0095f6' : '#ccc'}"></span>`).join('')}</div>
    <div class="cap"><b>${handle}</b> ${igCaption(caption)}</div></div>`;
  const grid = `<div style="width:${PHONE}px;background:#fff;border-radius:28px;padding:14px 0;box-shadow:0 10px 40px rgba(0,0,0,.15)">
    <div class="head" style="padding-top:0">${handle} · profile grid (3:4 crop)</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">
      ${[0, 1, 2, 3, 4, 5].map((i) => (i === 0
        ? `<div style="aspect-ratio:3/4;background:url(${dataUri(files[0])}) center/cover"></div>`
        : `<div style="aspect-ratio:3/4;background:#ddd"></div>`)).join('')}
    </div></div>`;
  return `<style>${base}</style>
    <div><p class="label">Instagram · feed, cover</p>${slide(files[0], 1)}</div>
    <div><p class="label">Instagram · feed, slide 2</p>${slide(files[1] || files[0], 2)}</div>
    <div><p class="label">Instagram · profile</p>${grid}</div>`;
}

// A common Facebook layout for several portrait photos: one large tile on the
// left, a column of three on the right, "+N" over the last.
function facebook(files, caption, page) {
  const W = PHONE;
  const H = Math.round(W * 1.0);
  const tile = (f, style, extra = '') => `<div style="position:relative;background:url(${dataUri(f)}) center/cover;${style}">${extra}</div>`;
  const rest = files.slice(1, 4);
  const more = files.length - 4;
  const collage = `<div style="display:grid;grid-template-columns:2fr 1fr;grid-template-rows:repeat(3,1fr);gap:2px;width:${W}px;height:${H}px">
    ${tile(files[0], 'grid-row:1 / span 3')}
    ${rest.map((f, i) => tile(f, '', i === rest.length - 1 && more > 0 ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.45);color:#fff;font:600 30px Inter;display:flex;align-items:center;justify-content:center">+${more}</div>` : '')).join('')}
  </div>`;
  const opened = `<div class="phone" style="background:#000"><div class="head" style="color:#fff">Tapped open · photo 1 of ${files.length}</div>
    <img src="${dataUri(files[0])}" style="width:${W}px;display:block"><div style="height:24px"></div></div>`;
  return `<style>${base}</style>
    <div><p class="label">Facebook · feed (approximate collage)</p><div class="phone">
      <div class="head"><div class="av">AEC</div><div>${page}<div class="sub">Just now · 🌐</div></div></div>
      <div class="cap" style="padding-top:0">${fbCaption(caption)}</div>${collage}
      <div style="display:flex;justify-content:space-around;padding:12px;color:#65676b;font-size:14px;font-weight:600;border-top:1px solid #eee">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span></div></div></div>
    <div><p class="label">Facebook · when tapped</p>${opened}</div>`;
}

function crops(files) {
  const w = 270;
  const h = w * 1.25;
  const sq = (h - w) / 2; // 1:1 removes this much top and bottom
  const g = (w - h * 0.75) / 2; // 3:4 removes this much each side
  return `<style>${base}body{flex-wrap:wrap;gap:24px}</style>
    <p class="label" style="width:100%">Crop check · solid = 3:4 profile grid, dashed = 1:1 square tiles. Key content should sit inside both.</p>
    ${files.map((f, i) => `<div><div style="position:relative;width:${w}px;height:${h}px">
      <img src="${dataUri(f)}" style="width:${w}px;height:${h}px;display:block;border-radius:6px">
      <div style="position:absolute;top:0;bottom:0;left:${g}px;right:${g}px;border-left:2px solid #ff3b6b;border-right:2px solid #ff3b6b"></div>
      <div style="position:absolute;left:0;right:0;top:${sq}px;bottom:${sq}px;border-top:2px dashed #ffd400;border-bottom:2px dashed #ffd400"></div>
    </div><p class="label" style="margin-top:6px">Slide ${i + 1}</p></div>`).join('')}`;
}

async function main() {
  const [specFile, prefix] = process.argv.slice(2);
  if (!specFile || !prefix) {
    console.error('Usage: node preview-platforms.js SPEC.json graphics/PREFIX');
    process.exit(1);
  }
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const dir = path.dirname(path.resolve(prefix));
  const stem = path.basename(prefix);
  const files = fs.readdirSync(dir).filter((f) => new RegExp(`^${stem}-\\d{2}\\.png$`).test(f)).sort().map((f) => path.join(dir, f));
  if (!files.length) throw new Error(`No slides found at ${prefix}-01.png. Render the carousel first.`);

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    const shots = {
      instagram: instagram(files, spec.caption || '', 'aiempoweredclub'),
      facebook: facebook(files, spec.caption || '', 'AI Empowered Club'),
      crops: crops(files),
    };
    for (const [name, html] of Object.entries(shots)) {
      await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: 'load' });
      const out = `${path.resolve(prefix)}-preview-${name}.png`;
      await page.screenshot({ path: out, fullPage: true });
      console.log(`Saved ${out}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
