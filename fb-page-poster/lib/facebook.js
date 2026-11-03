'use strict';

// Thin client for the three Graph API calls this app needs: who the token
// belongs to, a text/link post (/feed), and a photo post (/photos). Uses the
// global fetch, FormData and Blob from Node 18+, so there are no dependencies.
// Pass { fetch } to swap in a fake for tests.

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

function createClient({ pageId, token, version = DEFAULT_VERSION, fetch = globalThis.fetch } = {}) {
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

  return { whoAmI, publish, show, remove };
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
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(String(at).trim())) {
    throw new Error(`"${at}" has no timezone. Write it like 2026-11-03T10:00-05:00 (or end with Z for UTC).`);
  }
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`"${at}" is not a date Facebook can use.`);
  if (ms - now < MIN_SCHEDULE_MS) {
    throw new Error(`"${at}" is less than 10 minutes away. Facebook only schedules posts at least 10 minutes ahead; leave the time off to post now.`);
  }
  return Math.floor(ms / 1000);
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

module.exports = { createClient, scheduleTime, FacebookError, DEFAULT_VERSION };
