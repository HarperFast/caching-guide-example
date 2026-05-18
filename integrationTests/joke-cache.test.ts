/**
 * Verifies the JokeCache resource which caches jokes from an external API.
 * GET triggers a fetch from the joke API and caches the result.
 * POST with {action: "invalidate"} clears a cached entry.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

suite('JokeCache REST', (ctx: ContextWithHarper) => {
  before(async () => {
    await setupHarperWithFixture(ctx, fixtureDir);
  });

  after(async () => {
    await teardownHarper(ctx);
  });

  test('GET /JokeCache returns an accessible endpoint', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    const res = await fetch(`${httpURL}/JokeCache/`, {
      headers: { Authorization: auth },
    });

    ok(res.status < 500, `endpoint should not return a server error, got ${res.status}`);
  });

  test('GET /JokeCache/:id fetches and caches a joke from the external API', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    const res = await fetch(`${httpURL}/JokeCache/1`, {
      headers: { Authorization: auth },
    });

    strictEqual(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    ok(body.setup, `response should have a setup field, got: ${JSON.stringify(body)}`);
    ok(body.punchline, `response should have a punchline field, got: ${JSON.stringify(body)}`);
  });

  test('GET /JokeCache/:id returns cached result on second fetch', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    // First call caches the result
    const res1 = await fetch(`${httpURL}/JokeCache/2`, {
      headers: { Authorization: auth },
    });
    const body1 = await res1.json() as Record<string, unknown>;

    // Second call should return cached result
    const res2 = await fetch(`${httpURL}/JokeCache/2`, {
      headers: { Authorization: auth },
    });
    const body2 = await res2.json() as Record<string, unknown>;

    strictEqual(res2.status, 200);
    strictEqual(body1.setup, body2.setup, 'cached response setup should match first response');
  });

  test('POST /JokeCache/:id with action invalidate succeeds', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    // Populate the cache first
    await fetch(`${httpURL}/JokeCache/3`, { headers: { Authorization: auth } });

    const res = await fetch(`${httpURL}/JokeCache/3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ action: 'invalidate' }),
    });

    ok(res.status < 500, `invalidate should not return a server error, got ${res.status}`);
  });
});
