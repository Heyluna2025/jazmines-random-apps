#!/usr/bin/env node
'use strict';

// Posts to a Facebook Page from the command line.
//
//   node post.js check
//   node post.js "Hello from AI Empowered Club" [--link URL] [--image FILE|URL] [--at 2026-11-03T10:00-05:00] [--dry-run]
//   node post.js queue posts.json [--dry-run]
//
// --at hands the post to Facebook's own scheduler, so nothing needs to stay
// running. `queue` sends every entry in a JSON file that hasn't gone out yet
// and writes the Facebook post id back into the file, so re-running it is safe.

const fs = require('fs');
const path = require('path');
const { createClient } = require('./lib/facebook');

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
    console.error('Usage:\n  node post.js check\n  node post.js "text" [--link URL] [--image FILE|URL] [--at ISO-TIME] [--dry-run]\n  node post.js queue posts.json [--dry-run]');
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

  if (command === 'queue') {
    const file = path.resolve(rest[0] || 'posts.json');
    const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    let sent = 0;
    for (const post of posts) {
      if (post.facebook_id) continue;
      if (opts.dryRun) { console.log(`would send: ${describe(post)}`); continue; }
      const result = await fb.publish(post);
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
