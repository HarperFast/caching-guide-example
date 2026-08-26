/**
 * Verifies the JokeCache resource which caches jokes from an external API.
 *   - GET /JokeCache/:id triggers a read-through fetch from the joke API and caches the result.
 *   - A second GET is served from the cache and a conditional request returns a real 304.
 *   - POST /JokeCache/:id with {action: "invalidate"} evicts the cached entry (uses
 *     `invalidate()`, not `delete()` — the v5 cache eviction contract) and forces a re-fetch.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

// harper's `exports` map only exposes ".", so 'harper/dist/bin/harper.js' is not resolvable
// via require.resolve. Resolve the CLI from the exported main entry and pass it explicitly.
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

suite('JokeCache REST', (ctx: ContextWithHarper) => {
  before(async () => {
    await setupHarperWithFixture(ctx, fixtureDir, { harperBinPath });
  });

  after(async () => {
    await teardownHarper(ctx);
  });

  test('GET /JokeCache/ returns an accessible endpoint', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    const res = await fetch(`${httpURL}/JokeCache/`, {
      headers: { Authorization: auth },
    });
    await res.arrayBuffer();

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

  test('GET /JokeCache/:id returns the same cached result on a second fetch', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    // First call populates the cache from the source.
    const res1 = await fetch(`${httpURL}/JokeCache/2`, {
      headers: { Authorization: auth },
    });
    strictEqual(res1.status, 200, `first fetch for id=2 should return 200, got ${res1.status}`);
    const body1 = await res1.json() as Record<string, unknown>;

    // Second call should return the cached copy.
    const res2 = await fetch(`${httpURL}/JokeCache/2`, {
      headers: { Authorization: auth },
    });
    const body2 = await res2.json() as Record<string, unknown>;

    strictEqual(res2.status, 200);
    strictEqual(body1.setup, body2.setup, 'cached response setup should match first response');
  });

  // Reads `${httpURL}/JokeCache/${id}` until Harper serves it from cache with a validator.
  // The first read for an id is a cache MISS: Harper loads it through the source and the
  // record is committed to the cache table asynchronously, so the miss response carries no
  // stored record version and therefore no ETag/Last-Modified. Once the entry is committed,
  // subsequent reads are cache HITS whose stored version Harper turns into an ETag. We poll
  // a few times to ride out the background commit before asserting the validator.
  async function fetchUntilCached(httpURL: string, auth: string, id: string | number) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const res = await fetch(`${httpURL}/JokeCache/${id}`, { headers: { Authorization: auth } });
      await res.arrayBuffer();
      const validator = res.headers.get('etag') ?? res.headers.get('last-modified');
      if (res.status === 200 && validator) {
        return { res, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`fetchUntilCached timeout: no validator received for id=${id} after 60 attempts`);
  }

  test('GET /JokeCache/:id honors a conditional request with a real 304 cache hit', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    // Prime the cache, then read again until the entry is committed and Harper emits a
    // validator for the cache hit. Harper derives the ETag from the cached record's stored
    // version, so a validator only appears once the read is served from the cache table.
    const { res, etag, lastModified } = await fetchUntilCached(httpURL, auth, 4);
    strictEqual(res.status, 200);
    ok(etag || lastModified, 'a cached response should expose an ETag or Last-Modified validator');

    const conditionalHeaders: Record<string, string> = { Authorization: auth };
    if (etag) conditionalHeaders['If-None-Match'] = etag;
    else if (lastModified) conditionalHeaders['If-Modified-Since'] = lastModified;

    const conditional = await fetch(`${httpURL}/JokeCache/4`, { headers: conditionalHeaders });
    await conditional.arrayBuffer();

    strictEqual(conditional.status, 304, 'a matching conditional request should be a 304 cache hit');
  });

  test('POST /JokeCache/:id with action invalidate evicts the cache and forces a re-fetch', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    // Populate the cache and obtain the validator Harper emits for the committed entry.
    const { res: first, etag, lastModified } = await fetchUntilCached(httpURL, auth, 3);
    strictEqual(first.status, 200);

    // Invalidate the cached entry. This exercises `this.invalidate(target)` in the resource
    // (the v5 eviction contract); `delete()` would throw because the source has no delete().
    const inv = await fetch(`${httpURL}/JokeCache/3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ action: 'invalidate' }),
    });
    await inv.arrayBuffer();
    ok(inv.status < 400, `invalidate should succeed, got ${inv.status}`);

    // After invalidation the prior validator must no longer produce a 304 — the entry was
    // evicted and is re-fetched from the source on the next read.
    //
    // Send the conditional request with whichever validator Harper emitted. Branching on
    // `etag` alone left a Last-Modified-only run asserting nothing about invalidation: an
    // *unconditional* re-fetch returns 200 whether or not the entry was ever evicted, so
    // that path passed without exercising the behaviour under test. `fetchUntilCached`
    // guarantees at least one of the two is present, so there is no third case.
    const conditionalHeaders: Record<string, string> = { Authorization: auth };
    if (etag) conditionalHeaders['If-None-Match'] = etag;
    else conditionalHeaders['If-Modified-Since'] = lastModified!;

    const afterInvalidate = await fetch(`${httpURL}/JokeCache/3`, { headers: conditionalHeaders });
    // Drain the body before asserting so a 304 (empty body) doesn't leave the socket open.
    const afterBody = await afterInvalidate.text();
    strictEqual(
      afterInvalidate.status,
      200,
      `after invalidation the cache must be re-fetched, not served as a 304 (got ${afterInvalidate.status})`,
    );
    ok(
      (JSON.parse(afterBody) as Record<string, unknown>).setup,
      'a re-fetched joke should still have a setup field',
    );
  });
});
