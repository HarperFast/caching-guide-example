/**
 * Step 4 — Relate (join across cached resources).
 *
 * A `@relationship` links each product to its category by slug. Harper resolves
 * the related record on read and lets you filter by related fields with dot
 * syntax — joins over two independently-cached APIs.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

suite('Step 4 — relate with @relationship', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, fixtureDir);
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);
		const body = (await (await api('/Catalog/', { method: 'POST' })).json()) as { categories: number };
		ok(body.categories > 0, `expected categories to be warmed, got ${JSON.stringify(body)}`);
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('embeds the related category record via select()', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const row = (await (
			await api('/ProductCache/1?select(id,category,categoryInfo{slug,name})')
		).json()) as Record<string, any>;

		ok(row?.categoryInfo, `expected an embedded categoryInfo, got ${JSON.stringify(row)}`);
		strictEqual(row.categoryInfo.slug, row.category, 'related slug should match the product category');
		ok(row.categoryInfo.name, 'related category should carry a display name');
	});

	test('filters products by a related-category field (a join)', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const rows = (await (
			await api('/ProductCache/?categoryInfo.slug=beauty&select(id,category)&limit(5)')
		).json()) as Array<Record<string, string>>;

		ok(rows.length > 0, 'expected products in the beauty category');
		for (const row of rows) strictEqual(row.category, 'beauty');
	});
});
