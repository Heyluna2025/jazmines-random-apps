'use strict';

// Long-lived Node server for local runs and classic hosts (Render, Fly, Docker).
// Vercel uses api/index.js instead.

const http = require('http');
const { createApp } = require('./app');
const { createStore } = require('./store');
const config = require('./config');

const store = createStore();
const app = createApp({ store, presenterPassword: config.presenterPassword });
const server = http.createServer(app);

function shutdown() {
  Promise.resolve(store.close()).finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(config.PORT, config.HOST, () => {
  console.log(`Your Future Starts Here — listening on http://localhost:${config.PORT} (${store.kind} store)`);
  console.log('  Audience join page:  /  (or /a/CODE)');
  console.log('  Presenter controls:  /presenter');
  console.log('  Projector view:      /x/CODE');
  console.log('  Snack demo:          /demo');
});
