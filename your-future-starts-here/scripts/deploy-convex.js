#!/usr/bin/env node
'use strict';

// Vercel build step: push the Convex functions when Convex is enabled.
// Never fails the build — the app must stay deployable even if Convex is down.

const { spawnSync } = require('child_process');

if (!process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_ENABLED !== '1') {
  console.log('[convex] not enabled (set CONVEX_ENABLED=1 with CONVEX_DEPLOY_KEY); skipping.');
  process.exit(0);
}

console.log('[convex] deploying functions…');
const result = spawnSync('npx', ['convex', 'deploy', '--yes'], { stdio: 'inherit', env: process.env });
if (result.status !== 0) console.log('[convex] deploy failed (see above); continuing so the site still builds.');
process.exit(0);
