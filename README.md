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
