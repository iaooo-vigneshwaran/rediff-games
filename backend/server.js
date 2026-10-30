import { buildApp } from './app.js';

const app = buildApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); });
}
