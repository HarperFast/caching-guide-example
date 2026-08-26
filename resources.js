import { Resource, tables } from 'harper';

class JokeAPI extends Resource {
	async get() {
		const id = this.getId();
		const response = await fetch(`https://official-joke-api.appspot.com/jokes/${id}`);
		return response.json();
	}
}

tables.JokeCache.sourcedFrom(JokeAPI);