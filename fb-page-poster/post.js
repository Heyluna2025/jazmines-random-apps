#!/usr/bin/env node
'use strict';

// Posts to a Facebook Page from the command line.
//
//   node post.js check
//   node post.js "Hello from AI Empowered Club" [--link URL] [--image FILE|URL] [--at 2026-11-03T10:00-05:00] [--dry-run]
//   node post.js queue posts.json [--dry-run]
//   node post.js show POST_ID
//   node post.js delete POST_ID
//
// --at hands the post to Facebook's own scheduler, so nothing needs to stay
// running. `queue` sends every entry in a JSON file that hasn't gone out yet
// and writes the Facebook post id back into the file, so re-running it is safe.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('./lib/facebook');

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at
// startup, so behind a proxy (e.g. a Claude cloud environment) restart once
// with it on.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const child = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(child.status ?? 1);
}

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (['--link', '--image', '--at'].includes(a)) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

function describe(post) {
  const bits = [];
  if (post.text) bits.push(JSON.stringify(post.text.length > 60 ? post.text.slice(0, 57) + '...' : post.text));
  if (post.link) bits.push(`link ${post.link}`);
  if (post.image) bits.push(`image ${post.image}`);
  bits.push(post.at ? `scheduled for ${post.at}` : 'now');
  return bits.join(', ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [command, ...rest] = opts._;
  if (!command) {
    console.error('Usage:\n  node post.js check\n  node post.js "text" [--link URL] [--image FILE|URL] [--at ISO-TIME] [--dry-run]\n  node post.js queue posts.json [--dry-run]\n  node post.js show POST_ID\n  node post.js delete POST_ID');
    process.exit(1);
  }

  const fb = createClient({
    pageId: process.env.FB_PAGE_ID,
    token: process.env.FB_PAGE_ACCESS_TOKEN,
    version: process.env.FB_GRAPH_VERSION || undefined,
  });

  if (command === 'check') {
    const me = await fb.whoAmI();
    if (!me.matchesPage) {
      throw new Error(`The token belongs to "${me.name}" (${me.id}), not Page ${process.env.FB_PAGE_ID}. Use the Page token from me/accounts, not your user token.`);
    }
    console.log(`OK: token posts as "${me.name}" (${me.id}).`);
    return;
  }

  if (command === 'show' || command === 'delete') {
    const postId = rest[0];
    if (!postId) throw new Error(`Usage: node post.js ${command} POST_ID`);
    if (command === 'delete') {
      await fb.remove(postId);
      console.log(`Deleted: ${postId}`);
      return;
    }
    const p = await fb.show(postId);
    const state = p.is_published
      ? `published ${p.created_time}`
      : `scheduled for ${new Date(p.scheduled_publish_time * 1000).toISOString()}`;
    console.log(`${p.id}: ${state}\n${p.permalink_url || ''}\n${p.message || ''}`.trim());
    return;
  }

  if (command === 'queue') {
    const file = path.resolve(rest[0] || 'posts.json');
    const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    let sent = 0;
    for (const post of posts) {
      if (post.facebook_id) continue;
      if (opts.dryRun) { console.log(`would send: ${describe(post)}`); continue; }
      // Local image paths in the file are relative to the file itself.
      const image = post.image && !/^https?:\/\//i.test(post.image) ? path.resolve(path.dirname(file), post.image) : post.image;
      const result = await fb.publish({ ...post, image });
      post.facebook_id = result.id;
      post.sent_at = new Date().toISOString();
      // Save after each post so a failure halfway never double-posts on retry.
      fs.writeFileSync(file, JSON.stringify(posts, null, 2) + '\n');
      console.log(`sent ${result.id}: ${describe(post)}`);
      sent++;
    }
    if (!opts.dryRun) console.log(sent ? `Done: ${sent} sent.` : 'Nothing new to send.');
    return;
  }

  const post = { text: command, link: opts.link, image: opts.image, at: opts.at };
  if (opts.dryRun) { console.log(`would send: ${describe(post)}`); return; }
  const result = await fb.publish(post);
  console.log(`${result.scheduledFor ? 'Scheduled' : 'Posted'}: ${result.id}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
