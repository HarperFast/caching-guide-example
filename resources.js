import { Resource, tables } from 'harper';
import { embed, EMBEDDINGS_ENABLED } from './embeddings.js';

/**
 * Step 1 — Cache a structured JSON API (the "land").
 *
 * `ProductAPI` is the upstream source. Harper calls `get()` only on a cache
 * miss or when an entry has gone stale, then stores the structured result in
 * the `ProductCache` table. Concurrent misses for the same id are coalesced
 * into a single upstream request — cache-stampede protection is built in.
 *
 * This is the minimally-invasive drop-in: point reads at Harper and every
 * request after the first is served locally, at memory speed, close to users.
 */
const UPSTREAM = 'https://dummyjson.com/products';

// Project the upstream payload down to the fields we cache. Caching only what
// you need keeps records small and the schema meaningful.
function toProduct(p) {
	return {
		id: p.id,
		title: p.title,
		description: p.description,
		category: p.category,
		brand: p.brand,
		price: p.price,
		discountPercentage: p.discountPercentage,
		rating: p.rating,
		stock: p.stock,
		tags: p.tags,
	};
}

class ProductAPI extends Resource {
	async get() {
		const id = this.getId();
		const response = await fetch(`${UPSTREAM}/${id}`);
		if (!response.ok) {
			if (response.status === 404) return null;
			throw new Error(`Upstream fetch failed (${response.status}) for product ${id}`);
		}
		return toProduct(await response.json());
	}

	// The upstream is read-only, so write-through is a no-op: warming the cache
	// (Step 2) only populates Harper's local copy. If your source accepts writes,
	// implement put()/patch() here for true write-through caching.
	put() {}
}

// Wire the upstream source to the cache table.
tables.ProductCache.sourcedFrom(ProductAPI);

// Exporting the table class publishes its REST endpoints (e.g. /ProductCache/1)
// AND a WebSocket/SSE endpoint at the same path — real-time streaming for free.
export class ProductCache extends tables.ProductCache {
	/**
	 * Step 5 — push invalidation.
	 *
	 * When the upstream record changes, tell Harper to drop the cached entry;
	 * the next read transparently refetches fresh data from the source. The
	 * write also notifies any WebSocket/SSE subscribers to this record.
	 *
	 *   POST /ProductCache/5   {"action":"invalidate"}
	 */
	static async post(target, data) {
		const body = await data;
		if (body?.action === 'invalidate') {
			await this.invalidate(target);
			return { status: 'invalidated' };
		}
		throw new Error('Unsupported action; send {"action":"invalidate"}');
	}
}

/**
 * Step 2 — Query your cache.
 *
 * Read-through caching populates one record per request. To make the *whole*
 * catalog queryable, warm it once from the upstream collection endpoint. After
 * this runs, the cache is a queryable table: filter, sort, and paginate it with
 * Harper's REST query language — even though the origin API never exposed those
 * capabilities.
 *
 *   POST /Catalog/      -> loads the full catalog into ProductCache
 *   GET  /ProductCache/?price=le=50&sort(-rating)&limit(10)&select(title,price)
 */
const CATALOG_URL = `${UPSTREAM}?limit=0`;
const CATEGORIES_URL = `${UPSTREAM}/categories`;

export class Catalog extends Resource {
	async post() {
		const response = await fetch(CATALOG_URL);
		if (!response.ok) {
			throw new Error(`Catalog fetch failed (${response.status})`);
		}
		const { products } = await response.json();
		if (!Array.isArray(products)) {
			throw new Error(`Catalog fetch returned no products array: ${JSON.stringify(products)}`);
		}

		// Step 4 — warm the category resource so products can be joined to it. Fetched
		// and validated before either table is written, so a categories failure never
		// leaves ProductCache populated without its matching CategoryCache entries.
		const categoriesResponse = await fetch(CATEGORIES_URL);
		if (!categoriesResponse.ok) {
			throw new Error(`Categories fetch failed (${categoriesResponse.status})`);
		}
		const categories = await categoriesResponse.json();
		if (!Array.isArray(categories)) {
			throw new Error(`Categories fetch returned no categories array: ${JSON.stringify(categories)}`);
		}

		for (const product of products) {
			const record = toProduct(product);
			// Step 6 — embed each product so it can be found by meaning, not just
			// keywords. Skipped automatically when no provider is configured.
			if (EMBEDDINGS_ENABLED) {
				record.embedding = await embed(`${record.title}. ${record.description}`);
			}
			await tables.ProductCache.put(record);
		}
		for (const category of categories) {
			await tables.CategoryCache.put(category);
		}

		return { loaded: products.length, categories: categories.length };
	}
}

/**
 * Step 6 — Vector (semantic search over your cache).
 *
 * The same cached records, now searchable by meaning. Embed the query, run an
 * HNSW nearest-neighbor search over the products, and return the closest matches
 * with their similarity `$distance`. No separate vector database required.
 *
 *   POST /ProductSearch/   {"query": "something to keep my drink cold", "limit": 5}
 */
export class ProductSearch extends Resource {
	async post(data) {
		const body = await data;
		if (!body?.query) {
			throw new Error('Provide {"query": "..."}');
		}
		if (!EMBEDDINGS_ENABLED) {
			throw new Error('Set EMBEDDING_PROVIDER (openai|ollama) and re-warm the catalog to enable vector search');
		}
		const target = await embed(body.query);
		return tables.ProductCache.search({
			select: ['id', 'title', 'category', 'price', '$distance'],
			sort: { attribute: 'embedding', target },
			limit: body.limit ?? 5,
		});
	}
}
