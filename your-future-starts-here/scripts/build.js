#!/usr/bin/env node
'use strict';

// Vercel build step.
// 1. Stamp the build id into every page's script and style links
//    (?v=__BUILD__ → ?v=<commit>), so a phone can never run a stale copy.
// 2. Push the Convex functions when Convex is enabled. Never fails the build:
//    the app must stay deployable even if Convex is down.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const build = (process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 7);
const publicDir = path.join(__dirname, '..', 'public');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

let stamped = 0;
for (const file of htmlFiles(publicDir)) {
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('__BUILD__')) continue;
  fs.writeFileSync(file, html.replace(/__BUILD__/g, build));
  stamped++;
}
console.log(`[build] stamped build ${build} into ${stamped} page(s)`);

if (!process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_ENABLED !== '1') {
  console.log('[convex] not enabled (set CONVEX_ENABLED=1 with CONVEX_DEPLOY_KEY); skipping.');
  process.exit(0);
}

console.log('[convex] deploying functions…');
const result = spawnSync('npx', ['convex', 'deploy', '--yes'], { stdio: 'inherit', env: process.env });
if (result.status !== 0) console.log('[convex] deploy failed (see above); continuing so the site still builds.');
process.exit(0);
