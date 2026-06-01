/**
 * Step 2 — Query your cache.
 *
 * After warming the catalog (POST /Catalog/), the cache is a queryable table:
 * filter, sort, paginate, and project fields with Harper's REST query language.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

suite('Step 2 — query the cache', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, fixtureDir);
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);
		const res = await api('/Catalog/', { method: 'POST' });
		const body = (await res.json()) as { loaded: number };
		ok(body.loaded > 0, `catalog warm-up should load records, got ${JSON.stringify(body)}`);
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('filters and sorts cached records with the REST query language', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const res = await api('/ProductCache/?price=le=50&sort(-rating)&limit(5)&select(id,title,price,rating)');
		strictEqual(res.status, 200);

		const rows = (await res.json()) as Array<Record<string, unknown>>;
		ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 5, `expected 1-5 rows, got ${rows.length}`);

		// Filter honored.
		for (const row of rows) {
			ok((row.price as number) <= 50, `price ${row.price} should be <= 50`);
			// Projection honored: no description field requested.
			strictEqual(row.description, undefined);
		}

		// Sort honored (rating descending).
		for (let i = 1; i < rows.length; i++) {
			ok((rows[i - 1].rating as number) >= (rows[i].rating as number), 'results should be sorted by rating desc');
		}
	});
});
