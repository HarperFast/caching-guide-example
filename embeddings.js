/**
 * Step 6 — pluggable embedding generation.
 *
 * Set EMBEDDING_PROVIDER to enable vector search. With no provider configured,
 * embeddings are skipped and every other step still works.
 *
 *   EMBEDDING_PROVIDER=openai  OPENAI_API_KEY=sk-...
 *   EMBEDDING_PROVIDER=ollama  OLLAMA_URL=http://localhost:11434
 *
 * No SDKs required — both providers are called over plain HTTP.
 */
const PROVIDER = process.env.EMBEDDING_PROVIDER;
export const EMBEDDINGS_ENABLED = Boolean(PROVIDER);

const OPENAI_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

/** Returns a numeric embedding vector for `text`, or null if no provider is set. */
export async function embed(text) {
	switch (PROVIDER) {
		case undefined:
			return null;
		case 'openai':
			return embedOpenAI(text);
		case 'ollama':
			return embedOllama(text);
		default:
			throw new Error(`Unknown EMBEDDING_PROVIDER: ${PROVIDER} (use "openai" or "ollama")`);
	}
}

async function embedOpenAI(text) {
	const res = await fetch('https://api.openai.com/v1/embeddings', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
		},
		body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
	});
	if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status})`);
	const json = await res.json();
	return json.data[0].embedding;
}

async function embedOllama(text) {
	const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
	});
	if (!res.ok) throw new Error(`Ollama embeddings failed (${res.status})`);
	const json = await res.json();
	return json.embedding;
}
