/** Shared helpers for the integration tests. */

export function basicAuth(username: string, password: string): string {
	return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Builds an authed fetch bound to a Harper test instance. */
export function authedFetch(httpURL: string, username: string, password: string) {
	const auth = basicAuth(username, password);
	return (path: string, init: RequestInit = {}) =>
		fetch(`${httpURL}${path}`, {
			...init,
			headers: { Authorization: auth, ...(init.headers ?? {}) },
		});
}
