#!/usr/bin/env node
'use strict';

// Renders a carousel (one PNG per slide, 1080x1350, the 4:5 portrait size
// Facebook and Instagram both show in full) from a JSON spec, in the shared
// AI Builder's Camp / AI Empowered Club style.
//
//   node make-carousel.js content/week1/abc-intro.json --out graphics/2026-11-10-abc-intro [--sheet]
//
// Writes <out>-01.png, <out>-02.png, ... and with --sheet a <out>-sheet.png
// overview for review. Spec: { "slides": [ { "layout": "...", ... } ] } with
// layouts hero (sports-poster coach cover) and roster (team grid), which
// draw their own background, plus cover, statement ("logo": true adds the ABC logo), spotlight (a
// person: photo, tag, name, role, tagline), quote (text, by), bullets, steps, hub, people, qa and cta (see the
// render functions below). In any text, *word* gets the accent colour and
// [[note]] renders a dashed "to confirm" box, so drafts can't be mistaken for
// approved copy. Add "theme": "light" to a slide for the light version, and
// "brand": "aec" at the top of the spec for an AI Empowered Club post (AEC
// logo and violet backgrounds instead of the ABC logo). Logos live in brand/.

const fs = require('fs');
const path = require('path');

const BRAND = {
  night: '#0B0518',
  plum: '#1A0B2E',
  deep: '#221338',
  violet: '#7055FA', // AI Empowered Club brand colour
  purple: '#7034AB',
  lavender: '#C7BEDA',
  mist: '#F6F3FF',
  gold: '#EFA831', // accent from the ABC deck
};

const asset = (file) => `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'brand', file)).toString('base64')}`;
const logoUri = asset('abc-logo-white.png');
const aecLogoUri = asset('aec-logo-white.png');
const aecMarkUri = asset('aec-mark-white.png');

// Simple 24px line icons.
const ICONS = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  megaphone: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.5A5 5 0 0 1 21.5 19"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  rocket: '<path d="M12 15c-2-2-3-5-1-9 1.5-2.5 4-3 7-3 0 3-.5 5.5-3 7-4 2-7 1-9-1z"/><path d="M9 15l-3 3M7 12l-3 1 2-3 3-1M12 17l-1 3 3-2 1-3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};
const icon = (name, size = 44) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg>`;

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rich = (s = '') =>
  escape(s)
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="tbc">$1</span>')
    .replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>')
    .replace(/\n/g, '<br>');

// ---- layouts ----

function cover(s) {
  return `<div class="cover">
    ${s.brand === 'aec'
      ? `<img class="aeclogo" src="${aecLogoUri}" alt="AI Empowered Club">`
      : `<img class="biglogo" src="${logoUri}" alt="AI Builder's Camp">`}
    ${s.tag ? `<div class="tag">${rich(s.tag)}</div>` : ''}
    <h1 class="xl">${rich(s.title)}</h1>
    ${s.subtitle ? `<p class="lead">${rich(s.subtitle)}</p>` : ''}
  </div>`;
}

function statement(s) {
  return `<div class="block">
    ${s.logo ? `<img class="inlogo" src="${logoUri}" alt="AI Builder's Camp">` : ''}
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <h1>${rich(s.title)}</h1>
    ${s.body ? `<p class="body">${rich(s.body)}</p>` : ''}
    ${s.footnote ? `<p class="note">${rich(s.footnote)}</p>` : ''}
  </div>`;
}

function bullets(s) {
  return `<div class="block">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <h1>${rich(s.title)}</h1>
    <ul class="list">${s.items.map((t) => `<li><span class="dot">${icon(s.icon || 'check', 34)}</span><span>${rich(t)}</span></li>`).join('')}</ul>
  </div>`;
}

function steps(s) {
  return `<div class="block">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <h1>${rich(s.title)}</h1>
    <ol class="steps">${s.steps.map((st, i) => `<li>
      <div class="num">${icon(st.icon, 46)}<b>${String(i + 1).padStart(2, '0')}</b></div>
      <div><h3>${rich(st.title)}</h3><p>${rich(st.text || '')}</p></div>
    </li>`).join('')}</ol>
  </div>`;
}

// Icon nodes on a ring around a centre label, like the reference graphics.
function hub(s) {
  const n = s.nodes.length;
  const R = 300;
  const nodes = s.nodes.map((node, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = 540 + R * Math.cos(a);
    const y = 420 + R * Math.sin(a);
    return `<div class="node" style="left:${x}px;top:${y}px">
      <div class="bubble">${icon(node.icon, 50)}</div>
      <div class="nlabel">${rich(node.label)}</div>
      ${node.sub ? `<div class="nsub">${rich(node.sub)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="hubwrap">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <h1>${rich(s.title)}</h1>
    <div class="hub">
      <svg class="ring" width="1080" height="840"><circle cx="540" cy="420" r="${R}" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 14" stroke-linecap="round"/></svg>
      <div class="center">${rich(s.center)}</div>
      ${nodes}
    </div>
    ${s.footnote ? `<p class="note center-note">${rich(s.footnote)}</p>` : ''}
  </div>`;
}

// Photos are paths relative to this folder (e.g. brand/people/coach-jazmine.jpg)
// or URLs; local files are embedded so the page needs no file access.
function photoSrc(photo) {
  if (/^(https?:|data:)/.test(photo)) return photo;
  const file = path.resolve(__dirname, photo);
  const type = /\.png$/i.test(file) ? 'png' : 'jpeg';
  return `data:image/${type};base64,${fs.readFileSync(file).toString('base64')}`;
}

function people(s) {
  return `<div class="block">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <h1>${rich(s.title)}</h1>
    <div class="people n${s.people.length}">${s.people.map((p) => `<div class="person">
      <div class="photo">${p.photo ? `<img src="${photoSrc(p.photo)}">` : `<span class="initial">${escape(p.name.replace(/^Coach\s+/i, '').charAt(0))}</span>`}</div>
      <div><h3>${rich(p.name)}</h3><div class="role">${rich(p.role || '')}</div><p>${rich(p.detail || '')}</p></div>
    </div>`).join('')}</div>
  </div>`;
}

function qa(s) {
  return `<div class="block">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <div class="q">${icon('help', 64)}<h1>${rich(s.q)}</h1></div>
    <div class="a">${rich(s.a)}</div>
  </div>`;
}

function cta(s) {
  return `<div class="block ctab">
    ${s.values ? `<div class="values">${s.values.map((v) => `<span>${rich(v)}</span>`).join('')}</div>` : ''}
    <h1 class="xl">${rich(s.title)}</h1>
    ${s.body ? `<p class="body">${rich(s.body)}</p>` : ''}
    ${s.button ? `<div class="button">${rich(s.button)}</div>` : ''}
  </div>`;
}

// A person-led cover: large photo, tag, name and role.
function spotlight(s) {
  const initial = escape(String(s.name || '?').replace(/^Coach\s+/i, '').charAt(0));
  return `<div class="spot">
    <div class="spotphoto">${s.photo ? `<img src="${photoSrc(s.photo)}">` : `<span class="initial big">${initial}</span>`}</div>
    ${s.tag ? `<div class="tag">${rich(s.tag)}</div>` : ''}
    <h1 class="xl">${rich(s.name)}</h1>
    ${s.role ? `<div class="spotrole">${rich(s.role)}</div>` : ''}
    ${s.tagline ? `<p class="lead">${rich(s.tagline)}</p>` : ''}
  </div>`;
}

function quote(s) {
  return `<div class="block">
    ${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
    <div class="qmark">“</div>
    <h1 class="quote">${rich(s.text)}</h1>
    ${s.by ? `<p class="by">${rich(s.by)}</p>` : ''}
  </div>`;
}

const LAYOUTS = { cover, statement, bullets, steps, hub, people, qa, cta, spotlight, quote };

// ---- full-bleed poster layouts (their own background and chrome) ----

const font = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, 'brand', 'fonts', file)).toString('base64')}`;
let fontCss;
const posterFonts = () => (fontCss ||= `
@font-face{font-family:'Anton';src:url(${font('anton-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:'Archivo Black';src:url(${font('archivo-black-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:'Caveat';font-weight:700;src:url(${font('caveat-latin-700-normal.woff2')}) format('woff2')}`);

const pager = (index, total, color) => `<div class="pfoot" style="color:${color}"><span><b>${String(index + 1).padStart(2, '0')}</b> / ${String(total).padStart(2, '0')}</span>${index === total - 1 ? '' : '<span>Swipe →</span>'}</div>`;
const firstName = (name) => String(name).replace(/^Coach\s+/i, '');

// Sports-poster cover for one coach: giant name behind a cut-out photo (a
// transparent PNG in "cutout"), a duotone tile of their regular photo, the
// title in a block and a signature. Fields: name, role, cutout, photo, tag.
function hero(s, index, total) {
  const first = firstName(s.name).toUpperCase();
  const words = String(s.role || '').toUpperCase().split(' ');
  const half = Math.ceil(words.length / 2);
  return `<style>
body{background:linear-gradient(165deg,#6A4DF5 0%,#4B2FD6 45%,#2A1690 100%)}
.lines{position:absolute;inset:0;background:repeating-linear-gradient(115deg,transparent 0 140px,rgba(255,255,255,.06) 140px 142px);}
.grain{position:absolute;inset:0;opacity:.18;background-image:radial-gradient(rgba(255,255,255,.5) .6px,transparent .8px);background-size:5px 5px}
.ptop{position:absolute;top:50px;left:60px;display:flex;align-items:center;gap:18px;z-index:9}
.ptop .mark{height:40px;width:80px;background:#fff;-webkit-mask:url(${logoUri}) center/contain no-repeat}
.ptop .amark{height:34px;width:42px;background:#fff;-webkit-mask:url(${aecMarkUri}) center/contain no-repeat}
.ptop .sep{width:2px;height:30px;background:rgba(255,255,255,.5)}
.ptop .org{font-family:'Inter Display';font-weight:700;font-size:22px;letter-spacing:4px;color:#fff}
.tile{position:absolute;left:96px;top:150px;width:300px;height:330px;overflow:hidden;z-index:1}
.tile img{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.15) brightness(1.05)}
.tile::after{content:'';position:absolute;inset:0;background:#3B23B5;mix-blend-mode:multiply}
.tile::before{content:'';position:absolute;inset:0;background:${BRAND.gold};mix-blend-mode:screen;opacity:.18;z-index:1}
.label{position:absolute;right:60px;top:190px;z-index:6;display:flex;align-items:center;gap:18px;color:${BRAND.gold};font-family:'Archivo Black';font-size:34px;line-height:.95;text-align:right;text-transform:uppercase}
.label svg{flex:none}
.big{position:absolute;left:0;right:0;top:${s.nameTop || 330}px;z-index:2;text-align:center;font-family:'Anton';color:#F6F3FF;line-height:.9;white-space:nowrap;letter-spacing:4px;text-shadow:0 10px 40px rgba(20,8,60,.35)}
.person{position:absolute;left:50%;bottom:0;transform:translateX(-50%);height:${s.height || 930}px;max-width:980px;z-index:4;filter:drop-shadow(0 30px 40px rgba(15,5,50,.55))}
.person.wide{height:auto;width:900px}
.panel{position:absolute;right:40px;bottom:96px;z-index:5;width:520px;padding:30px 34px 26px;background:#4B2FD6;box-shadow:0 20px 50px rgba(15,5,50,.45)}
.panel h2{margin:0;font-family:'Archivo Black';font-weight:400;font-size:52px;line-height:.98;color:#fff;letter-spacing:-.5px}
.sig{display:flex;align-items:flex-end;gap:12px;margin-top:22px;border-bottom:2px solid rgba(255,255,255,.8);padding-bottom:4px}
.sig i{font-style:normal;color:#fff;font-size:26px;font-weight:700}
.sig b{font-family:'Caveat';font-weight:700;font-size:70px;line-height:.8;color:${BRAND.gold};transform:rotate(-4deg);transform-origin:left bottom}
.sigl{font-family:'Inter Display';font-weight:700;font-size:20px;letter-spacing:3px;color:#fff;margin-top:8px}
.pfoot{position:absolute;bottom:34px;left:60px;right:60px;z-index:8;display:flex;justify-content:space-between;font-size:24px;font-weight:600;letter-spacing:1px;text-shadow:0 2px 10px rgba(0,0,0,.4)}
</style>
<div class="lines"></div><div class="grain"></div>
<div class="ptop"><div class="mark"></div><div class="sep"></div><div class="amark"></div><div class="org">AI EMPOWERED CLUB</div></div>
${s.photo ? `<div class="tile"><img src="${photoSrc(s.photo)}"></div>` : ''}
<div class="label"><span>${escape(s.tag || 'Coach Spotlight').replace(/ /, '<br>')}</span><svg width="60" height="24" viewBox="0 0 60 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M58 12H4M14 2 4 12l10 10"/></svg></div>
<div class="big"><span id="big">${escape(first)}</span></div>
<img class="person" id="person" src="${photoSrc(s.cutout)}">
<div class="panel"><h2>${escape(words.slice(0, half).join(' '))}<br>${escape(words.slice(half).join(' '))}</h2>
<div class="sig"><i>x</i><b>${escape(s.name)}</b></div><div class="sigl">AI BUILDER'S CAMP COACH</div></div>
${pager(index, total, '#fff')}
<script>
window.fitPoster=()=>{const big=document.getElementById('big');if(!big)return;let fs=500;big.style.fontSize=fs+'px';
while(big.offsetWidth>1000&&fs>160){fs-=4;big.style.fontSize=fs+'px'}
if(big.offsetWidth<980)big.style.letterSpacing=Math.min(36,(1000-big.offsetWidth)/big.textContent.length)+'px';
const p=document.getElementById('person');if(p.naturalWidth/p.naturalHeight*${s.height || 930}>980)p.classList.add('wide')};

</script>`;
}

// Team roster: torn-paper header and a grid of cut-out photos with name bars.
// Fields: kicker, title, people: [{ name, cutout, badge }]; people with a
// badge (e.g. "Founder") go in a larger first row.
function roster(s, index, total) {
  const leads = s.people.filter((p) => p.badge);
  const rest = s.people.filter((p) => !p.badge);
  const tile = (p, big) => `<div class="rt${big ? ' big' : ''}"><div class="rph"><img src="${photoSrc(p.cutout)}"${p.zoom ? ` style="height:${p.zoom}%"` : ''}></div>
    <div class="bar">${escape(firstName(p.name).toUpperCase())}${p.badge ? `<small>${escape(p.badge)}</small>` : ''}</div></div>`;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const edge = (base, amp) => Array.from({ length: 136 }, (_, i) => `${Math.min(1080, i * 8 + rnd() * 6).toFixed(1)},${(base + (rnd() - 0.5) * amp + Math.sin(i / 6) * 4).toFixed(1)}`).join(' ');
  const torn = edge(16, 16);
  const fibre = edge(22, 14);
  return `<style>
body{background:#2A1690}
.fabric{position:absolute;inset:0;background:
  radial-gradient(ellipse at 50% 60%,transparent 30%,rgba(10,3,30,.55) 100%),
  repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 2px,transparent 2px 5px),
  repeating-linear-gradient(-45deg,rgba(0,0,0,.08) 0 2px,transparent 2px 5px),
  linear-gradient(170deg,#4B2FD6 0%,#2E1A9E 55%,#1A0B5E 100%)}
.paper{position:absolute;left:0;right:0;top:0;height:372px;background:
  radial-gradient(rgba(60,40,120,.10) .7px,transparent .9px) 0 0/4px 4px,
  linear-gradient(180deg,#F6F3FF,#E4DDF5)}
.tear{position:absolute;left:0;top:360px;z-index:2;filter:drop-shadow(0 8px 10px rgba(10,3,40,.45))}
.rhead{position:absolute;top:44px;left:60px;right:60px;z-index:3;text-align:center}
.rk{font-family:'Inter Display';font-weight:700;font-size:26px;letter-spacing:10px;color:#2A1690;margin-bottom:10px}
.rh{font-family:'Archivo Black';font-size:128px;line-height:.9;color:#3B23B5;letter-spacing:-2px;text-transform:uppercase}
.rh em{font-style:normal;color:${BRAND.gold};-webkit-text-stroke:0}
.rlogos{display:flex;justify-content:center;align-items:center;gap:20px;margin-top:20px}
.rlogos .mark{height:34px;width:70px;background:#2A1690;-webkit-mask:url(${logoUri}) center/contain no-repeat}
.rlogos .amark{height:30px;width:37px;background:#2A1690;-webkit-mask:url(${aecMarkUri}) center/contain no-repeat}
.rlogos .sep{width:2px;height:28px;background:rgba(42,22,144,.4)}
.rlogos .org{font-family:'Inter Display';font-weight:700;font-size:20px;letter-spacing:4px;color:#2A1690}
.grid{position:absolute;left:56px;right:56px;top:420px;z-index:3;display:flex;flex-direction:column;gap:18px}
.row{display:flex;gap:18px;justify-content:center}
.rt{width:228px;display:flex;flex-direction:column;box-shadow:0 14px 30px rgba(8,2,30,.5)}
.rt.big{width:360px}
.rph{position:relative;height:200px;overflow:hidden;background:
  radial-gradient(circle at 50% 35%,rgba(140,110,255,.55) 0,transparent 60%),
  radial-gradient(rgba(0,0,0,.35) 1px,transparent 1.3px) 0 0/6px 6px,#1A0B2E}
.rt.big .rph{height:236px}
.rph img{position:absolute;left:50%;bottom:0;transform:translateX(-50%);height:96%;max-width:none;filter:contrast(1.06) saturate(.92)}
.bar{background:#7055FA;color:#fff;font-family:'Archivo Black';font-size:30px;text-align:center;padding:9px 6px 8px;letter-spacing:.5px;line-height:1}
.rt.big .bar{background:${BRAND.gold};color:#1A0B2E;font-size:36px}
.bar small{display:block;font-family:'Inter Display';font-weight:800;font-size:18px;letter-spacing:5px;margin-top:6px;text-transform:uppercase}
.pfoot{position:absolute;bottom:26px;left:60px;right:60px;z-index:8;display:flex;justify-content:space-between;font-size:24px;font-weight:600;letter-spacing:1px}
</style>
<div class="fabric"></div><div class="paper"></div>
<svg class="tear" width="1080" height="46" viewBox="0 0 1080 46" preserveAspectRatio="none"><polygon fill="#FFFFFF" points="0,0 1080,0 1080,22 ${fibre} 0,24"/><polygon fill="#E4DDF5" points="0,0 1080,0 1080,16 ${torn} 0,16"/></svg>
<div class="rhead"><div class="rk">${escape(s.kicker || "AI BUILDER'S CAMP")}</div><div class="rh">${rich(s.title).replace(/class="hl"/g, '')}</div>
<div class="rlogos"><div class="mark"></div><div class="sep"></div><div class="amark"></div><div class="org">AI EMPOWERED CLUB</div></div></div>
<div class="grid">
${leads.length ? `<div class="row">${leads.map((p) => tile(p, true)).join('')}</div>` : ''}
${Array.from({ length: Math.ceil(rest.length / 4) }, (_, r) => `<div class="row">${rest.slice(r * 4, r * 4 + 4).map((p) => tile(p)).join('')}</div>`).join('')}
</div>
${pager(index, total, '#C7BEDA')}`;
}

const POSTERS = { hero, roster };

function page(slide, index, total, brand = 'abc') {
  slide = { ...slide, brand };
  if (POSTERS[slide.layout]) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${posterFonts()}
*{box-sizing:border-box}html,body{margin:0}
body{width:1080px;height:1350px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;color:#fff}
.pfoot b{color:#fff}</style></head><body>${POSTERS[slide.layout](slide, index, total)}</body></html>`;
  }
  const aec = brand === 'aec';
  const render = LAYOUTS[slide.layout];
  if (!render) throw new Error(`Slide ${index + 1}: unknown layout "${slide.layout}". Use ${[...Object.keys(LAYOUTS), ...Object.keys(POSTERS)].join(', ')}.`);
  const light = slide.theme === 'light';
  const c = light
    ? { bg: BRAND.mist, fg: BRAND.plum, sub: '#4a3b66', accent: BRAND.violet, soft: 'rgba(112,85,250,.10)', line: 'rgba(112,85,250,.35)', glow: 'rgba(112,85,250,.18)' }
    : { bg: BRAND.night, fg: '#FFFFFF', sub: BRAND.lavender, accent: BRAND.gold, soft: 'rgba(199,190,218,.08)', line: 'rgba(199,190,218,.35)', glow: 'rgba(112,85,250,.55)' };
  const last = index === total - 1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0}
body{width:1080px;height:1350px;overflow:hidden;position:relative;background:${c.bg};color:${c.fg};font-family:'Inter',sans-serif}
.bg{position:absolute;inset:0;background:
  radial-gradient(circle at 85% 8%,${c.glow} 0,transparent 42%),
  radial-gradient(circle at 5% 95%,${light ? 'rgba(239,168,49,.12)' : 'rgba(112,52,171,.45)'} 0,transparent 45%)${light ? '' : aec ? `,linear-gradient(160deg,#3B23B5 0%,#1E1260 45%,${BRAND.night} 100%)` : `,linear-gradient(160deg,${BRAND.plum} 0%,${BRAND.night} 60%)`}}
.dots{position:absolute;inset:0;background-image:radial-gradient(${c.line} 1.2px,transparent 1.4px);background-size:36px 36px;opacity:.35;-webkit-mask-image:linear-gradient(180deg,#000 0,transparent 30%,transparent 75%,#000 100%)}
.top{position:absolute;top:56px;left:72px;right:72px;display:flex;align-items:center;gap:22px}
.mark{height:46px;width:92px;background:${c.fg};-webkit-mask:url(${logoUri}) center/contain no-repeat}
.sep{width:2px;height:34px;background:${c.line}}
.org{font-family:'Inter Display';font-weight:700;font-size:24px;letter-spacing:4px;text-transform:uppercase;color:${c.sub}}
.main{position:absolute;top:150px;left:72px;right:72px;bottom:150px;display:flex;flex-direction:column;justify-content:center}
.foot{position:absolute;bottom:56px;left:72px;right:72px;display:flex;justify-content:space-between;align-items:center;font-size:27px;color:${c.sub};letter-spacing:1px}
.foot b{color:${c.fg};font-weight:700}
.swipe{display:flex;align-items:center;gap:12px;font-weight:600;color:${c.accent}}
h1{font-family:'Inter Display';font-weight:800;font-size:76px;line-height:1.04;letter-spacing:-1.5px;margin:0 0 34px}
h1.xl{font-size:100px;letter-spacing:-2.5px}
h3{font-family:'Inter Display';font-weight:700;font-size:38px;margin:0 0 6px}
.hl{color:${c.accent}}
.kicker{display:inline-block;align-self:flex-start;font-family:'Inter Display';font-weight:700;font-size:24px;letter-spacing:5px;text-transform:uppercase;color:${c.accent};margin-bottom:26px}
.tag{display:inline-block;align-self:center;font-family:'Inter Display';font-weight:700;font-size:26px;letter-spacing:6px;text-transform:uppercase;color:${c.accent};border:2px solid ${c.accent};border-radius:40px;padding:12px 32px;margin-bottom:44px}
.lead{font-size:38px;line-height:1.35;color:${c.sub};margin:0}
.body{font-size:40px;line-height:1.42;color:${c.sub};margin:0}
.note{font-size:26px;color:${c.sub};margin:34px 0 0;opacity:.85}
.cover{text-align:center;display:flex;flex-direction:column;align-items:center;max-width:820px;margin:0 auto}
.aeclogo{width:400px;margin-bottom:56px;filter:drop-shadow(0 0 40px rgba(112,85,250,.7))${light ? ' brightness(0.15)' : ''}}
.amark{height:40px;width:49px;background:${c.fg};-webkit-mask:url(${aecMarkUri}) center/contain no-repeat}
.org.strong{color:${c.fg};font-weight:800}
.inlogo{display:block;width:320px;margin-bottom:44px;align-self:flex-start;filter:drop-shadow(0 0 30px rgba(112,85,250,.6))}
.biglogo{width:520px;margin-bottom:60px;filter:drop-shadow(0 0 40px rgba(112,85,250,.6))${light ? ' brightness(0.15)' : ''}}
.list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:30px}
.list li{display:flex;gap:26px;align-items:flex-start;font-size:38px;line-height:1.32}
.dot{flex:none;width:62px;height:62px;border-radius:50%;background:${c.soft};border:2px solid ${c.line};display:flex;align-items:center;justify-content:center;color:${c.accent};margin-top:-4px}
.steps{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:30px}
.steps li{display:flex;gap:30px;align-items:center;background:${c.soft};border:1.5px solid ${c.line};border-radius:28px;padding:30px 34px}
.steps p{margin:0;font-size:32px;line-height:1.35;color:${c.sub}}
.num{flex:none;width:118px;height:118px;border-radius:50%;background:${light ? BRAND.violet : 'linear-gradient(140deg,' + BRAND.violet + ',' + BRAND.purple + ')'};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.num b{font-family:'Inter Display';font-size:20px;letter-spacing:2px;opacity:.9}
.hubwrap{position:absolute;inset:0;display:flex;flex-direction:column}
.hubwrap .kicker{margin-left:72px;margin-top:160px}
.hubwrap h1{margin:0 72px;font-size:66px}
.hub{position:relative;height:840px;margin-top:40px;color:${c.line}}
.ring{position:absolute;left:0;top:0}
.center{position:absolute;left:540px;top:420px;transform:translate(-50%,-50%);width:250px;height:250px;border-radius:50%;background:${light ? '#fff' : BRAND.deep};border:3px solid ${BRAND.violet};box-shadow:0 0 70px ${c.glow};display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:'Inter Display';font-weight:800;font-size:36px;line-height:1.1;color:${c.fg}}
.node{position:absolute;transform:translate(-50%,-50%);width:270px;display:flex;flex-direction:column;align-items:center;text-align:center}
.bubble{width:112px;height:112px;border-radius:50%;background:${light ? '#fff' : BRAND.plum};border:3px solid ${c.accent};display:flex;align-items:center;justify-content:center;color:${c.accent};margin-bottom:12px}
.nlabel{font-family:'Inter Display';font-weight:800;font-size:32px;color:${c.fg};line-height:1.1}
.nsub{font-size:28px;color:${c.sub};margin-top:4px}
.center-note{position:absolute;bottom:150px;left:72px;right:72px;text-align:center}
.people{display:flex;flex-direction:column;gap:30px}
.person{display:flex;gap:34px;align-items:center;background:${c.soft};border:1.5px solid ${c.line};border-radius:32px;padding:30px}
.photo{flex:none;width:210px;height:210px;border-radius:50%;border:4px solid ${c.accent};overflow:hidden;display:flex;align-items:center;justify-content:center;background:${light ? '#fff' : BRAND.deep};color:${c.sub};font-size:24px;letter-spacing:2px;text-transform:uppercase}
.initial{font-family:'Inter Display';font-weight:900;font-size:96px;letter-spacing:0;color:${c.accent}}
.photo img{width:100%;height:100%;object-fit:cover}
.people.n1 .photo{width:300px;height:300px}
.role{font-family:'Inter Display';font-weight:700;font-size:24px;letter-spacing:3px;text-transform:uppercase;color:${c.accent};margin-bottom:12px}
.person p{margin:0;font-size:30px;line-height:1.35;color:${c.sub}}
.q{display:flex;gap:28px;align-items:flex-start;color:${c.accent}}
.q h1{color:${c.fg};font-size:68px}
.a{font-size:40px;line-height:1.45;color:${c.fg};background:${c.soft};border-left:8px solid ${c.accent};border-radius:0 28px 28px 0;padding:40px 44px}
.ctab{text-align:center;align-items:center}
.values{display:flex;gap:18px;justify-content:center;margin-bottom:56px}
.values span{font-family:'Inter Display';font-weight:700;font-size:26px;letter-spacing:2px;text-transform:uppercase;padding:14px 26px;border-radius:40px;border:2px solid ${c.line};color:${c.sub}}
.button{display:inline-block;margin-top:48px;font-family:'Inter Display';font-weight:800;font-size:40px;padding:30px 58px;border-radius:70px;background:${BRAND.violet};color:#fff;box-shadow:0 18px 50px rgba(112,85,250,.45)}
.spot{text-align:center;display:flex;flex-direction:column;align-items:center;max-width:860px;margin:0 auto}
.spotphoto{width:560px;height:560px;border-radius:50%;overflow:hidden;border:6px solid ${c.accent};box-shadow:0 0 90px ${c.glow};margin-bottom:44px;display:flex;align-items:center;justify-content:center;background:${light ? '#fff' : BRAND.deep}}
.spotphoto img{width:100%;height:100%;object-fit:cover}
.initial.big{font-size:240px}
.spot .tag{margin-bottom:28px}
.spot h1.xl{margin-bottom:16px}
.spotrole{font-family:'Inter Display';font-weight:700;font-size:32px;letter-spacing:4px;text-transform:uppercase;color:${c.accent};margin-bottom:24px}
.qmark{font-family:'Inter Display';font-weight:900;font-size:220px;line-height:.7;color:${c.accent};margin-bottom:10px}
h1.quote{font-size:64px;line-height:1.18;font-weight:700;letter-spacing:-1px}
.by{font-family:'Inter Display';font-weight:700;font-size:30px;letter-spacing:3px;text-transform:uppercase;color:${c.sub};margin:20px 0 0}
.tbc{display:inline;outline:3px dashed ${BRAND.gold};outline-offset:4px;background:rgba(239,168,49,.16);color:${c.fg};border-radius:6px;padding:0 6px}
.tbc::before{content:'TO CONFIRM: ';font-size:.6em;font-weight:800;letter-spacing:2px;color:${BRAND.gold}}
</style></head><body>
<div class="bg"></div><div class="dots"></div>
<div class="top">${aec
  ? `<div class="amark"></div><div class="org strong">AI Empowered Club</div>`
  : `<div class="mark"></div><div class="sep"></div><div class="amark"></div><div class="org">AI Empowered Club</div>`}</div>
${slide.layout === 'hub' ? render(slide) : `<div class="main">${render(slide)}</div>`}
<div class="foot"><span><b>${String(index + 1).padStart(2, '0')}</b> / ${String(total).padStart(2, '0')}</span>
${last ? `<span>${aec ? 'AI Empowered Club · #YourAIBestie' : "AI Builder's Camp · a program under AI Empowered Club"}</span>` : `<span class="swipe">Swipe →</span>`}</div>
</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const specFile = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  if (!specFile || outIdx < 0) {
    console.error('Usage: node make-carousel.js SPEC.json --out graphics/NAME [--sheet]');
    process.exit(1);
  }
  const out = path.resolve(args[outIdx + 1]);
  const { slides, brand = 'abc' } = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const files = [];
  try {
    const pg = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    for (let i = 0; i < slides.length; i++) {
      await pg.setContent(page(slides[i], i, slides.length, brand), { waitUntil: 'load' });
      await pg.evaluate(() => document.fonts.ready);
      await pg.evaluate(() => { if (window.fitPoster) window.fitPoster(); window.fitPoster = null; }); // poster layouts size their big name
      const file = `${out}-${String(i + 1).padStart(2, '0')}.png`;
      await pg.screenshot({ path: file });
      files.push(file);
      console.log(`Saved ${file}`);
    }
    if (args.includes('--sheet')) {
      const imgs = files.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('');
      const cols = Math.min(files.length, 4);
      const sheet = await browser.newPage({ viewport: { width: cols * 360 + (cols + 1) * 20, height: 600 } });
      await sheet.setContent(`<body style="margin:0;padding:20px;background:#ddd;display:grid;grid-template-columns:repeat(${cols},360px);gap:20px">${imgs.replace(/<img /g, '<img style="width:360px;height:450px;border-radius:8px" ')}</body>`);
      await sheet.screenshot({ path: `${out}-sheet.png`, fullPage: true });
      console.log(`Saved ${out}-sheet.png`);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { page, BRAND };
