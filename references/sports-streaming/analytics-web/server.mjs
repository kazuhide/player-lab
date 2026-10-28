import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { createAnalyticsService, QueryError } from './lib/query.mjs';

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/client.mjs', ['client.mjs', 'text/javascript; charset=utf-8']],
  ['/ui.mjs', ['ui.mjs', 'text/javascript; charset=utf-8']],
  ['/supplement.mjs', ['supplement.mjs', 'text/javascript; charset=utf-8']],
  ['/translations.mjs', ['translations.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export function createDashboardServer({ service = createAnalyticsService({ config, apiKey: process.env.BITMOVIN_API_KEY, licenseKey: process.env.BITMOVIN_ANALYTICS_LICENSE_KEY }) } = {}) {
  const server = createServer(async (request, response) => {
    const security = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    function send(status, body, type = 'application/json; charset=utf-8', extra = {}) {
      if (response.destroyed) return;
      response.writeHead(status, { ...security, 'Content-Type': type, ...extra });
      response.end(request.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    }
    try {
      const port = server.address()?.port;
      const host = request.headers.host;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || !request.url?.startsWith('/') || request.url.startsWith('//')) return send(403, { code: 'LOCAL_ORIGIN_REQUIRED' });
      const url = new URL(request.url, `http://${host}`);
      // Native browser launches can carry cross-site metadata without web user
      // activation. Only the public top-level document is exempt; APIs stay local.
      const documentNavigation = request.method === 'GET' && url.pathname === '/' && !url.search &&
        request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
      if ((request.headers.origin && request.headers.origin !== `http://${host}`) ||
          (request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation)) return send(403, { code: 'LOCAL_ORIGIN_REQUIRED' });
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET') return send(405, { code: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' });
        if (url.pathname === '/api/config' && !url.search) return send(200, config);
        if (url.pathname === '/api/qoe') return send(200, await service.query(url.searchParams));
        return send(404, { code: 'NOT_FOUND' });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, { code: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET, HEAD' });
      const entry = publicFiles.get(url.pathname);
      if (!entry || url.search) return send(404, { code: 'NOT_FOUND' });
      const content = await readFile(new URL(`./public/${entry[0]}`, import.meta.url));
      send(200, content, entry[1]);
    } catch (error) {
      if (error instanceof QueryError) return send(['BUSY', 'RATE_LIMITED'].includes(error.code) ? 429 : 400, { code: error.code }, undefined, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
      send(500, { code: 'SERVER_ERROR' });
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? config.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  const server = createDashboardServer();
  server.listen(port, '127.0.0.1', () => console.log(`Analytics dashboard: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
