/**
 * Step 6 — Vector (semantic search).
 *
 * The search suite needs an embedding provider, so it is skipped unless EMBEDDING_PROVIDER
 * is set. With one configured, warming the catalog also embeds each product, and
 * ProductSearch finds items by meaning rather than keywords.
 *
 *   EMBEDDING_PROVIDER=ollama npm test
 */
import { suite, test, before, after } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch, warmCatalog } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');
const providerSet = Boolean(process.env.EMBEDDING_PROVIDER);

suite(
	'Step 6 — semantic search',
	{ skip: providerSet ? false : 'set EMBEDDING_PROVIDER (openai|ollama) to run' },
	(ctx: ContextWithHarper) => {
		before(async () => {
			await setupHarperWithFixture(ctx, fixtureDir);
			const { admin, httpURL } = ctx.harper;
			await warmCatalog(authedFetch(httpURL, admin.username, admin.password)); // warms + embeds the catalog
		});

		after(async () => {
			await teardownHarper(ctx);
		});

		test('finds products by meaning, ranked by distance', async () => {
			const { admin, httpURL } = ctx.harper;
			const api = authedFetch(httpURL, admin.username, admin.password);

			const res = await api('/ProductSearch/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: 'makeup for long eyelashes', limit: 5 }),
			});
			const rows = (await res.json()) as Array<Record<string, number | string>>;

			ok(rows.length > 0 && rows.length <= 5, `expected 1-5 matches, got ${rows.length}`);
			ok('$distance' in rows[0], 'results should include a $distance');
			for (let i = 1; i < rows.length; i++) {
				ok(
					(rows[i - 1].$distance as number) <= (rows[i].$distance as number),
					'results should be ordered by ascending distance',
				);
			}
		});

		test('a product refetched after invalidation keeps its embedding', async () => {
			const { admin, httpURL } = ctx.harper;
			const api = authedFetch(httpURL, admin.username, admin.password);

			const res = await api('/ProductCache/5', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'invalidate' }),
			});
			ok(res.ok, `invalidate failed: ${res.status}`);

			const product = (await (await api('/ProductCache/5?select(id,embedding)')).json()) as { embedding?: number[] };
			ok(
				Array.isArray(product.embedding) && product.embedding.length > 0,
				`refetched product should be re-embedded, got ${JSON.stringify(product).slice(0, 200)}`,
			);
		});
	},
);

suite('Step 6 — an embedding outage does not fail cache reads', (ctx: ContextWithHarper) => {
	before(async () => {
		// Nothing listens on port 9 (discard), so every embedding request is refused.
		await setupHarperWithFixture(ctx, fixtureDir, {
			env: { EMBEDDING_PROVIDER: 'ollama', OLLAMA_URL: 'http://127.0.0.1:9' },
		});
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('a read-through miss still returns the product', async () => {
		const { admin, httpURL } = ctx.harper;
		const res = await authedFetch(httpURL, admin.username, admin.password)('/ProductCache/1');
		strictEqual(res.status, 200);
		strictEqual(((await res.json()) as { id: number }).id, 1);
	});
});
