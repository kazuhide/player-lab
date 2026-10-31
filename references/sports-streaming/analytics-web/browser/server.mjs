import { createDashboardServer } from '../server.mjs';

// Browser tests replace only the local HTTP API responses. This service cannot
// reach an account even if the shell has credentials configured.
const service = { configured: false, async query() { throw new Error('Unexpected browser API request'); } };
const server = createDashboardServer({ service });
server.listen(Number(process.env.BROWSER_TEST_PORT), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
