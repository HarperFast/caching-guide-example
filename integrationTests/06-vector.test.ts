/**
 * Step 6 — Vector (semantic search).
 *
 * Requires an embedding provider, so the suite is skipped unless EMBEDDING_PROVIDER
 * is set. With one configured, warming the catalog also embeds each product, and
 * ProductSearch finds items by meaning rather than keywords.
 *
 *   EMBEDDING_PROVIDER=ollama npm test
 */
import { suite, test, before, after } from 'node:test';
import { ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

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
			const api = authedFetch(httpURL, admin.username, admin.password);
			await api('/Catalog/', { method: 'POST' }); // warms + embeds the catalog
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
	},
);
