/**
 * Step 3 — Transform (reshape at the edge).
 *
 * `@computed` fields derive new attributes from the cached record at read time —
 * a backend-for-frontend, with no upstream change and no extra storage.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

suite('Step 3 — transform with @computed', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, fixtureDir);
		const { admin, httpURL } = ctx.harper;
		await authedFetch(httpURL, admin.username, admin.password)('/Catalog/', { method: 'POST' });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('a single record exposes computed salePrice and inStock', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const p = (await (
			await api('/ProductCache/1?select(price,discountPercentage,stock,salePrice,inStock)')
		).json()) as Record<string, number | boolean>;
		const expectedSale = (p.price as number) - (p.price as number) * (((p.discountPercentage as number) || 0) / 100);

		ok(Math.abs((p.salePrice as number) - expectedSale) < 0.01, `salePrice ${p.salePrice} ≈ ${expectedSale}`);
		strictEqual(p.inStock, (p.stock as number) > 0);
	});

	test('computed fields are selectable in queries', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const rows = (await (
			await api('/ProductCache/?stock=gt=0&select(id,price,discountPercentage,salePrice,inStock)&limit(3)')
		).json()) as Array<Record<string, number | boolean>>;

		ok(rows.length > 0, 'expected some in-stock rows');
		for (const row of rows) {
			strictEqual(row.inStock, true, 'filtered to in-stock items');
			ok(typeof row.salePrice === 'number', 'salePrice should be present and numeric');
		}
	});
});
