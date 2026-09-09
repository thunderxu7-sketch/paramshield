# ParamShield Sepolia Subgraph

The checked-in manifest targets the **September 6 v1** deployment at
block 11645965. This is a data-readiness index, not the local v2 execution
deployment. Its ABIs come from the immutable deployment record, not current
contract builds.

## Verified Studio deployment — September 8

- [Studio dashboard](https://thegraph.com/studio/subgraph/paramshield-sepolia-v-1/)
  (owner login required); slug `paramshield-sepolia-v-1`, version `v0.1.0`.
- Studio reports **DEPLOYED / SYNCED / 100%** on Ethereum Sepolia, 14 entities.
- Deployment CID: `QmTJBKe1xEtjJzay4JBaZMfsKwzJYocmRN7QzxCmy55SUW`.
- The official hosted endpoint supplied all five positions, totals and config at
  block **11660066**, independently reconciled against RPC at the same
  block/hash. Validation head matched the indexed block; block age was 8
  seconds.
- [Deployment/source record](../docs/evidence/graph-studio-deployment-2026-09-08.json)
  and [live snapshot/risk output](../docs/evidence/graph-live-v1.json) are
  public and sanitized. The authenticated deployment succeeded; the development
  query needs no deploy key. Never send the deploy key as a query API key.

This is a **hosted Studio development endpoint**, not publication to The Graph
Network. Official documentation limits it to **3,000 queries/day**; the network
Free Plan's monthly query allowance is a different limit. Avoid background
polling, keep endpoint configuration server-side, and fail closed on rate limits
or stale data rather than reusing an old approval. Publication is a separate
onchain action and was not performed. See
[Studio deployment versus publication](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/).

## Reproduction

```bash
pnpm --dir subgraph build
# For a new deployment, authenticate interactively; do not put a key in history:
pnpm --dir subgraph exec graph auth
pnpm --dir subgraph exec graph deploy <STUDIO_SLUG> --version-label <NEW_VERSION>
# Read-only verification using GRAPH_QUERY_URL; never loads a fixture fallback:
node --env-file=.env.local --import ./apps/web/node_modules/tsx/dist/loader.mjs apps/web/scripts/graph-live-spike.ts
```

The current checkout keeps the query URL in ignored `.env.local`, and the
deployment credential in ignored `.local/graph-studio.env`. The deployment used
a separate `.local/graph-cli-home/.graph-cli.json` (0600, parent 0700), without
changing the user's global Graph CLI configuration or unrelated credentials. Do
not rotate credentials or redeploy the same version merely to rerun a query.

## Indexing design

- PositionUpdated is the single source of position amounts; PositionSeeded is
  not processed a second time. Totals are accumulated from deltas starting at
  zero, not initialized from end-of-block totals and then double-counted.
- Constructor-only price, LT, and decimal scales are read from the actual
  contract at the event block. There is no hard-coded price/parameter fallback.
- LT/price events update configuration. Health factors are recomputed downstream
  from current indexed amounts; a previously emitted HF is not current after LT
  changes.
- Execution lifecycle events expose proposal, decision, expiry, and transaction
  identifiers. v1 cannot claim a market stateVersion or v2 guard.

## Query and acceptance

`@paramshield/graph-client` first obtains `_meta`, then pins **all** market and
cursor-paginated position reads to that block hash. It verifies deployment/block
consistency, scope, position count, totals, indexing errors, and freshness. The
live spike independently corroborates indexed config and every position with RPC
at that block and checks for reorgs; it never substitutes RPC/fixtures for a
failed Graph read. Endpoint tokens are not part of public provenance.

Local compilation and mocked client tests are not live indexing proof. The
September 7 [local Graph fallback](../infra/graph-local/README.md) subsequently
indexed real Sepolia events and reconciled all positions/config against RPC. Its
runtime evidence remains labelled `graph-local`; the later September 8 hosted
Studio deployment has its own evidence above. The earlier HTTP 503 is
historical, not the current status. Do not relabel a local result as hosted
proof. A new-event-to-analysis demonstration still needs a reviewed transaction.
When v2 is deployed, create a versioned manifest/endpoint with v2 events and new
addresses, and re-run all gates. Neither this v1 milestone nor Studio deployment
alone guarantees sponsor qualification.

References:
[manifest](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/),
[block-pinned queries and metadata](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/).

## Independent hosted v2 — September 9

The new `v2/` mapping and schema preserve all v1 source/ABI/deployment
artifacts. `pnpm build` builds both versions; `pnpm build:v2` selects the new
mapping. See [the v2 manifest](../deployments/graph-sepolia-v2.json) for
addresses, start block, actual Studio version/CID and source hashes. The query
URL and account identifier remain server-only in `GRAPH_V2_QUERY_URL`.

V2 indexes exact emitted market state versions, executor role/authorization
epoch changes, allowlist, proposal preconditions and lifecycle events. Solidity
emits `ProposalPreconditions` **before** `ProposalCreated`; the mapping
preserves it independently and binds it on creation. Position event health
factors are not cached as current risk after a parameter/price change. Live
indexed roles, allowlist and five-position state are RPC-corroborated in
[the v2 evidence](../docs/evidence/graph-live-v2.json). Actual new execution
events are a separate gate, not inferred from the initial seed or an Anvil test.
