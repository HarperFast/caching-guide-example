/**
 * Step 5 — Real-time (stream + push invalidation).
 *
 * Push invalidation is tested here over HTTP: POST {action:"invalidate"} drops a
 * cached entry so the next read refetches fresh. Live streaming comes free with
 * the exported table (WebSocket/SSE at the same path) and is shown in the README.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

suite('Step 5 — real-time invalidation', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, fixtureDir);
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('POST {action:"invalidate"} drops the cached entry', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		// Cache the record first.
		const cached = await api('/ProductCache/5');
		strictEqual(cached.status, 200);

		const res = await api('/ProductCache/5', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'invalidate' }),
		});
		strictEqual(res.status, 200);
		const body = (await res.json()) as { status: string };
		strictEqual(body.status, 'invalidated');

		// The entry is still readable — Harper refetches it transparently.
		const after = await api('/ProductCache/5');
		strictEqual(after.status, 200);
		const product = (await after.json()) as Record<string, unknown>;
		strictEqual(product.id, 5);
	});

	test('an unsupported action is rejected', async () => {
		const { admin, httpURL } = ctx.harper;
		const api = authedFetch(httpURL, admin.username, admin.password);

		const res = await api('/ProductCache/5', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'nope' }),
		});
		ok(res.status >= 400, `unsupported action should error, got ${res.status}`);
	});
});
