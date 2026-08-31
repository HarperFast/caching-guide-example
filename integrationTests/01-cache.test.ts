/**
 * Step 1 — Cache a structured JSON API.
 *
 * A GET for an uncached id triggers a single upstream fetch and stores the
 * structured result in ProductCache; subsequent GETs are served from the cache.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

suite('Step 1 — cache a structured JSON API', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, fixtureDir);
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('GET /ProductCache/:id fetches and caches a product from the upstream API', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const res = await api('/ProductCache/1');
		strictEqual(res.status, 200);

		const body = (await res.json()) as Record<string, unknown>;
		strictEqual(body.id, 1);
		ok(body.title, `expected a title, got: ${JSON.stringify(body)}`);
		ok(typeof body.price === 'number', 'expected a numeric price');
	});

	test('GET /ProductCache/:id returns the same record from cache on a second read', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const first = (await (await api('/ProductCache/2')).json()) as Record<string, unknown>;
		const second = (await (await api('/ProductCache/2')).json()) as Record<string, unknown>;

		strictEqual(second.title, first.title, 'cached read should match the first read');
	});
});
