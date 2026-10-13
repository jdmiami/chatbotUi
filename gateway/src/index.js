import { createGateway, loadConfig } from './server.js';

const config = loadConfig();
const server = createGateway(config);

server.listen(config.port, () => {
  console.log(`[gateway] listening on :${config.port}, guacd at ${config.guacd.host}:${config.guacd.port}`);
  if (!config.allowedOrigins.length) {
    console.warn('[gateway] ALLOWED_ORIGINS is empty: any website may open a tunnel with a valid token');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
