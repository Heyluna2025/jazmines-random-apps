'use strict';

// Thin Graph API client for a Facebook Page and the Instagram professional
// account linked to it: text, link, photo and multi-photo posts on the Page
// (scheduled or immediate), and photo and carousel posts on Instagram. Uses
// the global fetch, FormData and Blob from Node 18+, so there are no
// dependencies. Pass { fetch, sleep } to swap in fakes for tests.

const fs = require('fs');
const path = require('path');

const DEFAULT_VERSION = 'v23.0';
// Facebook rejects scheduled posts less than 10 minutes out.
const MIN_SCHEDULE_MS = 10 * 60 * 1000;

class FacebookError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'FacebookError';
    this.details = details;
  }
}

function createClient({
  pageId,
  token,
  version = DEFAULT_VERSION,
  igUserId,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!pageId) throw new Error('FB_PAGE_ID is not set.');
  if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN is not set.');
  const base = `https://graph.facebook.com/${version}`;

  async function call(method, endpoint, body) {
    const url = new URL(`${base}/${endpoint}`);
    const init = { method };
    if (method === 'GET') {
      url.searchParams.set('access_token', token);
      for (const [k, v] of Object.entries(body || {})) url.searchParams.set(k, v);
    } else {
      if (!(body instanceof FormData)) {
        const form = new FormData();
        for (const [k, v] of Object.entries(body || {})) if (v !== undefined) form.set(k, String(v));
        body = form;
      }
      body.set('access_token', token);
      init.body = body;
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const err = data.error || {};
      throw new FacebookError(explain(err) || `Facebook answered ${res.status}`, err);
    }
    return data;
  }

  // With a Page token, /me is the Page itself.
  async function whoAmI() {
    const me = await call('GET', 'me', { fields: 'id,name' });
    return { ...me, matchesPage: me.id === String(pageId) };
  }

  // One photo upload to /photos, from a public URL or a local file.
  function photoBody(image, fields) {
    if (/^https?:\/\//i.test(image)) return { url: image, ...fields };
    const body = new FormData();
    const file = path.resolve(image);
    body.set('source', new Blob([fs.readFileSync(file)]), path.basename(file));
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.set(k, String(v));
    return body;
  }

  async function publish(post, { now = Date.now() } = {}) {
    const { text, link, images } = normalize(post);
    const when = scheduleTime(post.at, now);
    const timing = when ? { published: 'false', scheduled_publish_time: when } : {};

    if (!images.length) {
      const data = await call('POST', `${pageId}/feed`, { message: text, link, ...timing });
      return { id: data.id, scheduledFor: when };
    }

    // Photo posts can't carry a link preview, so the link goes in the caption.
    const caption = link ? [text, link].filter(Boolean).join('\n\n') : text;

    if (images.length === 1) {
      const data = await call('POST', `${pageId}/photos`, photoBody(images[0], { caption, ...timing }));
      return { id: data.post_id || data.id, scheduledFor: when };
    }

    // Multi-photo post: upload each photo unpublished, then attach them all to
    // one feed post in order. Scheduled posts need temporary uploads.
    const ids = [];
    for (const image of images) {
      const data = await call('POST', `${pageId}/photos`, photoBody(image, { published: 'false', temporary: when ? 'true' : undefined }));
      ids.push(data.id);
    }
    const body = { message: caption, ...timing };
    ids.forEach((id, i) => { body[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const data = await call('POST', `${pageId}/feed`, body);
    return { id: data.id, scheduledFor: when, photos: ids.length };
  }

  async function show(postId) {
    return call('GET', postId, { fields: 'message,is_published,scheduled_publish_time,created_time,permalink_url' });
  }

  async function remove(postId) {
    const data = await call('DELETE', postId);
    return data.success === true;
  }

  // ---- Instagram (the professional account linked to the Page) ----

  let igAccount;
  async function instagramAccount() {
    if (igAccount) return igAccount;
    if (igUserId) return (igAccount = { id: String(igUserId) });
    const data = await call('GET', String(pageId), { fields: 'instagram_business_account{id,username}' });
    if (!data.instagram_business_account) {
      throw new Error('No Instagram professional account is linked to this Page, or the token lacks instagram_basic. Link it in Meta Business Suite → Settings → Instagram account, then make a token with instagram_basic and instagram_content_publish.');
    }
    return (igAccount = data.instagram_business_account);
  }

  // Instagram fetches images itself from a public URL and only accepts JPEG.
  // Uploading a local file to the Page as an unpublished photo covers both:
  // Facebook re-encodes it and serves it from its CDN. Unpublished photos
  // don't appear on the Page.
  async function hostImage(image) {
    if (/^https?:\/\//i.test(image)) return image;
    const photo = await call('POST', `${pageId}/photos`, photoBody(image, { published: 'false' }));
    const data = await call('GET', photo.id, { fields: 'images' });
    const largest = (data.images || []).sort((a, b) => b.width - a.width)[0];
    if (!largest) throw new Error(`Facebook returned no hosted copy of ${image}.`);
    return largest.source;
  }

  async function waitUntilReady(containerId, { tries = 20, delayMs = 3000 } = {}) {
    for (let i = 0; i < tries; i++) {
      const { status_code: status } = await call('GET', containerId, { fields: 'status_code' });
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram couldn't process the media (${status}).`);
      await sleep(delayMs);
    }
    throw new Error('Instagram is still processing the media. Try again in a few minutes.');
  }

  // Instagram's API publishes immediately; it has no scheduler. Scheduled
  // Instagram posts wait in the queue until they are due (see post.js).
  async function publishInstagram(post) {
    const { text, link, images } = normalize(post);
    if (!images.length) throw new Error('Instagram posts need at least one image.');
    if (images.length > 10) throw new Error('Instagram carousels take at most 10 images.');
    const ig = await instagramAccount();
    // Links in captions aren't clickable on Instagram, but keep them visible.
    const caption = link ? [text, link].filter(Boolean).join('\n\n') : text;

    const urls = [];
    for (const image of images) urls.push(await hostImage(image));

    let containerId;
    if (urls.length === 1) {
      containerId = (await call('POST', `${ig.id}/media`, { image_url: urls[0], caption })).id;
    } else {
      const children = [];
      for (const url of urls) {
        children.push((await call('POST', `${ig.id}/media`, { image_url: url, is_carousel_item: 'true' })).id);
      }
      for (const child of children) await waitUntilReady(child);
      containerId = (await call('POST', `${ig.id}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })).id;
    }
    await waitUntilReady(containerId);
    const id = await publishContainer(ig.id, containerId);
    return { id, photos: urls.length };
  }

  // Instagram can report FINISHED a little before the media can actually be
  // published ("Media ID is not available"), so give it a few more tries.
  async function publishContainer(igId, containerId) {
    for (let attempt = 1; ; attempt++) {
      try {
        return (await call('POST', `${igId}/media_publish`, { creation_id: containerId })).id;
      } catch (err) {
        if (attempt >= 4 || !/not available|not ready/i.test(err.message)) throw err;
        await sleep(5000 * attempt);
      }
    }
  }

  // Videos go to Instagram as Reels (the only video type the API publishes),
  // also shown in the main feed. Instagram downloads the video itself, so it
  // must be a public URL, such as a Page video's `source`.
  async function publishInstagramReel({ videoUrl, caption, shareToFeed = true }) {
    if (!/^https?:\/\//i.test(videoUrl || '')) throw new Error('Reels need a public video URL.');
    const ig = await instagramAccount();
    const containerId = (await call('POST', `${ig.id}/media`, {
      media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: shareToFeed ? 'true' : 'false',
    })).id;
    // Video processing takes minutes, not seconds.
    await waitUntilReady(containerId, { tries: 60, delayMs: 10000 });
    return { id: await publishContainer(ig.id, containerId) };
  }

  // A Page video's direct URL, for cross-posting it to Instagram.
  async function pageVideoSource(videoId) {
    const v = await call('GET', String(videoId), { fields: 'source,description,length' });
    if (!v.source) throw new Error(`Facebook gave no downloadable source for video ${videoId}.`);
    return v;
  }

  async function showInstagram(mediaId) {
    return call('GET', mediaId, { fields: 'caption,timestamp,permalink,media_type' });
  }

  return { whoAmI, publish, show, remove, instagramAccount, hostImage, publishInstagram, publishInstagramReel, pageVideoSource, showInstagram };
}

function normalize(post) {
  const text = (post.text || '').trim();
  const link = (post.link || '').trim() || undefined;
  const images = [].concat(post.images || [], post.image || []).map((s) => String(s).trim()).filter(Boolean);
  if (!text && !link && !images.length) throw new Error('A post needs text, a link or an image.');
  return { text: text || undefined, link, images };
}

// Returns Unix seconds, or undefined to post right away. Times must carry a
// timezone so "10:00" never silently means 10:00 UTC.
function scheduleTime(at, now = Date.now()) {
  if (!at) return undefined;
  const ms = parseTime(at);
  if (ms - now < MIN_SCHEDULE_MS) {
    throw new Error(`"${at}" is less than 10 minutes away. Facebook only schedules posts at least 10 minutes ahead; leave the time off to post now.`);
  }
  return Math.floor(ms / 1000);
}

// Milliseconds for an ISO time that names its timezone.
function parseTime(at) {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(String(at).trim())) {
    throw new Error(`"${at}" has no timezone. Write it like 2026-11-03T10:00+08:00 (or end with Z for UTC).`);
  }
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`"${at}" is not a date Facebook can use.`);
  return ms;
}

// Plain-language hints for the errors people actually hit.
function explain(err) {
  if (!err.message) return '';
  if (/does not exist/i.test(err.message)) return `That post doesn't exist (already deleted, or the ID is wrong).`;
  if (err.code === 190) return `The access token is expired or invalid. Make a new Page token (see README). (${err.message})`;
  if (err.code === 200 || err.code === 10) return `The token is missing the pages_manage_posts permission, or you are not an admin of this Page. (${err.message})`;
  if (err.code === 100) return `Facebook rejected a field: ${err.message}`;
  return err.message;
}

module.exports = { createClient, scheduleTime, parseTime, FacebookError, DEFAULT_VERSION };
