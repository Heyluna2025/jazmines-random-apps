#!/usr/bin/env node
'use strict';

// Renders a square 1080x1080 post graphic in the AI Empowered Club style.
//
//   node make-graphic.js --title "Posted by *AI*" [--tag "New this week"] [--subtitle "..."] [--footer "AI Empowered Club"] [--theme dark|light] --out graphics/post.png
//
// Wrap a word in *asterisks* to colour it with the accent. Use \n in the
// title or subtitle for a line break. Needs Playwright with Chromium, which
// Claude cloud environments have preinstalled.

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  return opts;
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rich = (s) => escape(s).replace(/\\n|\n/g, '<br>').replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>');

const THEMES = {
  dark: { bg: 'radial-gradient(circle at 25% 20%,#5b3fa6 0,#2a1667 45%,#140a36 100%)', fg: '#ffffff', sub: '#e7defc', accent: '#c9b8f5', grid: 'rgba(201,184,245,.08)' },
  light: { bg: 'radial-gradient(circle at 25% 20%,#ffffff 0,#f3eeff 50%,#e2d8fb 100%)', fg: '#1f1150', sub: '#3a2487', accent: '#5b3fa6', grid: 'rgba(58,36,135,.07)' },
};

function html({ title, tag, subtitle, footer = 'AI Empowered Club', theme = 'dark' }) {
  const t = THEMES[theme];
  if (!t) throw new Error(`Unknown theme "${theme}". Use dark or light.`);
  // Long titles step down so they stay inside the square.
  const len = title.replace(/\*/g, '').length;
  const size = len > 60 ? 76 : len > 36 ? 92 : 112;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}
body{width:1080px;height:1080px;display:flex;align-items:center;justify-content:center;background:${t.bg};font-family:Helvetica,Arial,sans-serif;color:${t.fg};overflow:hidden;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(${t.grid} 1px,transparent 1px),linear-gradient(90deg,${t.grid} 1px,transparent 1px);background-size:60px 60px}
.card{position:relative;text-align:center;padding:0 90px}
.tag{display:inline-block;font-size:30px;letter-spacing:6px;text-transform:uppercase;color:${t.accent};border:2px solid ${t.accent};border-radius:40px;padding:12px 34px;margin-bottom:56px}
h1{font-size:${size}px;line-height:1.04;margin:0 0 40px;font-weight:800}
.hl{color:${t.accent}}
p{font-size:40px;line-height:1.35;color:${t.sub};margin:0}
.foot{position:absolute;bottom:70px;left:0;right:0;text-align:center;font-size:34px;font-weight:700;letter-spacing:2px}
.dot{display:inline-block;width:18px;height:18px;border-radius:50%;background:${t.accent};margin-right:14px;vertical-align:middle}
</style></head><body><div class="grid"></div><div class="card">
${tag ? `<div class="tag">${escape(tag)}</div>` : ''}
<h1>${rich(title)}</h1>
${subtitle ? `<p>${rich(subtitle)}</p>` : ''}
</div>${footer ? `<div class="foot"><span class="dot"></span>${escape(footer)}</div>` : ''}</body></html>`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.title || !opts.out) {
    console.error('Usage: node make-graphic.js --title "Text with *accent*" [--tag TEXT] [--subtitle TEXT] [--footer TEXT] [--theme dark|light] --out FILE.png');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  const out = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    await page.setContent(html(opts));
    await page.screenshot({ path: out });
  } finally {
    await browser.close();
  }
  console.log(`Saved ${out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { html };
