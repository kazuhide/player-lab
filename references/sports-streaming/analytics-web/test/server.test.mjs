import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDashboardServer } from '../server.mjs';

async function open(t, service = { query: async () => ({ status: 'empty' }) }) {
  const server = createDashboardServer({ service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('localhost binding, host allowlist and same-origin checks prevent cross-site access', async t => {
  let queries = 0; const port = await open(t, { query: async () => { queries += 1; return { status: 'empty' }; } });
  for (const headers of [{ Host: `attacker.test:${port}` }, { Origin: 'https://attacker.test' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request(port, '/api/qoe', { headers })).status, 403);
  assert.equal(queries, 0);
  assert.equal((await request(port, '/api/qoe', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
});

test('top-level native navigation can open the public dashboard without a web activation header', async t => {
  let queries = 0;
  const port = await open(t, { query: async () => { queries += 1; return { status: 'empty' }; } });
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const result = await request(port, '/', { headers });
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /^text\/html/);
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(queries, 0);
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  for (const path of ['/api/qoe', '/api/config', '/app.mjs', '/?query=other']) {
    assert.equal((await request(port, path, { headers })).status, 403);
  }
  assert.equal(queries, 0);
});

test('dashboard navigation exception does not admit embeds, scripted fetches or foreign origins', async t => {
  const port = await open(t);
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-User': '?1' };
  for (const headers of [
    { ...navigation, 'Sec-Fetch-Dest': 'iframe' },
    { ...navigation, 'Sec-Fetch-Mode': 'cors' },
    { ...navigation, Origin: 'https://attacker.test' },
    { ...navigation, Host: `attacker.test:${port}` },
  ]) assert.equal((await request(port, '/', { headers })).status, 403);
  for (const method of ['POST', 'HEAD']) assert.equal((await request(port, '/', { method, headers: navigation })).status, 403);
});

test('API method/path allowlist and private paths never expose configuration files', async t => {
  const port = await open(t);
  assert.equal((await request(port, '/api/qoe', { method: 'POST' })).status, 405);
  for (const path of ['/.env', '/config.mjs', '/lib/query.mjs', '/../../.env', '/%2e%2e/.env', '//attacker.test/api/qoe', '/api/proxy', '/api/config?licenseKey=other']) assert.notEqual((await request(port, path)).status, 200);
  const config = await request(port, '/api/config');
  assert.equal(config.status, 200);
  assert.doesNotMatch(config.body, /apiKey|licenseKey/);
  assert.match(config.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal(config.headers['access-control-allow-origin'], undefined);
  assert.equal(config.headers['cache-control'], 'no-store');
});

test('unexpected failures do not reflect upstream diagnostics or credentials', async t => {
  const port = await open(t, { query: async () => { throw new Error('sensitive-api-key-and-account'); } });
  const result = await request(port, '/api/qoe');
  assert.equal(result.status, 500);
  assert.deepEqual(JSON.parse(result.body), { code: 'SERVER_ERROR' });
});

test('demo assets and configuration load without querying or disclosing credentials', async t => {
  let queries = 0;
  const port = await open(t, { configured: false, query: async () => { queries += 1; return { status: 'unconfigured' }; } });
  for (const path of ['/', '/demo.mjs', '/app.mjs', '/styles.css']) assert.equal((await request(port, path)).status, 200);
  const result = await request(port, '/api/config');
  assert.equal(JSON.parse(result.body).queryConfigured, false);
  assert.doesNotMatch(result.body, /apiKey|licenseKey/);
  assert.equal(queries, 0);
  const configuredPort = await open(t, { configured: true, query: async () => ({ status: 'empty' }) });
  assert.equal(JSON.parse((await request(configuredPort, '/api/config')).body).queryConfigured, true);
});
