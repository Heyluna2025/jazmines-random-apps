'use strict';

// Vercel entry point: one function serves every /api route (see vercel.json).
// Pages and assets come straight from public/ through the CDN.

const { createApp } = require('../server/app');
const { createStore } = require('../server/store');
const { presenterPassword, presenterPath } = require('../server/config');

module.exports = createApp({ store: createStore(), presenterPassword, presenterPath });
