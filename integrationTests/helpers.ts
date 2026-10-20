/** Shared helpers for the integration tests. */
import { ok } from 'node:assert/strict';

function basicAuth(username: string, password: string): string {
	return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Builds an authed fetch bound to a Harper test instance. */
export function authedFetch(httpURL: string, username: string, password: string) {
	const auth = basicAuth(username, password);
	return (path: string, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set('Authorization', auth);
		return fetch(`${httpURL}${path}`, { ...init, headers });
	};
}

export async function warmCatalog(api: ReturnType<typeof authedFetch>): Promise<{ loaded: number; categories: number }> {
	const res = await api('/Catalog/', { method: 'POST' });
	const body = await res.text();
	ok(res.ok, `catalog warm-up failed: ${res.status} ${body}`);
	return JSON.parse(body);
}
