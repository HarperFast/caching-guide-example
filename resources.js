class JokeAPI extends Resource {
	async get() {
		const id = this.getId();
		const response = await fetch(`https://official-joke-api.appspot.com/jokes/${id}`);
		return response.json();
	}
}

tables.JokeCache.sourcedFrom(JokeAPI);

export class JokeCache extends tables.JokeCache {
	static async post(target, data) {
		const body = await data;
		if (body?.action === 'invalidate') {
			this.invalidate(target);
			return { status: 200, data: { message: 'invalidated' } };
		}
	}
}