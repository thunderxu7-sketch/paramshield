# ParamShield Sepolia Subgraph

The checked-in manifest targets the **September 6 v1** deployment at
block 11645965. This is a data-readiness index, not the local v2 execution
deployment. Its ABIs come from the immutable deployment record, not current
contract builds.

```bash
pnpm --dir subgraph build
# After connecting the event account and creating a Studio subgraph:
pnpm --dir subgraph exec graph auth <DEPLOY_KEY>
pnpm --dir subgraph exec graph deploy <STUDIO_SLUG> --version-label v0.1.0
# Keep credentials in ignored local environment; never paste them in a report.
node --env-file=.env.local --import ./apps/web/node_modules/tsx/dist/loader.mjs apps/web/scripts/graph-live-spike.ts
```

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
runtime evidence is labelled `graph-local`; the hosted-provider gate remains
incomplete because Studio login's GraphQL path returned 503. Keep the hosted
spike/evidence separate; do not relabel a local result as a hosted deployment. A
new-event-to-analysis demonstration still needs a reviewed transaction. When v2
is deployed, create a versioned manifest/endpoint with v2 events and new
addresses, and re-run all gates.

References:
[manifest](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/),
[block-pinned queries and metadata](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/).
