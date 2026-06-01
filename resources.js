import { Resource, tables } from 'harper';

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

// Exporting the table class publishes its REST endpoints (e.g. /ProductCache/1).
// Later steps add query, transform, relate, real-time, and vector capabilities
// to this same class.
export class ProductCache extends tables.ProductCache {}
