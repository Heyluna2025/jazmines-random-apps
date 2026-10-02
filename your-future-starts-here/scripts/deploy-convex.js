#!/usr/bin/env node
'use strict';

// Vercel build step: push the Convex functions when a deploy key is present
// (the Convex integration sets CONVEX_DEPLOY_KEY). Without one there is
// nothing to build — pages are static and the API is a plain function.

const { spawnSync } = require('child_process');

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log('[convex] CONVEX_DEPLOY_KEY not set; skipping Convex deploy (Upstash or memory store will be used).');
  process.exit(0);
}

console.log('[convex] deploying functions…');
const result = spawnSync('npx', ['convex', 'deploy', '--yes'], { stdio: 'inherit', env: process.env });
process.exit(result.status === null ? 1 : result.status);
