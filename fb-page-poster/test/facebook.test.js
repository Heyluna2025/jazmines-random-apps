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
