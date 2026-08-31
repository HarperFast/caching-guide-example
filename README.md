# Edge API Cache → Data Layer

Turn any external JSON API into a **low-latency, queryable data layer** at the edge.

This template starts as a minimally-invasive drop-in cache and grows, one step at
a time, into a full data platform, without ever changing where the data comes from.
The point: **an API cache of structured data is already a database.** Once Harper
holds the records, you can query them, reshape them, relate them, stream them live,
and search them semantically, all capabilities the origin API never offered.

Each step is a single commit, so `git log -p` reads as a guided tour.

| Step | Capability | What you gain |
| ---- | ---------- | ------------- |
| 1 | **Cache** | Drop-in read-through cache with TTL + stampede protection |
| 2 | **Query** | Filter, sort, paginate the cache with Harper's REST query language |
| 3 | **Transform** | Reshape upstream data at the edge (a BFF, for free) |
| 4 | **Relate** | Join across cached resources with `@relationship` |
| 5 | **Stream** | Real-time updates + push invalidation over WebSocket/SSE |
| 6 | **Vector** | Semantic search over cached content with an HNSW index |

The upstream in this template is the public [DummyJSON products API](https://dummyjson.com/docs/products)
(no API key required), but the pattern applies to any REST/JSON source: your own
microservices, a SaaS API, a legacy backend.

## Running it

```bash
npm install
harper run .        # or: harper dev .
```

Then hit the endpoints below. By default Harper serves on port `9926`; requests
use HTTP Basic auth with your instance's admin credentials.

```bash
npm test                             # Steps 1-5 (Step 6 is skipped without a provider)
EMBEDDING_PROVIDER=ollama npm test   # include Step 6's vector search
```

---

## Step 1 — Cache a structured JSON API

Define a cache table with a TTL and point it at an upstream source.

```graphql
# schema.graphql
type ProductCache @table(expiration: 3600) {
	id: Int @primaryKey
	title: String
	price: Float
	# ...
}
```

```js
// resources.js
class ProductAPI extends Resource {
	async get() {
		const response = await fetch(`https://dummyjson.com/products/${this.getId()}`);
		return response.json();
	}
}
tables.ProductCache.sourcedFrom(ProductAPI);
export class ProductCache extends tables.ProductCache {}
```

```bash
# First read fetches from upstream and caches it; every read after is local.
curl localhost:9926/ProductCache/1
```

Harper coalesces concurrent misses for the same id into one upstream request, and
serves all subsequent reads from local storage until the entry's TTL expires. That
is the entire "land": no schema migration upstream, no rewrite, just faster reads.

---

## Step 2 — Query your cache

Read-through caching stores one record per request. To make the *whole* catalog
queryable, warm it once from the upstream collection endpoint, then mark the
fields you filter and sort on as `@indexed`.

```graphql
# schema.graphql — index the fields we query on
category: String @indexed
price: Float @indexed
rating: Float @indexed
```

```js
// resources.js — warm the cache from the upstream collection
// toProduct() projects the upstream payload down to the fields we cache.
function toProduct(p) {
	return { id: p.id, title: p.title, category: p.category, price: p.price, rating: p.rating /* ... */ };
}

export class Catalog extends Resource {
	async post() {
		const { products } = await (await fetch('https://dummyjson.com/products?limit=0')).json();
		for (const product of products) await tables.ProductCache.put(toProduct(product));
		return { loaded: products.length };
	}
}
```

```bash
curl -X POST localhost:9926/Catalog/        # warm the cache

# Now query it: filter, sort, paginate, project, at the edge:
curl 'localhost:9926/ProductCache/?price=le=50&sort(-rating)&limit(10)&select(id,title,price,rating)'
```

The cache is now a database. Harper's [REST query language](https://docs.harperdb.io)
gives you FIQL filters (`=gt=`, `=le=`, `=ct=`), `sort()`, `limit()`, `select()`,
and boolean grouping, over data whose origin API may have offered none of it.

---

## Step 3 — Transform (a BFF, for free)

Reshape upstream data at the edge with `@computed` fields. They are resolved from
the record's own attributes on read: no upstream change, no extra storage, and
they are queryable and selectable like any other field.

```graphql
# schema.graphql
salePrice: Float @computed(from: "price - price * (discountPercentage || 0) / 100")
inStock: Boolean @computed(from: "stock > 0")
```

```bash
curl 'localhost:9926/ProductCache/1?select(title,price,salePrice,inStock)'
# { "title": "...", "price": 9.99, "salePrice": 8.94, "inStock": true }
```

This is a backend-for-frontend in two lines: the client gets exactly the shape it
needs. For richer reshaping (renaming, nesting, merging multiple sources) extend
the table class and override `get()`.

---

## Step 4 — Relate (join two cached APIs)

Cache a second resource and link them with `@relationship`. Now you can embed
related records and filter by related fields, a join across two independently
cached upstreams.

```graphql
# schema.graphql
type ProductCache @table(expiration: 3600) {
	categoryInfo: CategoryCache @relationship(from: "category")
}
type CategoryCache @table(expiration: 86400) {
	slug: ID @primaryKey
	name: String
}
```

```js
// resources.js — Catalog.post() also warms the category resource, so products
// can be joined to it (added to the same handler shown in Step 2)
const categories = await (await fetch('https://dummyjson.com/products/categories')).json();
for (const category of categories) await tables.CategoryCache.put(category);
```

```bash
curl -X POST localhost:9926/Catalog/    # warms products *and* categories

# Embed the related category (braces select the related fields):
curl 'localhost:9926/ProductCache/1?select(title,categoryInfo{slug,name})'

# Filter products by a related-category field (a join):
curl 'localhost:9926/ProductCache/?categoryInfo.slug=beauty&limit(5)'
```

Normalize where it helps, keep low-latency reads, and let Harper resolve the
relationship, with no N+1 round-trips to the origin.

---

## Step 5 — Stream (real-time + push invalidation)

An exported table publishes a WebSocket/SSE endpoint at the same path as its REST
endpoint, so you get live updates with no extra code. Pair that with **push
invalidation** so the cache reflects upstream changes the moment they happen.

```js
// resources.js — drop a cached entry on demand; next read refetches
static async post(target, data) {
	const body = await data;
	if (body?.action === 'invalidate') {
		await this.invalidate(target);
		return { status: 'invalidated' };
	}
}
```

Subscribe to a record and react to every change (Node 22+ / browser):

```js
const ws = new WebSocket('ws://localhost:9926/ProductCache/5');
ws.onmessage = (e) => console.log('product 5 changed:', JSON.parse(e.data));
// ...or SSE: fetch('/ProductCache/5', { headers: { Accept: 'text/event-stream' } })
```

```bash
# Tell Harper the upstream changed; subscribers are notified, next read is fresh:
curl -X POST localhost:9926/ProductCache/5 -H 'Content-Type: application/json' -d '{"action":"invalidate"}'
```

REST for reads, the same model streamed live over WebSocket/MQTT/SSE: a
combination very few platforms offer from a single resource definition.

---

## Step 6 — Vector (semantic search over your cache)

The same cached records, now searchable by meaning. Add an HNSW vector index,
embed each product during warm-up, and search with a natural-language query, with
no separate vector database.

This step needs an embedding provider. Copy `.env.example` to `.env` and set one:

```bash
EMBEDDING_PROVIDER=ollama        # local; or "openai" with OPENAI_API_KEY
```

```graphql
# schema.graphql
embedding: [Float] @indexed(type: "HNSW", distance: "cosine")
```

```js
// resources.js
export class ProductSearch extends Resource {
	async post(data) {
		const { query, limit = 5 } = await data;
		const target = await embed(query);
		return tables.ProductCache.search({
			select: ['id', 'title', 'price', '$distance'],
			sort: { attribute: 'embedding', target },
			limit,
		});
	}
}
```

```bash
curl -X POST localhost:9926/Catalog/        # warms + embeds
curl -X POST localhost:9926/ProductSearch/ -H 'Content-Type: application/json' -d '{"query":"something to keep my drink cold"}'
# -> tumblers, coolers, water bottles, matched by meaning, ranked by $distance
```

Generating the embeddings is the one piece that currently reaches outside the
database: `embed()` calls an external provider (OpenAI, a local Ollama model) to
turn text into vectors, and Harper stores and searches them. That gap is closing.
Built-in embedding generation on Fabric is coming
([harper#510](https://github.com/HarperFast/harper/issues/510)), which moves the
embedding step in-process alongside the storage and search.

---

## Where you landed

You started with a one-method read-through cache and finished with a queryable,
relational, real-time, semantically-searchable data layer, all over data that
still lives in someone else's API. That is the whole pitch: **the easy "land" of
an API cache and the deep "expand" of a database are the same system.** Each step
above was a few lines, and none required touching the origin.

