#!/usr/bin/env node
'use strict';

// Posts to a Facebook Page and its linked Instagram account.
//
//   node post.js check
//   node post.js "Hello from AI Empowered Club" [--link URL] [--image FILE|URL ...] [--at 2026-11-03T10:00+08:00] [--platform facebook,instagram] [--dry-run]
//   node post.js queue posts.json [--dry-run]
//   node post.js show POST_ID [--platform instagram]
//   node post.js delete POST_ID
//   node post.js crosspost-video PAGE_VIDEO_ID [--dry-run]
//
// Repeat --image for a multi-photo (carousel) post; photos keep their order.
// crosspost-video publishes a video already on the Facebook Page to Instagram
// as a Reel, with the Facebook caption.
// --platform defaults to facebook.
//
// Facebook: --at hands the post to Facebook's own scheduler, so nothing needs
// to stay running. Instagram's API has no scheduler, so a scheduled Instagram
// post can only go through the queue: `queue` publishes it once its time has
// come, which means the queue must be run again around then (e.g. by an
// hourly scheduled task). `queue` writes each post's id back into the file
// per platform, so re-running it never double-posts.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient, parseTime } = require('./lib/facebook');

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

const PLATFORMS = ['facebook', 'instagram'];

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--image') (opts.images = opts.images || []).push(argv[++i]);
    else if (a === '--platform' || a === '--platforms') opts.platforms = argv[++i].split(',').map((p) => p.trim().toLowerCase());
    else if (['--link', '--at'].includes(a)) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

function platformsOf(post) {
  const list = [].concat(post.platforms || 'facebook');
  for (const p of list) if (!PLATFORMS.includes(p)) throw new Error(`Unknown platform "${p}". Use facebook and/or instagram.`);
  return list;
}

function describe(post) {
  const bits = [];
  if (post.text) bits.push(JSON.stringify(post.text.length > 60 ? post.text.slice(0, 57) + '...' : post.text));
  if (post.link) bits.push(`link ${post.link}`);
  const images = [].concat(post.images || [], post.image || []);
  if (images.length === 1) bits.push(`image ${images[0]}`);
  else if (images.length) bits.push(`${images.length}-photo carousel`);
  bits.push(post.at ? `for ${post.at}` : 'now');
  return bits.join(', ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [command, ...rest] = opts._;
  if (!command) {
    console.error('Usage:\n  node post.js check\n  node post.js "text" [--link URL] [--image FILE|URL ...] [--at ISO-TIME] [--platform facebook,instagram] [--dry-run]\n  node post.js queue posts.json [--dry-run]\n  node post.js show POST_ID [--platform instagram]\n  node post.js delete POST_ID\n  node post.js crosspost-video PAGE_VIDEO_ID [--dry-run]');
    process.exit(1);
  }

  const fb = createClient({
    pageId: process.env.FB_PAGE_ID,
    token: process.env.FB_PAGE_ACCESS_TOKEN,
    version: process.env.FB_GRAPH_VERSION || undefined,
    igUserId: process.env.IG_USER_ID || undefined,
  });

  if (command === 'check') {
    const me = await fb.whoAmI();
    if (!me.matchesPage) {
      throw new Error(`The token belongs to "${me.name}" (${me.id}), not Page ${process.env.FB_PAGE_ID}. Use the Page token from me/accounts, not your user token.`);
    }
    console.log(`OK: token posts as "${me.name}" (${me.id}).`);
    try {
      const ig = await fb.instagramAccount();
      console.log(`OK: Instagram account ${ig.username ? `@${ig.username} ` : ''}(${ig.id}) is linked.`);
    } catch (err) {
      console.log(`Instagram not ready: ${err.message}`);
    }
    return;
  }

  if (command === 'show' || command === 'delete') {
    const postId = rest[0];
    if (!postId) throw new Error(`Usage: node post.js ${command} POST_ID`);
    const instagram = (opts.platforms || []).includes('instagram');
    if (command === 'delete') {
      if (instagram) throw new Error('This tool can only delete Facebook posts. Delete Instagram posts in the Instagram app.');
      await fb.remove(postId);
      console.log(`Deleted: ${postId}`);
      return;
    }
    if (instagram) {
      const m = await fb.showInstagram(postId);
      console.log(`${m.id}: Instagram ${m.media_type} published ${m.timestamp}\n${m.permalink || ''}\n${m.caption || ''}`.trim());
      return;
    }
    const p = await fb.show(postId);
    const state = p.is_published
      ? `published ${p.created_time}`
      : `scheduled for ${new Date(p.scheduled_publish_time * 1000).toISOString()}`;
    console.log(`${p.id}: ${state}\n${p.permalink_url || ''}\n${p.message || ''}`.trim());
    return;
  }

  if (command === 'crosspost-video') {
    const videoId = rest[0];
    if (!videoId) throw new Error('Usage: node post.js crosspost-video PAGE_VIDEO_ID');
    const v = await fb.pageVideoSource(videoId);
    const caption = v.description || '';
    if (opts.dryRun) {
      console.log(`would post to instagram as a Reel: video ${videoId} (${Math.round(v.length || 0)}s), caption ${JSON.stringify(caption.slice(0, 60))}...`);
      return;
    }
    const result = await fb.publishInstagramReel({ videoUrl: v.source, caption });
    console.log(`Instagram Reel posted: ${result.id}`);
    return;
  }

  if (command === 'queue') {
    const file = path.resolve(rest[0] || 'posts.json');
    const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Local image paths in the file are relative to the file itself.
    const local = (p) => (/^https?:\/\//i.test(p) ? p : path.resolve(path.dirname(file), p));
    const save = () => fs.writeFileSync(file, JSON.stringify(posts, null, 2) + '\n');
    const now = Date.now();
    let sent = 0;
    const waiting = [];

    for (const post of posts) {
      const images = [].concat(post.images || [], post.image || []).map(local);
      for (const platform of platformsOf(post)) {
        const idField = `${platform}_id`;
        if (post[idField]) continue;

        // Instagram can't be scheduled ahead, so it waits here until due.
        if (platform === 'instagram' && post.at && parseTime(post.at) > now) {
          waiting.push(post.at);
          continue;
        }
        if (opts.dryRun) { console.log(`would send to ${platform}: ${describe(post)}`); continue; }

        const result = platform === 'facebook'
          ? await fb.publish({ ...post, image: undefined, images })
          : await fb.publishInstagram({ ...post, image: undefined, images });
        post[idField] = result.id;
        post[`${platform}_sent_at`] = new Date().toISOString();
        // Save after each post so a failure halfway never double-posts on retry.
        save();
        console.log(`sent to ${platform} ${result.id}: ${describe(post)}`);
        sent++;
      }
    }

    if (waiting.length) {
      const next = waiting.sort((a, b) => parseTime(a) - parseTime(b))[0];
      console.log(`${waiting.length} Instagram post(s) waiting for their time; next at ${next}. Run the queue again then.`);
    }
    if (!opts.dryRun) console.log(sent ? `Done: ${sent} sent.` : 'Nothing new to send.');
    return;
  }

  const post = { text: command, link: opts.link, images: opts.images, at: opts.at, platforms: opts.platforms };
  const platforms = platformsOf(post);
  if (platforms.includes('instagram') && post.at) {
    throw new Error("Instagram can't be scheduled ahead from the command line. Put the post in the queue with an \"at\" time, or leave --at off to post now.");
  }
  for (const platform of platforms) {
    if (opts.dryRun) { console.log(`would send to ${platform}: ${describe(post)}`); continue; }
    if (platform === 'facebook') {
      const result = await fb.publish(post);
      console.log(`Facebook ${result.scheduledFor ? 'scheduled' : 'posted'}: ${result.id}`);
    } else {
      const result = await fb.publishInstagram(post);
      console.log(`Instagram posted: ${result.id}`);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
