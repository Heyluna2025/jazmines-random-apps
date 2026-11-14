'use strict';

// Checks the requests sent to the Graph API against a fake fetch, so the
// tests never touch Facebook.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createClient, scheduleTime } = require('../lib/facebook');

const NOW = Date.parse('2026-11-01T12:00:00Z');

function fakeFetch(reply = { id: '111_222' }, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    const form = init.body ? Object.fromEntries(init.body.entries()) : {};
    calls.push({ url: String(url), method: init.method, form });
    return { ok: status < 400, status, json: async () => reply };
  };
  return { fetch, calls };
}

test('text post goes to /feed with the page token', async () => {
  const { fetch, calls } = fakeFetch();
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const out = await fb.publish({ text: 'Hello', link: 'https://example.com' });
  assert.equal(out.id, '111_222');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/123\/feed$/);
  assert.equal(calls[0].form.message, 'Hello');
  assert.equal(calls[0].form.link, 'https://example.com');
  assert.equal(calls[0].form.access_token, 'tok');
  assert.equal(calls[0].form.published, undefined);
});

test('scheduled post is unpublished with a Unix time', async () => {
  const { fetch, calls } = fakeFetch();
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const out = await fb.publish({ text: 'Later', at: '2026-11-03T10:00-05:00' }, { now: NOW });
  assert.equal(calls[0].form.published, 'false');
  assert.equal(calls[0].form.scheduled_publish_time, String(Date.parse('2026-11-03T15:00:00Z') / 1000));
  assert.equal(out.scheduledFor, Date.parse('2026-11-03T15:00:00Z') / 1000);
});

test('image URL goes to /photos with the link folded into the caption', async () => {
  const { fetch, calls } = fakeFetch({ id: '9', post_id: '123_9' });
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const out = await fb.publish({ text: 'Look', link: 'https://x.io', image: 'https://cdn.example/pic.jpg' });
  assert.equal(out.id, '123_9');
  assert.match(calls[0].url, /\/123\/photos$/);
  assert.equal(calls[0].form.url, 'https://cdn.example/pic.jpg');
  assert.equal(calls[0].form.caption, 'Look\n\nhttps://x.io');
});

test('local image is uploaded as a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbpost-'));
  const file = path.join(dir, 'pic.png');
  fs.writeFileSync(file, Buffer.from([1, 2, 3]));
  const { fetch, calls } = fakeFetch({ id: '9', post_id: '123_9' });
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  await fb.publish({ text: 'Local', image: file });
  assert.equal(calls[0].form.source.name, 'pic.png');
  assert.equal(calls[0].form.source.size, 3);
  assert.equal(calls[0].form.caption, 'Local');
});

test('several images become one multi-photo post, in order', async () => {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    calls.push({ url: String(url), form: Object.fromEntries(init.body.entries()) });
    const isPhoto = String(url).endsWith('/photos');
    return { ok: true, status: 200, json: async () => (isPhoto ? { id: `p${++n}` } : { id: '123_77' }) };
  };
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const out = await fb.publish(
    { text: 'Meet the leaders', images: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png'], at: '2026-11-03T10:00-05:00' },
    { now: NOW },
  );
  assert.equal(out.id, '123_77');
  assert.equal(out.photos, 3);
  assert.deepEqual(calls.slice(0, 3).map((c) => [c.form.url, c.form.published, c.form.temporary]), [
    ['https://x/1.png', 'false', 'true'],
    ['https://x/2.png', 'false', 'true'],
    ['https://x/3.png', 'false', 'true'],
  ]);
  const feed = calls[3];
  assert.match(feed.url, /\/123\/feed$/);
  assert.equal(feed.form.message, 'Meet the leaders');
  assert.equal(feed.form.published, 'false');
  assert.equal(feed.form['attached_media[0]'], '{"media_fbid":"p1"}');
  assert.equal(feed.form['attached_media[2]'], '{"media_fbid":"p3"}');
});

// Fake Graph API for Instagram flows: routes by endpoint and records calls.
function fakeGraph(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    const form = init.body ? Object.fromEntries(init.body.entries()) : Object.fromEntries(u.searchParams);
    calls.push({ method: init.method, path: u.pathname.replace(/^\/v[\d.]+\//, ''), form });
    const reply = routes(init.method, u.pathname.replace(/^\/v[\d.]+\//, ''), form, calls);
    return { ok: true, status: 200, json: async () => reply };
  };
  return { fetch, calls };
}

test('Instagram single image: find the account, create, wait, publish', async () => {
  let polls = 0;
  const { fetch, calls } = fakeGraph((method, p, form) => {
    if (p === '123') return { instagram_business_account: { id: '900', username: 'aiempowered' } };
    if (p === '900/media') return { id: 'c1' };
    if (p === 'c1') return { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' };
    if (p === '900/media_publish') return { id: 'm1' };
    throw new Error(`unexpected ${method} ${p}`);
  });
  const fb = createClient({ pageId: '123', token: 'tok', fetch, sleep: async () => {} });
  const out = await fb.publishInstagram({ text: 'Hi', link: 'https://x.io', image: 'https://cdn.example/a.jpg' });
  assert.equal(out.id, 'm1');
  const create = calls.find((c) => c.path === '900/media');
  assert.equal(create.form.image_url, 'https://cdn.example/a.jpg');
  assert.equal(create.form.caption, 'Hi\n\nhttps://x.io');
  assert.equal(calls.filter((c) => c.path === 'c1').length, 2);
  assert.equal(calls.at(-1).form.creation_id, 'c1');
});

test('Instagram carousel hosts local files through the Page and keeps order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igpost-'));
  const files = ['1.png', '2.png'].map((f) => { const p = path.join(dir, f); fs.writeFileSync(p, Buffer.from([1])); return p; });
  let photo = 0;
  let child = 0;
  const { fetch, calls } = fakeGraph((method, p, form) => {
    if (p === '123/photos') return { id: `ph${++photo}` };
    if (/^ph\d$/.test(p)) return { images: [{ width: 320, source: `https://fbcdn/${p}-small.jpg` }, { width: 1080, source: `https://fbcdn/${p}.jpg` }] };
    if (p === '900/media' && form.is_carousel_item) return { id: `k${++child}` };
    if (p === '900/media') return { id: 'car' };
    if (/^(k\d|car)$/.test(p)) return { status_code: 'FINISHED' };
    if (p === '900/media_publish') return { id: 'm9' };
    throw new Error(`unexpected ${method} ${p}`);
  });
  const fb = createClient({ pageId: '123', token: 'tok', igUserId: '900', fetch, sleep: async () => {} });
  const out = await fb.publishInstagram({ text: 'Leaders', images: files });
  assert.equal(out.id, 'm9');
  assert.equal(out.photos, 2);
  const uploads = calls.filter((c) => c.path === '123/photos');
  assert.deepEqual(uploads.map((c) => [c.form.source.name, c.form.published]), [['1.png', 'false'], ['2.png', 'false']]);
  const items = calls.filter((c) => c.path === '900/media' && c.form.is_carousel_item);
  assert.deepEqual(items.map((c) => c.form.image_url), ['https://fbcdn/ph1.jpg', 'https://fbcdn/ph2.jpg']);
  const parent = calls.find((c) => c.path === '900/media' && c.form.media_type === 'CAROUSEL');
  assert.equal(parent.form.children, 'k1,k2');
  assert.equal(parent.form.caption, 'Leaders');
});

test('Instagram Reel: video container, wait for processing, publish', async () => {
  let polls = 0;
  const { fetch, calls } = fakeGraph((method, p) => {
    if (p === '900/media') return { id: 'r1' };
    if (p === 'r1') return { status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' };
    if (p === '900/media_publish') return { id: 'm7' };
    throw new Error(`unexpected ${method} ${p}`);
  });
  const fb = createClient({ pageId: '123', token: 'tok', igUserId: '900', fetch, sleep: async () => {} });
  const out = await fb.publishInstagramReel({ videoUrl: 'https://video.example/v.mp4', caption: 'Week 1' });
  assert.equal(out.id, 'm7');
  const create = calls.find((c) => c.path === '900/media');
  assert.equal(create.form.media_type, 'REELS');
  assert.equal(create.form.video_url, 'https://video.example/v.mp4');
  assert.equal(create.form.share_to_feed, 'true');
  assert.equal(create.form.caption, 'Week 1');
  assert.equal(calls.filter((c) => c.path === 'r1').length, 3);
  await assert.rejects(fb.publishInstagramReel({ videoUrl: 'local.mp4' }), /public video URL/);
});

test('Instagram refuses text-only posts and gives up on failed processing', async () => {
  const fb = createClient({ pageId: '123', token: 'tok', igUserId: '900', fetch: fakeGraph(() => ({})).fetch });
  await assert.rejects(fb.publishInstagram({ text: 'no picture' }), /at least one image/);
  const { fetch } = fakeGraph((method, p) => (p === '900/media' ? { id: 'c1' } : { status_code: 'ERROR' }));
  const fb2 = createClient({ pageId: '123', token: 'tok', igUserId: '900', fetch, sleep: async () => {} });
  await assert.rejects(fb2.publishInstagram({ image: 'https://x/a.jpg' }), /couldn't process/);
});

test('Facebook errors come back in plain language', async () => {
  const { fetch } = fakeFetch({ error: { message: 'Session has expired', code: 190 } }, 400);
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  await assert.rejects(fb.publish({ text: 'x' }), /expired or invalid/);
});

test('whoAmI tells whether the token is the Page token', async () => {
  const { fetch, calls } = fakeFetch({ id: '123', name: 'AI Empowered Club' });
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const me = await fb.whoAmI();
  assert.equal(me.matchesPage, true);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/me\?access_token=tok&fields=id%2Cname$/);
});

test('show reads a post and delete removes it', async () => {
  const { fetch, calls } = fakeFetch({ id: '123_9', success: true, is_published: false });
  const fb = createClient({ pageId: '123', token: 'tok', fetch });
  const post = await fb.show('123_9');
  assert.equal(post.is_published, false);
  assert.match(calls[0].url, /\/123_9\?access_token=tok&fields=message%2Cis_published/);
  assert.equal(await fb.remove('123_9'), true);
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/123_9$/);
  assert.equal(calls[1].form.access_token, 'tok');
});

test('schedule times need a timezone and 10 minutes of lead', () => {
  assert.equal(scheduleTime(undefined, NOW), undefined);
  assert.throws(() => scheduleTime('2026-11-03T10:00', NOW), /no timezone/);
  assert.throws(() => scheduleTime('2026-11-01T12:05Z', NOW), /10 minutes/);
  assert.throws(() => scheduleTime('soon Z', NOW), /not a date/);
  assert.equal(scheduleTime('2026-11-01T13:00:00Z', NOW), Date.parse('2026-11-01T13:00:00Z') / 1000);
});

test('empty posts and missing settings are refused', async () => {
  assert.throws(() => createClient({ token: 'tok' }), /FB_PAGE_ID/);
  assert.throws(() => createClient({ pageId: '1' }), /FB_PAGE_ACCESS_TOKEN/);
  const fb = createClient({ pageId: '1', token: 'tok', fetch: fakeFetch().fetch });
  await assert.rejects(fb.publish({ text: '   ' }), /needs text/);
});

test('Instagram Stories: one STORIES container per image, published in order', async () => {
  let n = 0;
  const { fetch, calls } = fakeGraph((method, p) => {
    if (p === '900/media') return { id: `c${++n}` };
    if (/^c\d$/.test(p)) return { status_code: 'FINISHED' };
    if (p === '900/media_publish') return { id: `s${n}` };
    throw new Error(`unexpected ${method} ${p}`);
  });
  const fb = createClient({ pageId: '123', token: 'tok', igUserId: '900', fetch, sleep: async () => {} });
  const out = await fb.publishInstagramStories({ images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] });
  assert.deepEqual(out.ids, ['s1', 's2']);
  const creates = calls.filter((c) => c.path === '900/media');
  assert.equal(creates.length, 2);
  assert.equal(creates[0].form.media_type, 'STORIES');
  assert.equal(creates[1].form.image_url, 'https://img.example/2.jpg');
  assert.equal(creates[0].form.caption, undefined);
});
